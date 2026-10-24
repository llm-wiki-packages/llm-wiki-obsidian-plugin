import { PluginSettingTab, Setting, type App } from 'obsidian'
import type LlmWikiPlugin from './main'

/** The Agent SDK's permission modes a person picks between; `plan` and `dontAsk` are not offered. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'
export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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
  /** How the unsandboxed chat asks before a tool. */
  permissionMode: PermissionMode
  /** The wiki's CLI refuses writes, and the agent gets no file-editing tools. */
  readOnly: boolean
  /** The chat runs jailed through `harness run`, in `sandbox`. */
  sandboxed: boolean
  sandbox: string
  /** The sandboxed chat closes its session after this many minutes with no turn running. */
  sandboxIdleMinutes: number
  /** A model name handed to the harness, or empty for its own default. */
  model: string
  effort: Effort
  /** A skill a new chat's composer starts with, as `name` of `/name`; empty starts blank. */
  defaultSkill: string
  /** Typing `/` lists the skills. */
  slashComplete: boolean
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
  permissionMode: 'default',
  readOnly: false,
  sandboxed: false,
  sandbox: 'read-search',
  sandboxIdleMinutes: 60,
  model: '',
  effort: '',
  defaultSkill: '',
  slashComplete: true,
  searchK: 20,
  debug: false,
}

export const PERMISSION_NAMES: Record<PermissionMode, string> = {
  default: 'Ask first',
  acceptEdits: 'Auto-accept edits',
  auto: 'Auto',
  bypassPermissions: 'Full access',
}

export const EFFORT_NAMES: Record<Effort, string> = { '': 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

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
      .setDesc('Empty searches the login shell PATH. ' + (this.plugin.claudeBin ? `Found: ${this.plugin.claudeBin}` : 'Not found: chat needs it unless it runs in the sandbox; the dashboard works without it.'))
      .addText((t) => t.setPlaceholder('Auto').setValue(s.claudePath).onChange((v) => { s.claudePath = v.trim(); save() }))

    new Setting(containerEl).setName('Chat').setHeading()
    containerEl.createEl('p', { cls: 'setting-item-description', text: 'The defaults a chat starts with. The controls under the chat box change the same settings.' })
    new Setting(containerEl)
      .setName('Permissions')
      .setDesc('When the agent asks before a tool. Ask first asks before each command and edit; Auto lets a classifier approve routine ones; Full access never asks.')
      .addDropdown((d) => d.addOptions(PERMISSION_NAMES).setValue(s.permissionMode).onChange((v) => { s.permissionMode = v as PermissionMode; save() }))
    new Setting(containerEl)
      .setName('Read-only')
      .setDesc('The wiki’s commands refuse every write, and the agent gets no file-editing tools. A shell command can still write a file, so pair it with Ask first.')
      .addToggle((t) => t.setValue(s.readOnly).onChange((v) => { s.readOnly = v; save() }))
    new Setting(containerEl)
      .setName('Sandbox')
      .setDesc('The chat runs jailed in the named sandbox, which must be enabled in the wiki. It never asks, and it keeps the conversation until it closes. The sandbox decides whether it may write.')
      .addToggle((t) => t.setValue(s.sandboxed).onChange((v) => { s.sandboxed = v; save() }))
      .addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.sandbox).setValue(s.sandbox).onChange((v) => { s.sandbox = v.trim() || DEFAULT_SETTINGS.sandbox; save() }))
    new Setting(containerEl)
      .setName('Sandboxed chat closes after')
      .setDesc('Minutes with no turn running. A closed chat starts a new session on the next message and does not remember the earlier turns.')
      .addText((t) => t.setPlaceholder(String(DEFAULT_SETTINGS.sandboxIdleMinutes)).setValue(String(s.sandboxIdleMinutes)).onChange((v) => {
        const n = Math.trunc(Number(v))
        s.sandboxIdleMinutes = Number.isFinite(n) && n > 0 ? n : DEFAULT_SETTINGS.sandboxIdleMinutes
        save()
      }))
    new Setting(containerEl)
      .setName('Model')
      .setDesc('A model name or alias (opus, sonnet); empty uses Claude Code’s default.')
      .addText((t) => t.setPlaceholder('Default').setValue(s.model).onChange((v) => { s.model = v.trim(); save() }))
    new Setting(containerEl)
      .setName('Effort')
      .addDropdown((d) => d.addOptions(EFFORT_NAMES).setValue(s.effort).onChange((v) => { s.effort = v as Effort; save() }))
    new Setting(containerEl)
      .setName('Default skill')
      .setDesc('A new chat’s box starts with this skill typed in, e.g. llm-wiki:search, so you see what runs and can delete it. Empty starts blank.')
      .addText((t) => t.setPlaceholder('None').setValue(s.defaultSkill).onChange((v) => { s.defaultSkill = v.trim().replace(/^\//, ''); save() }))
    new Setting(containerEl)
      .setName('Skill completion')
      .setDesc('Typing / at the start of a line lists the skills.')
      .addToggle((t) => t.setValue(s.slashComplete).onChange((v) => { s.slashComplete = v; save() }))

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
