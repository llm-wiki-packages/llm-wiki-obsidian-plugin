import { FileSystemAdapter, FuzzySuggestModal, Notice, Plugin } from 'obsidian'
import { ClaudeSdkBackend } from './chat/claudeSdk'
import { HarnessRunBackend } from './chat/harnessRun'
import { listSkills, pluginDirs, slashCommand, type SkillEntry } from './chat/skills'
import type { BackendKind, ChatBackend, ModelChoice, WikiTarget } from './chat/types'
import { log } from './logger'
import { DEFAULT_SETTINGS, LlmWikiSettingTab, type LlmWikiSettings } from './settings'
import { DashboardView, VIEW_DASHBOARD, type Tab } from './views/dashboard/index'
import { nextText } from './views/dashboard/jobs'
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
  /** Every sandboxed chat made, so quitting closes their sessions. */
  private readonly sandboxChats = new Set<HarnessRunBackend>()
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
  private again = false
  private againLight = true
  /** When the last full read happened; light polls lean on it for up to a minute. */
  private fullAt = 0
  /** What `machine wikis ls` returned, so a not-ready card can offer the registered keys. */
  registered: WikiRow[] = []
  private unloaded = false

  async onload(): Promise<void> {
    await this.loadSettings()
    log.setDebug(this.settings.debug)
    this.addSettingTab(new LlmWikiSettingTab(this.app, this))
    this.registerView(VIEW_DASHBOARD, (leaf) => new DashboardView(leaf, this))
    this.addRibbonIcon('brain', 'Open LLM wiki', () => void this.openDashboard())
    this.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => void this.openDashboard() })
    this.addCommand({ id: 'open-chat', name: 'Open chat', callback: () => void this.openDashboard('chat') })
    this.addCommand({ id: 'open-search', name: 'Open search', callback: () => void this.openDashboard('search') })
    this.addCommand({ id: 'run-job', name: 'Run a job…', callback: () => this.pickJobToRun() })
    this.addCommand({ id: 'add-job', name: 'Add a source…', callback: () => void this.addJob() })
    this.addCommand({ id: 'open-job', name: 'Open a job…', callback: () => this.pickJob() })
    this.addCommand({ id: 'set-credential', name: 'Set a credential…', callback: () => this.pickSlot() })
    this.addCommand({ id: 'run-skill', name: 'Run a skill…', callback: () => this.pickSkill() })
    this.addCommand({ id: 'ask-about-note', name: 'Ask the agent about this note', checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile()
      if (!file) return false
      if (!checking) void this.openChat(`About [[${file.path}]]: `)
      return true
    } })
    this.addCommand({ id: 'refresh', name: 'Refresh the dashboard', callback: () => void this.refreshSnapshot() })
    this.addCommand({ id: 'accept-draft', name: 'Accept this draft', checkCallback: (checking) => this.draftCommand(checking, (a, path) => a.accept([path])) })
    this.addCommand({ id: 'reject-draft', name: 'Reject this draft…', checkCallback: (checking) => this.draftCommand(checking, async (a, path) => {
      const reason = await promptText(this.app, { title: `Reject ${path}`, placeholder: 'Why? One line; it is stamped on the page.', cta: 'Reject' })
      return reason ? a.reject(path, reason) : { ok: true, message: '' }
    }) })
    this.addCommand({ id: 'redetect', name: 'Re-detect wiki and binaries', callback: () => void this.detect(true) })
    this.statusBar = this.addStatusBarItem()
    this.statusBar.addClass('mod-clickable')
    this.registerDomEvent(this.statusBar, 'click', () => void this.openDashboard())
    this.app.workspace.onLayoutReady(() => void this.detect())
  }

  /** Accept or reject the draft in the active editor, without going back to the Pages tab. */
  private draftCommand(checking: boolean, run: (a: Actions, path: string) => Promise<{ ok: boolean; message: string }>): boolean {
    const path = this.app.workspace.getActiveFile()?.path
    const actions = this.actions
    if (!path || !actions || !this.snapshot?.curation.some((c) => c.path === path)) return false
    if (!checking) void run(actions, path).then((out) => {
      if (out.message) new Notice(out.message, out.ok ? 4000 : 8000)
      void this.refreshSnapshot()
    })
    return true
  }

  onunload(): void {
    this.unloaded = true
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer)
    for (const b of this.sandboxChats) b.close()
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
    return this.wiki ? `Found wiki ${this.wiki.key} (llm-wiki-cli at ${this.cliBin ?? '?'}${this.claudeBin ? '' : '; claude not found, so Agent chat is off'})` : 'detecting…'
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting
    setting.open()
    setting.openTabById(this.manifest.id)
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
      this.registered = rows.wikis ?? []
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
    // Said once per machine state: on request, or when the outcome differs from the last launch.
    const outcome = this.problem ?? `${this.wiki?.key ?? ''}|${this.cliBin ?? ''}|${this.claudeBin ?? ''}`
    if (announce || outcome !== this.settings.lastDetect) new Notice(this.statusText(), 6000)
    if (outcome !== this.settings.lastDetect) {
      this.settings.lastDetect = outcome
      void this.saveSettings()
    }
    this.app.workspace.trigger('llm-wiki:detected')
    if (this.wiki) await this.refreshSnapshot()
  }

  /** Reads the wiki once; views redraw on the `llm-wiki:snapshot` event. Coalesces concurrent calls. */
  refreshSnapshot(light = false): Promise<void> {
    // A refresh asked for during a read runs once more after it, so a change made meanwhile is not missed.
    if (this.refreshing) {
      this.again = true
      this.againLight = this.againLight && light
      return this.refreshing
    }
    const { cli, wiki } = this
    if (!cli || !wiki || this.unloaded) return Promise.resolve()
    const files = { root: wiki.root, home: homedir(), read: (p: string) => readFile(p, 'utf8') }
    // A poll is light for five minutes after a full read; a full read is what a person, a tool, or the cadence asks for.
    const previous = light && this.snapshot && Date.now() - this.fullAt < 5 * 60_000 ? this.snapshot : undefined
    this.refreshing = takeSnapshot(cli, wiki.key, Date.now(), files, previous)
      .then((snap) => {
        // A re-detect meanwhile moved the plugin to another wiki; this read is about the old one.
        if (this.wiki !== wiki) return
        if (!previous) this.fullAt = snap.takenAt
        this.announceFailures(this.snapshot, snap)
        this.snapshot = snap
        this.showStatus()
        this.app.workspace.trigger('llm-wiki:snapshot')
      })
      .catch((e: unknown) => log.warn('snapshot', e))
      .finally(() => {
        this.refreshing = null
        if (this.again) {
          const lightAgain = this.againLight
          this.again = false
          this.againLight = true
          void this.refreshSnapshot(lightAgain)
        } else this.schedulePoll()
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
    this.pollTimer = window.setTimeout(() => void this.refreshSnapshot(true), ms)
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
    // What needs a person outranks what is moving: an hourly job must not hide a stopped one.
    const text = !s ? this.wiki.key : stopped && stopped === s.health.count ? `${stopped} stopped` : s.health.count ? `${s.health.count} need you` : running ? `running ${running.name}` : 'ok'
    this.statusBar.setText(`llm-wiki · ${text}`)
  }

  /** The one view; with a tab, lands on it. */
  async openDashboard(tab?: Tab): Promise<DashboardView | null> {
    const { workspace } = this.app
    let leaf = workspace.getLeavesOfType(VIEW_DASHBOARD)[0] ?? null
    if (!leaf) {
      leaf = workspace.getLeaf('tab')
      await leaf.setViewState({ type: VIEW_DASHBOARD, active: true })
    }
    await workspace.revealLeaf(leaf)
    const view = leaf.view instanceof DashboardView ? leaf.view : null
    if (tab && view) view.goTo(tab)
    return view
  }

  /** One field; the add skill decides the rest in chat. */
  promptAddJob(): Promise<string | null> {
    return promptText(this.app, {
      title: 'Add a source',
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
    // The palette reads the disk again, so a skill installed since launch shows; the `/` list follows it.
    this.skillList = null
    void this.chatSkills().then((skills) => {
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

  /** A fuzzy list of jobs; the pick opens its detail dialog. */
  private pickJob(): void {
    const jobs = this.snapshot?.jobs ?? []
    if (!jobs.length) {
      new Notice(this.snapshot ? 'No jobs yet' : 'The wiki has not been read yet')
      return
    }
    const open = (j: JobView) => void this.openDashboard().then(() => this.dashboard()?.openJob(j))
    const modal = new (class extends FuzzySuggestModal<JobView> {
      getItems = () => jobs
      getItemText = (j: JobView) => `${j.name} ${j.slug} ${nextText(j)}`
      onChooseItem = (j: JobView) => open(j)
    })(this.app)
    modal.setPlaceholder('Which job?')
    modal.open()
  }

  /** A fuzzy list of the skills with an empty or broken slot; the pick opens the credential dialog. */
  private pickSlot(): void {
    const items = (this.snapshot?.skills ?? []).filter((s) => s.state === 'enabled').flatMap((s) => s.slots.filter((x) => x.credential === null || x.problem).map((slot) => ({ skill: s.name, slot })))
    if (!items.length) {
      new Notice(this.snapshot ? 'Every enabled skill has its credentials' : 'The wiki has not been read yet')
      return
    }
    const pick = (i: (typeof items)[number]) => this.credentialModal({ skill: i.skill, slot: i.slot.name, ...(i.slot.credential ? { name: i.slot.credential } : {}) })
    const modal = new (class extends FuzzySuggestModal<(typeof items)[number]> {
      getItems = () => items
      getItemText = (i: (typeof items)[number]) => `${i.skill} ${i.slot.name} ${i.slot.credential ?? 'missing'}`
      onChooseItem = (i: (typeof items)[number]) => pick(i)
    })(this.app)
    modal.setPlaceholder('Which skill needs a credential?')
    modal.open()
  }

  private dashboard(): DashboardView | null {
    const view = this.app.workspace.getLeavesOfType(VIEW_DASHBOARD)[0]?.view
    return view instanceof DashboardView ? view : null
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

  /** A chat backend: the jailed `harness run` when sandboxed, else Claude at the wiki root; `resume` picks a Claude session back up. */
  async backend(kind: BackendKind, resume?: string): Promise<ChatBackend> {
    if (!this.cli) throw new Error(this.problem ?? 'not ready')
    if (kind === 'sandbox') {
      const b = new HarnessRunBackend(this.cli, { sandbox: this.settings.sandbox, idleMinutes: () => this.settings.sandboxIdleMinutes })
      this.sandboxChats.add(b)
      return b
    }
    if (!this.claudeBin) throw new Error('claude not found on the login shell PATH; set its path in the plugin settings, or turn on the sandbox')
    return new ClaudeSdkBackend({ claudePath: this.claudeBin, path: await effectivePath() }, resume)
  }

  /** The models the harness offered on the first turn of this run; empty before it. */
  models: ModelChoice[] = []

  /** The chat slash skills, read once per run; New chat does not re-read the disk. */
  private skillList: Promise<SkillEntry[]> | null = null
  chatSkills(): Promise<SkillEntry[]> {
    this.skillList ??= pluginDirs().then(listSkills).catch(() => [])
    return this.skillList
  }

  /** Opens the Chat tab; with text, the composer is filled and focused so one click starts the conversation. */
  async openChat(prefill?: string): Promise<void> {
    const view = await this.openDashboard('chat')
    if (prefill && view) view.chat.prefill(prefill)
  }
}
