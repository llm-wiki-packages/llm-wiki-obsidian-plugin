import { PluginSettingTab, Setting, type App } from 'obsidian'
import type LlmWikiPlugin from './main'

export type ChatMode = 'agent' | 'safe'

export interface LlmWikiSettings {
  /** Absolute path of `llm-wiki-cli`; empty means search the login shell's PATH. */
  cliPath: string
  /** Absolute path of `claude`; empty means search the login shell's PATH. */
  claudePath: string
  /** A registered wiki key, when the vault's path does not match the registry (a symlink, a subfolder). */
  wikiKey: string
  defaultChatMode: ChatMode
  /** Agent mode: a model name passed to the harness, or empty for its own default. */
  model: string
  /** Safe mode: the enabled sandbox the jailed session composes. */
  safeSandbox: string
  /** Safe mode: the skill the jailed session runs. */
  safeSkill: string
  searchK: number
  debug: boolean
}

export const DEFAULT_SETTINGS: LlmWikiSettings = {
  cliPath: '',
  claudePath: '',
  wikiKey: '',
  defaultChatMode: 'agent',
  model: '',
  safeSandbox: 'read-search',
  safeSkill: 'llm-wiki:search',
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
      .setDesc('Empty searches the login shell PATH. Found: ' + (this.plugin.claudeBin ?? 'not found'))
      .addText((t) => t.setPlaceholder('Auto').setValue(s.claudePath).onChange((v) => { s.claudePath = v.trim(); save() }))

    new Setting(containerEl).setName('Chat').setHeading()
    new Setting(containerEl)
      .setName('Default mode')
      .setDesc('Agent runs unjailed at the wiki root with its hooks, and asks before each tool it would prompt for. Safe runs one jailed, read-only question per turn.')
      .addDropdown((d) => d.addOptions({ agent: 'Agent', safe: 'Safe' }).setValue(s.defaultChatMode).onChange((v) => { s.defaultChatMode = v as ChatMode; save() }))
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Agent mode. Empty uses the harness default.')
      .addText((t) => t.setPlaceholder('Default').setValue(s.model).onChange((v) => { s.model = v.trim(); save() }))
    new Setting(containerEl)
      .setName('Safe mode sandbox')
      .setDesc('An enabled sandbox of the wiki; seed and enable read-search if the wiki lacks one.')
      .addText((t) => t.setValue(s.safeSandbox).onChange((v) => { s.safeSandbox = v.trim() || DEFAULT_SETTINGS.safeSandbox; save() }))
    new Setting(containerEl)
      .setName('Safe mode skill')
      .addText((t) => t.setValue(s.safeSkill).onChange((v) => { s.safeSkill = v.trim() || DEFAULT_SETTINGS.safeSkill; save() }))

    new Setting(containerEl).setName('Search').setHeading()
    new Setting(containerEl)
      .setName('Results per search')
      .addSlider((sl) => sl.setLimits(5, 100, 5).setValue(s.searchK).onChange((v) => { s.searchK = v; save() }))

    new Setting(containerEl).setName('Diagnostics').setHeading()
    new Setting(containerEl)
      .setName('Debug logging')
      .setDesc('Log every CLI call and harness stderr line to the developer console.')
      .addToggle((t) => t.setValue(s.debug).onChange((v) => { s.debug = v; save() }))
  }
}
