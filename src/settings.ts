import { PluginSettingTab, Setting, type App, type SettingDefinitionItem } from 'obsidian'
import type LlmWikiPlugin from './main'
import { PLUGIN_NAMESPACE } from './chat/skills'
import type { SearchFilter } from './wiki/cli'
import type { GroupBy } from './vault/groups'

/** The Agent SDK's permission modes a person picks between; `plan` and `dontAsk` are not offered. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions'
export type Effort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** What happens to edits made in this vault when no runner sweeps them. */
export type SaveHistory = 'off' | 'commit' | 'sync'

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
  /** The search pane's filters, kept across searches and restarts. */
  searchFilters: SearchFilter[]
  /** Commit edits made here (and push them) when no runner on this machine does. */
  saveHistory: SaveHistory
  /** A note made in Obsidian starts from the wiki's template for its folder. */
  applyTemplates: boolean
  /** A page's Properties panel leads with the keys a person writes and folds the wiki's bookkeeping behind More. */
  tidyProperties: boolean
  /** How the Changes tab groups what came in, and past how many a group folds to one row. */
  changesGroup: GroupBy
  changesCollapse: number
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
  searchFilters: [],
  saveHistory: 'commit',
  applyTemplates: true,
  tidyProperties: true,
  changesGroup: 'source',
  changesCollapse: 5,
  debug: false,
}

export const SAVE_HISTORY_NAMES: Record<SaveHistory, string> = { off: 'Off', commit: 'Save on this machine', sync: 'Save and sync to other machines' }

export const PERMISSION_NAMES: Record<PermissionMode, string> = {
  default: 'Ask first',
  acceptEdits: 'Auto-accept edits',
  auto: 'Auto',
  bypassPermissions: 'Full access',
}

