import { PluginSettingTab, Setting, type App } from 'obsidian'
import type LlmWikiPlugin from './main'

export type ChatMode = 'agent' | 'ask'

export interface LlmWikiSettings {
  /** Absolute path of `llm-wiki-cli`; empty means search the login shell's PATH. */
  cliPath: string
  /** Absolute path of `claude`; empty means search the login shell's PATH. */
  claudePath: string
  /** The last Agent session, so a closed pane can pick the thread back up. */
  lastSession: string
  /** What that session was last asked, so Continue says what it continues. */
  lastPrompt: string
  /** The last detect outcome, so the launch Notice fires only when it changes. */
  lastDetect: string
  /** A registered wiki key, when the vault's path does not match the registry (a symlink, a subfolder). */
  wikiKey: string
  defaultChatMode: ChatMode
  /** Agent mode: a model name passed to the harness, or empty for its own default. */
  model: string
  /** Ask mode: the enabled sandbox the jailed session composes. */
  askSandbox: string
  /** Ask mode: the skill the jailed session runs. */
  askSkill: string
  searchK: number
  debug: boolean
}

export const DEFAULT_SETTINGS: LlmWikiSettings = {
  cliPath: '',
  claudePath: '',
  lastSession: '',
  lastPrompt: '',
  lastDetect: '',
  wikiKey: '',
  defaultChatMode: 'agent',
  model: '',
  askSandbox: 'read-search',
  askSkill: 'llm-wiki:search',
  searchK: 20,
  debug: false,
}

export class LlmWikiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(app, plugin)
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    const s = this.plugin.settings
    const save = () => void this.plugin.saveSettings()

    new Setting(containerEl).setName('Wiki').setHeading()
    new Setting(containerEl)
      .setName('Wiki key')
      .setDesc('Leave empty to match the vault against the machine registry. Set it when the vault is reached through a symlink or is not the wiki root.')
      .addText((t) => t.setPlaceholder('Auto').setValue(s.wikiKey).onChange((v) => { s.wikiKey = v.trim(); save() }))
    new Setting(containerEl)
      .setName('Status')
      .setDesc(this.plugin.statusText())
      .addButton((b) => b.setButtonText('Re-detect').onClick(() => void this.plugin.detect().then(() => this.display())))

    new Setting(containerEl).setName('Binaries').setHeading()
    new Setting(containerEl)
      .setName('Path to llm-wiki-cli')
      .setDesc('Empty searches the login shell PATH. Found: ' + (this.plugin.cliBin ?? 'not found'))
      .addText((t) => t.setPlaceholder('Auto').setValue(s.cliPath).onChange((v) => { s.cliPath = v.trim(); save() }))
    new Setting(containerEl)
      .setName('Path to claude')
      .setDesc('Empty searches the login shell PATH. ' + (this.plugin.claudeBin ? `Found: ${this.plugin.claudeBin}` : 'Not found: Agent chat needs it; Ask mode and the dashboard work without it.'))
      .addText((t) => t.setPlaceholder('Auto').setValue(s.claudePath).onChange((v) => { s.claudePath = v.trim(); save() }))

    new Setting(containerEl).setName('Chat').setHeading()
    new Setting(containerEl)
      .setName('Default mode')
      .setDesc('Agent runs at the wiki root with its hooks, can run jobs and edit pages, and asks before each tool it would prompt for. Ask runs one jailed, read-only question per turn.')
      .addDropdown((d) => d.addOptions({ agent: 'Agent', ask: 'Ask' }).setValue(s.defaultChatMode).onChange((v) => { s.defaultChatMode = v as ChatMode; save() }))
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Passed to both chat modes; empty uses each harness’s default.')
      .addText((t) => t.setPlaceholder('Default').setValue(s.model).onChange((v) => { s.model = v.trim(); save() }))
    new Setting(containerEl)
      .setName('Ask mode sandbox')
      .setDesc('An enabled sandbox of the wiki; seed and enable read-search if the wiki lacks one.')
      .addText((t) => t.setValue(s.askSandbox).onChange((v) => { s.askSandbox = v.trim() || DEFAULT_SETTINGS.askSandbox; save() }))
    new Setting(containerEl)
      .setName('Ask mode skill')
      .addText((t) => t.setValue(s.askSkill).onChange((v) => { s.askSkill = v.trim() || DEFAULT_SETTINGS.askSkill; save() }))

    new Setting(containerEl).setName('Search').setHeading()
    new Setting(containerEl)
      .setName('Results per search')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.searchK).onChange((v) => { s.searchK = v; save() }))

    new Setting(containerEl).setName('Diagnostics').setHeading()
    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Log every CLI call (verb, exit code, duration), chat event, link click and harness stderr line to the developer console, prefixed [llm-wiki]. They are debug-level lines: in the console (Cmd-Option-I), set the level filter to include Verbose, or they stay hidden.')
      .addToggle((t) => t.setValue(s.debug).onChange((v) => { s.debug = v; save() }))
  }
}
