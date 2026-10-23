import { FileSystemAdapter, FuzzySuggestModal, Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { ClaudeSdkBackend } from './chat/claudeSdk'
import { HarnessRunBackend } from './chat/harnessRun'
import { listSkills, pluginDirs, slashCommand, type SkillEntry } from './chat/skills'
import type { ChatBackend, WikiTarget } from './chat/types'
import { log } from './logger'
import { DEFAULT_SETTINGS, LlmWikiSettingTab, type ChatMode, type LlmWikiSettings } from './settings'
import { ChatView, VIEW_CHAT } from './views/chat'
import { DashboardView, VIEW_DASHBOARD } from './views/dashboard/index'
import { nextText } from './views/dashboard/jobs'
import { SearchView, VIEW_SEARCH } from './views/search'
import { promptText } from './ui/modals'
import { openCredentialModal, type CredentialPrompt } from './ui/credentialModal'
import { Actions } from './wiki/actions'
import { Cli, type WikiRow } from './wiki/cli'
import type { JobView, Snapshot } from './wiki/model'
import { takeSnapshot } from './wiki/snapshot'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { effectivePath, findBinary, matchWiki } from './wiki/resolve'

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS
  cli: Cli | null = null
  cliBin: string | null = null
  claudeBin: string | null = null
  wiki: WikiTarget | null = null
  actions: Actions | null = null
  snapshot: Snapshot | null = null
  /** Why the plugin is not ready, or null when it is. */
  problem: string | null = null
  private statusBar: HTMLElement | null = null
  private pollTimer: number | null = null
  private refreshing: Promise<void> | null = null
  private unloaded = false

  async onload(): Promise<void> {
    await this.loadSettings()
    log.setDebug(this.settings.debug)
    this.addSettingTab(new LlmWikiSettingTab(this.app, this))
    this.registerView(VIEW_SEARCH, (leaf) => new SearchView(leaf, this))
    this.registerView(VIEW_CHAT, (leaf) => new ChatView(leaf, this))
    this.registerView(VIEW_DASHBOARD, (leaf) => new DashboardView(leaf, this))
    this.addRibbonIcon('layout-dashboard', 'Open LLM wiki', () => void this.openDashboard())
    this.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => void this.openDashboard() })
    this.addCommand({ id: 'open-chat', name: 'Open chat', callback: () => void this.openChat() })
    this.addCommand({ id: 'open-search', name: 'Open search', callback: () => void this.activateView(VIEW_SEARCH) })
    this.addCommand({ id: 'run-job', name: 'Run a job…', callback: () => this.pickJobToRun() })
    this.addCommand({ id: 'add-job', name: 'Add a job…', callback: () => void this.addJob() })
    this.addCommand({ id: 'run-skill', name: 'Run a skill…', callback: () => this.pickSkill() })
    this.addCommand({ id: 'ask-about-note', name: 'Ask the agent about this note', checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile()
      if (!file) return false
      if (!checking) void this.openChat(`About [[${file.path}]]: `)
      return true
    } })
    this.addCommand({ id: 'refresh', name: 'Refresh the dashboard', callback: () => void this.refreshSnapshot() })
    this.addCommand({ id: 'redetect', name: 'Re-detect wiki and binaries', callback: () => void this.detect(true) })
    this.statusBar = this.addStatusBarItem()
    this.statusBar.addClass('mod-clickable')
    this.registerDomEvent(this.statusBar, 'click', () => void this.openDashboard())
    this.app.workspace.onLayoutReady(() => void this.detect())
  }

  onunload(): void {
    this.unloaded = true
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer)
    this.cli?.killAll()
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<LlmWikiSettings> | null) }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
    log.setDebug(this.settings.debug)
  }

  vaultPath(): string | null {
    const adapter = this.app.vault.adapter
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
  }

  statusText(): string {
    if (this.problem) return this.problem
    return this.wiki ? `wiki ${this.wiki.key} (${this.wiki.name}) at ${this.wiki.root}` : 'detecting…'
  }

  /** Finds the binaries and the wiki; every view reads the outcome off the plugin. */
  async detect(announce = false): Promise<void> {
    this.problem = null
    this.wiki = null
    this.snapshot = null
    try {
      const path = await effectivePath()
      this.cliBin = await findBinary('llm-wiki-cli', this.settings.cliPath)
      this.claudeBin = await findBinary('claude', this.settings.claudePath)
      if (!this.cliBin) throw new Error('llm-wiki-cli not found on the login shell PATH; set its path in the plugin settings')
      this.cli = new Cli({ bin: this.cliBin, env: { ...process.env, PATH: path }, timeoutMs: 60_000 })
      const vault = this.vaultPath()
      if (!vault) throw new Error('this vault is not on a local filesystem')
      const rows = await this.cli.run<{ wikis: WikiRow[] }>('machine.wikis.ls')
      const row = matchWiki(rows.wikis ?? [], vault, this.settings.wikiKey)
      if (!row) throw new Error(`the vault is not a registered wiki (${(rows.wikis ?? []).length} registered); join it, or set the wiki key in the plugin settings`)
      this.wiki = { key: row.key, name: row.name, root: vault }
      this.actions = new Actions(this.cli, row.key)
    } catch (e) {
      this.problem = e instanceof Error ? e.message : String(e)
      this.actions = null
      log.warn(this.problem)
    }
    this.showStatus()
    if (announce) new Notice(this.statusText())
    this.app.workspace.trigger('llm-wiki:detected')
    if (this.wiki) await this.refreshSnapshot()
  }

  /** Reads the wiki once; views redraw on the `llm-wiki:snapshot` event. Coalesces concurrent calls. */
  refreshSnapshot(): Promise<void> {
    if (this.refreshing) return this.refreshing
    const { cli, wiki } = this
    if (!cli || !wiki || this.unloaded) return Promise.resolve()
    this.refreshing = takeSnapshot(cli, wiki.key, Date.now(), { root: wiki.root, home: homedir(), read: (p) => readFile(p, 'utf8') })
      .then((snap) => {
        this.announceFailures(this.snapshot, snap)
        this.snapshot = snap
        this.showStatus()
        this.app.workspace.trigger('llm-wiki:snapshot')
      })
      .catch((e: unknown) => log.warn('snapshot', e))
      .finally(() => {
        this.refreshing = null
        this.schedulePoll()
      })
    return this.refreshing
  }

  /** A job that stopped since the last read gets a Notice, since the status bar alone is easy to miss. */
  private announceFailures(before: Snapshot | null, after: Snapshot): void {
    if (!before) return
    const seen = new Set(before.attention.map((a) => a.id))
    for (const a of after.attention)
      if (a.id.startsWith('parked:') && !seen.has(a.id)) new Notice(`${a.title}. Open the LLM wiki dashboard to fix it.`, 10_000)
  }

  /** Tight while a ticket is running, since someone just pressed Run and is watching; relaxed otherwise. */
  private schedulePoll(): void {
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer)
    if (this.unloaded) return
    const busy = this.snapshot?.jobs.some((j) => j.running) ?? false
    const open = this.app.workspace.getLeavesOfType(VIEW_DASHBOARD).length > 0
    const ms = busy ? 10_000 : open ? 60_000 : 5 * 60_000
    this.pollTimer = window.setTimeout(() => void this.refreshSnapshot(), ms)
  }

  private showStatus(): void {
    if (!this.statusBar) return
    if (!this.wiki) {
      this.statusBar.setText('llm-wiki · not ready')
      return
    }
    const s = this.snapshot
    const running = s?.jobs.find((j) => j.running)
    const stopped = s?.attention.filter((a) => a.id.startsWith('parked:')).length ?? 0
    const text = !s ? this.wiki.key : running ? `running ${running.name}` : stopped && stopped === s.health.count ? `${stopped} stopped` : s.health.count ? `${s.health.count} need you` : 'ok'
    this.statusBar.setText(`llm-wiki · ${text}${s && !s.runner ? ' · no runner' : ''}`)
  }

  async openDashboard(): Promise<void> {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(VIEW_DASHBOARD)[0] ?? null
    if (!leaf) {
      leaf = workspace.getLeaf('tab')
      await leaf.setViewState({ type: VIEW_DASHBOARD, active: true })
    }
    await workspace.revealLeaf(leaf)
  }

  /** One field; the add skill decides the rest in chat. */
  promptAddJob(): Promise<string | null> {
    return promptText(this.app, {
      title: 'Add a job',
      description: 'What should the wiki follow or do? A URL, a mailbox, or a task in plain words. The agent asks about anything else it needs.',
      placeholder: 'https://example.com/blog — or — rebuild the index every night',
      cta: 'Ask the agent',
    })
  }

  /** One field; the add skill decides the rest in chat. */
  async addJob(): Promise<void> {
    const text = await this.promptAddJob()
    if (text) await this.openChat(`/llm-wiki:add ${text}`)
  }

  /** The credential dialog; after a save the dashboard re-reads, since the binding is the CLI's to confirm. */
  credentialModal(prompt: CredentialPrompt): void {
    const { snapshot, actions } = this
    if (!snapshot || !actions) {
      new Notice(this.problem ?? 'The wiki has not been read yet')
      return
    }
    openCredentialModal(this.app, snapshot, actions, prompt, async (out) => {
      new Notice(out.message, 5000)
      await this.refreshSnapshot()
    })
  }

  /** The chat slash skills the installed plugins ship, as a fuzzy list; the chosen one becomes a chat turn. */
  pickSkill(): void {
    void pluginDirs().then(listSkills).then((skills) => {
      if (!skills.length) {
        new Notice('No llm-wiki skills found under ~/.claude/plugins; install the llm-wiki plugin in Claude Code first')
        return
      }
      this.pickFrom(skills)
    })
  }

  private pickFrom(skills: SkillEntry[]): void {
    const start = (skill: SkillEntry) =>
      void (async () => {
        const args = skill.args ? await promptText(this.app, { title: `/llm-wiki:${skill.name}`, description: skill.description, placeholder: skill.args, cta: 'Start' }) : ''
        if (args !== null) await this.openChat(slashCommand(skill, args))
      })()
    const modal = new (class extends FuzzySuggestModal<SkillEntry> {
      getItems = () => skills
      getItemText = (s: SkillEntry) => `${s.name} ${s.description}`
      onChooseItem = (s: SkillEntry) => start(s)
      renderSuggestion = (item: { item: SkillEntry }, el: HTMLElement) => {
        el.createDiv({ text: `/llm-wiki:${item.item.name}${item.item.args ? ` ${item.item.args}` : ''}` })
        el.createDiv({ cls: 'llm-wiki-muted', text: item.item.description })
      }
    })(this.app)
    modal.setPlaceholder('Which skill?')
    modal.open()
  }

  /** The fastest Run there is: a fuzzy list of jobs. */
  private pickJobToRun(): void {
    const jobs = this.snapshot?.jobs.filter((j) => !j.running && !j.paused) ?? []
    const actions = this.actions
    if (actions === null || !jobs.length) {
      new Notice(this.snapshot ? 'No job can be run right now' : 'The wiki has not been read yet')
      return
    }
    const refresh = () => this.refreshSnapshot()
    const run = (slug: string) => actions.runJob(slug)
    const modal = new (class extends FuzzySuggestModal<JobView> {
      getItems = () => jobs
      getItemText = (j: JobView) => `${j.name} ${j.slug} ${nextText(j)}`
      onChooseItem = (j: JobView) => void run(j.slug).then((out) => { new Notice(out.message); void refresh() })
    })(this.app)
    modal.setPlaceholder('Run which job?')
    modal.open()
  }

  /** The chat backend for a mode, built fresh so settings changes apply. */
  async backend(mode: ChatMode): Promise<ChatBackend> {
    if (!this.cli) throw new Error(this.problem ?? 'not ready')
    if (mode === 'ask') {
      return new HarnessRunBackend(this.cli, {
        sandbox: this.settings.askSandbox,
        skill: this.settings.askSkill,
        model: this.settings.model || undefined,
      })
    }
    if (!this.claudeBin) throw new Error('claude not found on the login shell PATH; set its path in the plugin settings')
    return new ClaudeSdkBackend({ claudePath: this.claudeBin, path: await effectivePath(), model: this.settings.model || undefined })
  }

  /** Opens chat; with text, the composer is filled and focused so one click starts the conversation. */
  async openChat(prefill?: string): Promise<void> {
    const leaf = await this.activateView(VIEW_CHAT)
    const view = leaf?.view
    if (prefill && view instanceof ChatView) view.prefill(prefill)
  }

  async activateView(type: string): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)
      if (!leaf) return null
      await leaf.setViewState({ type, active: true })
    }
    await workspace.revealLeaf(leaf)
    return leaf
  }
}
