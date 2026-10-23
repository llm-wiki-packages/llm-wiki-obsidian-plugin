import { FileSystemAdapter, Notice, Plugin, type WorkspaceLeaf } from 'obsidian'
import { ClaudeSdkBackend } from './chat/claudeSdk'
import { HarnessRunBackend } from './chat/harnessRun'
import type { ChatBackend, WikiTarget } from './chat/types'
import { log } from './logger'
import { DEFAULT_SETTINGS, LlmWikiSettingTab, type ChatMode, type LlmWikiSettings } from './settings'
import { ChatView, VIEW_CHAT } from './views/chat'
import { SearchView, VIEW_SEARCH } from './views/search'
import { Cli, type WikiRow } from './wiki/cli'
import { effectivePath, findBinary, matchWiki } from './wiki/resolve'

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS
  cli: Cli | null = null
  cliBin: string | null = null
  claudeBin: string | null = null
  wiki: WikiTarget | null = null
  /** Why the plugin is not ready, or null when it is. */
  problem: string | null = null
  private statusBar: HTMLElement | null = null

  async onload(): Promise<void> {
    await this.loadSettings()
    log.setDebug(this.settings.debug)
    this.addSettingTab(new LlmWikiSettingTab(this.app, this))
    this.registerView(VIEW_SEARCH, (leaf) => new SearchView(leaf, this))
    this.registerView(VIEW_CHAT, (leaf) => new ChatView(leaf, this))
    this.addRibbonIcon('message-square', 'Open LLM wiki chat', () => void this.activateView(VIEW_CHAT))
    this.addCommand({ id: 'open-chat', name: 'Open chat', callback: () => void this.activateView(VIEW_CHAT) })
    this.addCommand({ id: 'open-search', name: 'Open search', callback: () => void this.activateView(VIEW_SEARCH) })
    this.addCommand({ id: 'redetect', name: 'Re-detect wiki and binaries', callback: () => void this.detect(true) })
    this.statusBar = this.addStatusBarItem()
    this.app.workspace.onLayoutReady(() => void this.detect())
  }

  onunload(): void {
    this.cli?.killStreams()
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
    } catch (e) {
      this.problem = e instanceof Error ? e.message : String(e)
      log.warn(this.problem)
    }
    this.statusBar?.setText(this.wiki ? `llm-wiki: ${this.wiki.key}` : 'llm-wiki: not ready')
    if (announce) new Notice(this.statusText())
    this.app.workspace.trigger('llm-wiki:detected')
  }

  /** The chat backend for a mode, built fresh so settings changes apply. */
  async backend(mode: ChatMode): Promise<ChatBackend> {
    if (!this.cli) throw new Error(this.problem ?? 'not ready')
    if (mode === 'safe') {
      return new HarnessRunBackend(this.cli, {
        sandbox: this.settings.safeSandbox,
        skill: this.settings.safeSkill,
        model: this.settings.model || undefined,
      })
    }
    if (!this.claudeBin) throw new Error('claude not found on the login shell PATH; set its path in the plugin settings')
    return new ClaudeSdkBackend({ claudePath: this.claudeBin, path: await effectivePath(), model: this.settings.model || undefined })
  }

  async activateView(type: string): Promise<void> {
    const { workspace } = this.app
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)
      if (!leaf) return
      await leaf.setViewState({ type, active: true })
    }
    await workspace.revealLeaf(leaf)
  }
}