export const EFFORT_NAMES: Record<Effort, string> = { '': 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

function cliWords(p: LlmWikiPlugin): string {
  return `Empty searches the login shell PATH. Found: ${p.cliBin ?? (p.problem ? 'not found' : 'still looking…')}`
}

function claudeWords(p: LlmWikiPlugin): string {
  return `Empty searches the login shell PATH. ${p.claudeBin ? `Found: ${p.claudeBin}` : p.problem || p.wiki ? 'Not found: chat needs it unless it runs in the sandbox; the dashboard works without it.' : 'Still looking…'}`
}

/** A key a setting control writes, and how a typed value is cleaned before it is kept. */
type Key = keyof LlmWikiSettings
const CLEAN: Partial<Record<Key, (v: unknown) => unknown>> = {
  wikiKey: (v) => String(v).trim(),
  cliPath: (v) => String(v).trim(),
  claudePath: (v) => String(v).trim(),
  sandbox: (v) => String(v).trim() || DEFAULT_SETTINGS.sandbox,
  sandboxIdleMinutes: (v) => {
    const n = Math.trunc(Number(v))
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SETTINGS.sandboxIdleMinutes
  },
  model: (v) => String(v).trim(),
  defaultSkill: (v) => String(v).trim().replace(/^\//, ''),
}

export class LlmWikiSettingTab extends PluginSettingTab {
  /** Rows whose description is what detection found, redrawn when it finishes; a row no longer on screen drops out. */
  private readonly following = new Set<{ setting: Setting; text: () => string }>()

  constructor(
    app: App,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(app, plugin)
    // The tab can be drawn before detection finishes (at launch, or on Re-detect), and its words would stay "detecting…".
    plugin.registerEvent(app.workspace.on('llm-wiki:detected' as 'layout-change', () => {
      for (const f of this.following) {
        if (f.setting.settingEl.isConnected) f.setting.setDesc(f.text())
        else this.following.delete(f)
      }
    }))
  }

  /** Keep a row's description current with detection. */
  private follow(setting: Setting, text: () => string): void {
    setting.setDesc(text())
    this.following.add({ setting, text })
  }

  /** The settings, declared once: Obsidian 1.13+ renders and indexes them for search; `display` draws them before that. */
  getSettingDefinitions(): SettingDefinitionItem<Key>[] {
    const p = this.plugin
    return [
      { type: 'group', heading: 'Wiki', items: [
        { name: 'Wiki key', desc: 'Leave empty to match the vault against the machine registry. Set it when the vault is reached through a symlink or is not the wiki root.', control: { type: 'text', key: 'wikiKey', placeholder: 'Auto' } },
        { name: 'Status', desc: p.statusText(), render: (setting) => {
          this.follow(setting, () => p.statusText())
          setting.addButton((b) => b.setButtonText('Re-detect').onClick(() => void p.detect()))
        } },
        { name: 'Wiki config', desc: 'These settings are this plugin’s, kept in this vault. The wiki’s own (templates, search, jobs, transcription) are on the dashboard under More › Config.', render: (setting) => {
          setting.addButton((b) => b.setButtonText('Open config').onClick(() => p.openConfig()))
        } },
      ] },
      { type: 'group', heading: 'Binaries', items: [
        { name: 'Path to llm-wiki-cli', desc: cliWords(p), control: { type: 'text', key: 'cliPath', placeholder: 'Auto' } },
        { name: 'Path to Claude', desc: claudeWords(p), control: { type: 'text', key: 'claudePath', placeholder: 'Auto' } },
      ] },
      { type: 'group', heading: 'Chat', items: [
        { name: 'New chats start with these', desc: 'The controls under the chat box change the same settings.' },
        { name: 'Permissions', desc: 'When the agent asks before a tool. Ask first asks before edits and commands that change something, and runs the wiki’s lookups without asking; Auto lets a classifier approve routine ones; Full access never asks.', control: { type: 'dropdown', key: 'permissionMode', options: PERMISSION_NAMES } },
        { name: 'Read-only', desc: 'The wiki’s commands refuse every write, and the agent gets no file-editing tools. A shell command can still write a file, so pair it with Ask first.', control: { type: 'toggle', key: 'readOnly' } },
        { name: 'Sandbox', desc: 'The chat runs jailed in the named sandbox, which must be enabled in the wiki. It never asks, and it keeps the conversation until it closes. The sandbox decides whether it may write.', control: { type: 'toggle', key: 'sandboxed' } },
        { name: 'Sandbox name', desc: 'Which of the wiki’s sandboxes a sandboxed chat runs in.', control: { type: 'text', key: 'sandbox', placeholder: DEFAULT_SETTINGS.sandbox } },
        { name: 'Sandboxed chat closes after', desc: 'Minutes with no turn running. A closed chat starts a new session on the next message and does not remember the earlier turns.', control: { type: 'text', key: 'sandboxIdleMinutes', placeholder: String(DEFAULT_SETTINGS.sandboxIdleMinutes) } },
        { name: 'Model', desc: 'A model name or alias (opus, sonnet); empty uses Claude Code’s default.', control: { type: 'text', key: 'model', placeholder: 'Default' } },
        { name: 'Effort', control: { type: 'dropdown', key: 'effort', options: EFFORT_NAMES } },
        { name: 'Default skill', desc: `A new chat’s box starts with this skill typed in, e.g. ${PLUGIN_NAMESPACE}:search, so you see what runs and can delete it. Empty starts blank.`, control: { type: 'text', key: 'defaultSkill', placeholder: 'None' } },
        { name: 'Skill completion', desc: 'Typing / at the start of a line lists the skills.', control: { type: 'toggle', key: 'slashComplete' } },
      ] },
      { type: 'group', heading: 'Edits', items: [
        { name: 'Save edits to history', desc: p.snapshot?.runner
          ? 'A runner on this machine commits and syncs this wiki; this setting waits until it is uninstalled.'
          : 'Commits what you edit here a couple of minutes after you stop, so it shows in Changes and page history. Sync also pulls and pushes, so your other machines see it; it is refused while Obsidian Sync or iCloud syncs this vault.', control: { type: 'dropdown', key: 'saveHistory', options: SAVE_HISTORY_NAMES } },
        { name: 'Apply the wiki’s template to new notes', desc: 'A note made in Obsidian starts with the properties the wiki’s template for that folder gives, as a page the agent makes does. Turn it off if Templater fills new notes.', control: { type: 'toggle', key: 'applyTemplates' } },
        { name: 'Fold the wiki’s bookkeeping properties', desc: 'A page’s Properties lead with title, type, description and tags; the keys the wiki keeps for itself (document_id, its revision, when it was made and checked) go last, behind a More row. Nothing in the file changes.', control: { type: 'toggle', key: 'tidyProperties' } },
      ] },
      { type: 'group', heading: 'Search', items: [
        { name: 'Results per search', control: { type: 'slider', key: 'searchK', min: 5, max: 100, step: 5 } },
      ] },
      { type: 'group', heading: 'Diagnostics', items: [
        { name: 'Debug logging', desc: 'Log every CLI call (verb, exit code, duration), chat event, link click and harness stderr line to the developer console, prefixed [llm-wiki]. They are debug-level lines: in the console (Cmd-Option-I), set the level filter to include Verbose, or they stay hidden.', control: { type: 'toggle', key: 'debug' } },
      ] },
    ]
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as Key]
  }

  setControlValue(key: string, value: unknown): Promise<void> {
    const clean = CLEAN[key as Key]
    ;(this.plugin.settings as unknown as Record<string, unknown>)[key] = clean ? clean(value) : value
    if (key === 'tidyProperties') this.plugin.properties.apply()
    return this.plugin.saveSettings()
  }

  /**
   * Obsidian before 1.13 has no declarative settings, and this plugin still supports it
   * (`minAppVersion`); 1.13+ never calls this while the definitions are non-empty.
   */
  display(): void {
    this.containerEl.empty()
    renderDefinitions(this.containerEl, this.getSettingDefinitions(), this)
  }
}

/** The definitions drawn the pre-1.13 way: a heading per group, a `Setting` per item. */
function renderDefinitions(el: HTMLElement, items: SettingDefinitionItem<Key>[], tab: LlmWikiSettingTab): void {
  for (const item of items) {
    if ('type' in item) {
      if (item.type === 'page') continue
      if (item.heading) new Setting(el).setName(item.heading).setHeading()
      renderDefinitions(el, item.items ?? [], tab)
      continue
    }
    const setting = new Setting(el).setName(item.name)
    if (item.desc) setting.setDesc(item.desc)
    if (item.render) {
      item.render(setting, undefined as never)
      continue
    }
    const c = item.control
    if (!c) continue
    const value = tab.getControlValue(c.key)
    const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
    const set = (v: unknown) => void tab.setControlValue(c.key, v)
    switch (c.type) {
      case 'text':
        setting.addText((t) => t.setPlaceholder(c.placeholder ?? '').setValue(text).onChange(set))
        break
      case 'toggle':
        setting.addToggle((t) => t.setValue(Boolean(value)).onChange(set))
        break
      case 'dropdown':
        setting.addDropdown((d) => d.addOptions(c.options).setValue(text).onChange(set))
        break
      case 'slider':
        setting.addSlider((sl) => sl.setLimits(c.min, c.max, c.step).setValue(Number(value)).onChange(set))
        break
    }
  }
}
