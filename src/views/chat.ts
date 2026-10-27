import { Component, MarkdownRenderer, Notice, setIcon, type App, type TFile } from 'obsidian'
import { describeTool } from '../chat/describe'
import { skillsButtonLabel } from '../chat/skills'
import type { BackendKind, ChatBackend, ChatEvent, ModelChoice, PermissionDecision, PermissionRequest } from '../chat/types'
import { log } from '../logger'
import { wireLinks } from '../ui/links'
import type LlmWikiPlugin from '../main'
import { isFeed } from '../wiki/layout'
import { EFFORT_NAMES, PERMISSION_NAMES, type Effort, type PermissionMode } from '../settings'
import { choiceRow, ContextRing, openPopover, permissionLabel, SlashMenu, switchRow } from './composer'
import { ToolGroupView, type ToolRowView } from './toolRows'

/** Tools after which the wiki may have changed. */
const WRITE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const PERMISSION_DESC: Record<PermissionMode, string> = {
  default: 'Asks before an edit or a command that changes something. Reading pages and the wiki’s lookups run without asking.',
  acceptEdits: 'Edits pages without asking; asks before commands.',
  auto: 'A classifier approves routine actions and asks about the rest.',
  bypassPermissions: 'Runs commands and edits without asking.',
}
const PERMISSION_ICON: Record<PermissionMode, string> = { default: 'lock', acceptEdits: 'pencil', auto: 'sparkles', bypassPermissions: 'lock-open' }

/** Before the harness names its models, the aliases every Claude Code knows. */
const ALIASES: ModelChoice[] = [
  { value: 'opus', name: 'Opus' },
  { value: 'sonnet', name: 'Sonnet' },
  { value: 'haiku', name: 'Haiku' },
]

/** The chat pane: lives inside the dashboard's Chat tab, built once and kept across tab switches. */
export class ChatPane extends Component {
  private transcript!: HTMLElement
  private composer!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private status!: HTMLElement
  private chips!: HTMLElement
  private continueBtn!: HTMLButtonElement
  private permBtn!: HTMLButtonElement
  private modelBtn!: HTMLButtonElement
  private effortBtn!: HTMLButtonElement
  private ring!: ContextRing
  private slash!: SlashMenu
  /** The last tool the agent called, so a refresh follows a write and not every Read. */
  private lastTool = ''
  private hint!: HTMLElement
  /** One backend per kind, so turning the sandbox on and off again keeps the Claude session. */
  private backends: Partial<Record<BackendKind, ChatBackend>> = {}
  /** The kind the last turn ran in, to say so when the next one differs. */
  private lastKind: BackendKind | null = null
  private running: AbortController | null = null
  /** Rendered turns hold a Component each while on screen; New chat releases them. */
  private bubbles: AssistantBubble[] = []

  private get app(): App {
    return this.plugin.app
  }

  private get settings() {
    return this.plugin.settings
  }

  private get kind(): BackendKind {
    return this.settings.sandboxed ? 'sandbox' : 'claude'
  }

  constructor(
    private readonly plugin: LlmWikiPlugin,
    private readonly root: HTMLElement,
  ) {
    super()
  }

  onload(): void {
    const root = this.root
    root.empty()
    root.addClass('llm-wiki-chat')

    // New chat sits alone up here for now; a list of past chats will join it.
    const bar = root.createDiv({ cls: 'llm-wiki-chat-bar' })
    const newBtn = bar.createEl('button', { cls: 'llm-wiki-new-chat', attr: { 'aria-label': 'Start an empty chat' } })
    setIcon(newBtn.createSpan(), 'square-pen')
    newBtn.createSpan({ text: 'New chat' })
    this.registerDomEvent(newBtn, 'click', () => this.newChat())
    this.continueBtn = bar.createEl('button', { text: 'Continue last chat' })
    this.registerDomEvent(this.continueBtn, 'click', () => this.continueLast())
    this.status = bar.createDiv({ cls: 'llm-wiki-muted llm-wiki-chat-status' })

    this.transcript = root.createDiv({ cls: 'llm-wiki-transcript' })
    wireLinks(this.transcript, this.app, (el, ev, fn) => this.registerDomEvent(el, ev, fn))
    this.hint = this.transcript.createDiv({ cls: 'llm-wiki-note llm-wiki-muted llm-wiki-hint' })
    this.chips = root.createDiv({ cls: 'llm-wiki-chips' })

    const composer = root.createDiv({ cls: 'llm-wiki-composer' })
    this.composer = composer.createEl('textarea', { placeholder: 'Ask the wiki, or ask the agent to do something…', cls: 'llm-wiki-composer-input' })
    this.composer.rows = 3
    this.slash = new SlashMenu(composer, this.composer, () => this.plugin.chatSkills(), () => this.settings.slashComplete)

    const row = composer.createDiv({ cls: 'llm-wiki-composer-row' })
    const skillsBtn = row.createEl('button', { text: 'Skills…', attr: { 'aria-label': skillsButtonLabel() } })
    this.registerDomEvent(skillsBtn, 'click', () => this.plugin.pickSkill())
    this.permBtn = row.createEl('button', { cls: 'llm-wiki-control' })
    this.registerDomEvent(this.permBtn, 'click', () => this.openPermissions())
    this.modelBtn = row.createEl('button', { cls: 'llm-wiki-control' })
    this.registerDomEvent(this.modelBtn, 'click', () => this.openModels())
    this.effortBtn = row.createEl('button', { cls: 'llm-wiki-control' })
    this.registerDomEvent(this.effortBtn, 'click', () => this.openEfforts())
    // The ring and Send stay together at the right when the row wraps.
    const end = row.createDiv({ cls: 'llm-wiki-composer-end' })
    this.ring = new ContextRing(end)
    this.sendBtn = end.createEl('button', { cls: 'mod-cta llm-wiki-send' })
    this.registerDomEvent(this.sendBtn, 'click', () => (this.running ? this.running.abort() : void this.send()))

    this.registerDomEvent(this.composer, 'input', () => this.slash.update())
    this.registerDomEvent(this.composer, 'click', () => this.slash.update())
    this.registerDomEvent(this.composer, 'blur', () => this.slash.close())
    this.registerDomEvent(this.composer, 'keydown', (e) => {
      if (this.slash.key(e)) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.send()
      }
      if (e.key === 'Escape' && this.running) this.running.abort()
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.showChips()))
    this.app.workspace.onLayoutReady(() => this.registerEvent(this.app.vault.on('create', () => this.showChips())))
    this.showReadiness()
    this.showChips()
    this.showControls()
    this.showSend()
    this.startWithSkill()
  }

  focus(): void {
    this.composer.focus()
  }

  /** A new chat's box holds the default skill, typed out, so what runs is on screen and one backspace away. */
  private startWithSkill(): void {
    const skill = this.settings.defaultSkill
    this.composer.value = skill ? `/${skill} ` : ''
  }

  private save(): void {
    void this.plugin.saveSettings()
    this.showControls()
  }

  /** The buttons under the box say the settings the next turn runs with. */
  private showControls(): void {
    const s = this.settings
    this.permBtn.empty()
    setIcon(this.permBtn.createSpan(), s.sandboxed ? 'box' : PERMISSION_ICON[s.permissionMode])
    this.permBtn.createSpan({ text: permissionLabel(s) })
    setIcon(this.permBtn.createSpan({ cls: 'llm-wiki-caret' }), 'chevron-down')
    this.modelBtn.empty()
    this.modelBtn.createSpan({ text: this.modelName(s.model) })
    setIcon(this.modelBtn.createSpan({ cls: 'llm-wiki-caret' }), 'chevron-down')
    this.effortBtn.empty()
    setIcon(this.effortBtn.createSpan(), 'gauge')
    this.effortBtn.createSpan({ text: s.effort ? EFFORT_NAMES[s.effort] : 'Effort' })
    setIcon(this.effortBtn.createSpan({ cls: 'llm-wiki-caret' }), 'chevron-down')

    const empty = this.transcript.childElementCount <= 1
    this.continueBtn.toggle(Boolean(s.lastSession && this.plugin.claudeBin && !s.sandboxed) && empty && !this.backends.claude)
    if (s.lastPrompt) this.continueBtn.title = `Continuing: ${s.lastPrompt}`
    this.hint.setText(
      this.plugin.claudeBin || s.sandboxed
        ? 'Ask about the wiki, or tell the agent what to do. Type / for a skill.'
        : 'Chat needs claude: set its path in the plugin settings, or turn on the sandbox under the box.',
    )
    this.hint.toggle(empty)
  }

  private modelName(value: string): string {
    if (!value) return 'Default model'
    return [...this.plugin.models, ...ALIASES].find((m) => m.value === value)?.name ?? value
  }

  /** Everything that decides what the agent may do, in one panel. */
  private openPermissions(): void {
    const s = this.settings
    openPopover(this.permBtn, (el, close) => {
      for (const mode of Object.keys(PERMISSION_NAMES) as PermissionMode[]) {
        const noAuto = mode === 'auto' && this.currentModel()?.auto === false
        choiceRow(el, {
          title: PERMISSION_NAMES[mode],
          desc: noAuto ? 'This model has no Auto mode.' : PERMISSION_DESC[mode],
          icon: PERMISSION_ICON[mode],
          checked: !s.sandboxed && s.permissionMode === mode,
          disabled: s.sandboxed || noAuto,
          pick: () => {
            s.permissionMode = mode
            this.save()
          },
        }, close)
      }
      el.createDiv({ cls: 'llm-wiki-popover-rule' })
      switchRow(el, 'Read-only', s.sandboxed ? 'The sandbox decides whether it writes.' : 'Wiki commands refuse writes, and the agent cannot edit files. A shell command still can, unless Ask first stops it.', s.readOnly && !s.sandboxed, s.sandboxed, (on) => {
        s.readOnly = on
        this.save()
      })
      const box = switchRow(el, 'Sandbox', `Runs jailed and never asks. It keeps the conversation, and closes after ${String(s.sandboxIdleMinutes)} minutes idle (set in settings).`, s.sandboxed, false, (on) => {
        s.sandboxed = on
        this.save()
        close()
        this.openPermissions()
      })
      if (s.sandboxed) {
        const field = el.createDiv({ cls: 'llm-wiki-popover-field' })
        field.createSpan({ cls: 'llm-wiki-choice-desc', text: 'Name' })
        const input = field.createEl('input', { type: 'text', value: s.sandbox, attr: { 'aria-label': 'The enabled sandbox each turn runs in' } })
        input.addEventListener('change', () => {
          s.sandbox = input.value.trim() || 'read-search'
          input.value = s.sandbox
          this.save()
        })
        box.after(field)
      }
    }, 'llm-wiki-permissions')
  }

  private currentModel(): ModelChoice | undefined {
    return this.plugin.models.find((m) => m.value === this.settings.model)
  }

  private openModels(): void {
    const s = this.settings
    const list = this.plugin.models.length ? this.plugin.models : ALIASES
    const choices: ModelChoice[] = [{ value: '', name: 'Default model' }, ...list.filter((m) => m.value !== 'default')]
    if (s.model && !choices.some((m) => m.value === s.model)) choices.push({ value: s.model, name: s.model })
    openPopover(this.modelBtn, (el, close) => {
      for (const m of choices)
        choiceRow(el, {
          title: m.name,
          desc: m.value === '' ? 'Claude Code’s own default' : undefined,
          checked: s.model === m.value,
          pick: () => {
            s.model = m.value
            // A level the new model lacks would be refused; fall back to its default.
            const efforts = this.currentModel()?.efforts
            if (s.effort && efforts && !efforts.includes(s.effort)) s.effort = ''
            this.save()
          },
        }, close)
      if (!this.plugin.models.length) el.createDiv({ cls: 'llm-wiki-choice-desc llm-wiki-popover-foot', text: 'The full list shows after the first reply.' })
    })
  }

  private openEfforts(): void {
    const s = this.settings
    const supported = this.currentModel()?.efforts
    openPopover(this.effortBtn, (el, close) => {
      for (const e of Object.keys(EFFORT_NAMES) as Effort[]) {
        const unsupported = e !== '' && supported !== undefined && !supported.includes(e)
        choiceRow(el, {
          title: EFFORT_NAMES[e],
          desc: e === '' ? 'The model’s own default' : unsupported ? 'Not offered by this model' : undefined,
          checked: s.effort === e,
          disabled: unsupported,
          pick: () => {
            s.effort = e
            this.save()
          },
        }, close)
      }
    })
  }

  /** Send, or Stop while a turn runs: one button, which spins while the agent works. */
  private showSend(): void {
    const on = this.running !== null
    this.sendBtn.empty()
    this.sendBtn.toggleClass('mod-cta', !on)
    this.sendBtn.toggleClass('is-running', on)
    setIcon(this.sendBtn.createSpan({ cls: on ? 'llm-wiki-spin' : '' }), on ? 'loader-circle' : 'arrow-up')
    this.sendBtn.createSpan({ text: on ? 'Stop' : 'Send' })
    this.sendBtn.setAttribute('aria-label', on ? 'Stop the agent (Esc)' : 'Send (Enter)')
  }

  /** Picks the last Claude session back up, so closing the pane did not lose the thread. */
  private continueLast(): void {
    const id = this.settings.lastSession
    if (!id) return
    void this.plugin.backend('claude', id).then((b) => {
      this.backends.claude = b
      const last = this.settings.lastPrompt
      this.note(last ? `Continuing: ${last.length > 120 ? `${last.slice(0, 119)}…` : last}` : 'continuing the last chat')
      this.showControls()
    }).catch((e: unknown) => this.note(e instanceof Error ? e.message : String(e)))
  }

  /** Starting points above an empty transcript: the newest source, what changed, a video to add. */
  private showChips(): void {
    this.chips.empty()
    if (this.transcript.childElementCount > 1) return
    const newest = newestSource(this.app)
    const chip = (text: string, prompt: string, title?: string) => {
      const el = this.chips.createEl('button', { cls: 'llm-wiki-chip', text, attr: title ? { title } : {} })
      // Chips are rebuilt on every leaf change; the DOM owns the listener with the node.
      el.addEventListener('click', () => this.prefill(prompt))
    }
    if (newest) chip(`Summarize ${newest}`, `Summarize ${newest}`, 'The newest page in sources')
    chip('What’s new in the wiki?', 'What’s new in the wiki?')
    chip('Add a YouTube video', 'Add this YouTube video to the wiki: ')
  }

  onunload(): void {
    this.running?.abort()
    this.slash.close()
  }

  /** Put text in the composer and focus it, for a button elsewhere that starts a conversation. */
  prefill(text: string): void {
    this.composer.value = text
    this.composer.focus()
    this.composer.setSelectionRange(text.length, text.length)
  }

  private showReadiness(): void {
    this.status.setText(this.plugin.wiki ? '' : this.plugin.problem ?? 'detecting…')
  }

  private newChat(): void {
    this.running?.abort()
    for (const b of Object.values(this.backends)) b.reset()
    this.backends = {}
    this.lastKind = null
    this.transcript.empty()
    this.transcript.appendChild(this.hint)
    for (const b of this.bubbles) b.dispose()
    this.bubbles = []
    this.ring.clear()
    this.startWithSkill()
    this.showChips()
    this.showControls()
    this.composer.focus()
  }

  /** Said in the pane rather than the console, for a hand-off that failed to start. */
  note(text: string): void {
    this.transcript.createDiv({ cls: 'llm-wiki-note llm-wiki-muted', text })
    this.scroll()
  }

  private scroll(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight
  }

  private async send(): Promise<void> {
    const prompt = this.composer.value.trim()
    if (!prompt || this.running) return
    const wiki = this.plugin.wiki
    if (!wiki) {
      this.note(this.plugin.problem ?? 'not ready')
      return
    }
    const kind = this.kind
    let backend = this.backends[kind]
    try {
      backend ??= this.backends[kind] = await this.plugin.backend(kind)
    } catch (e) {
      this.note(e instanceof Error ? e.message : String(e))
      return
    }
    // Switching mid-chat changes what the agent remembers; say so where it happens.
    if (this.lastKind && this.lastKind !== kind)
      this.note(kind === 'sandbox' ? `Sandboxed in ${this.settings.sandbox}: it does not see the chat before it.` : 'Out of the sandbox: back in the chat from before it.')
    this.lastKind = kind
    this.slash.close()
    this.chips.empty()
    this.hint.hide()
    this.continueBtn.hide()
    this.transcript.createDiv({ cls: 'llm-wiki-msg llm-wiki-user', text: prompt })
    this.composer.value = ''
    let failed = false
    let stopped = false
    const assistant = new AssistantBubble(this.transcript, this.app, this, wiki.root)
    this.bubbles.push(assistant)
    const abort = new AbortController()
    this.running = abort
    this.showSend()
    const s = this.settings
    try {
      const events = backend.send(prompt, {
        wiki,
        signal: abort.signal,
        askPermission: (req) => assistant.ask(req),
        onStderr: (chunk) => log.debug('harness stderr', chunk),
        onModels: (models) => {
          this.plugin.models = models
          this.showControls()
        },
        options: { permissionMode: s.permissionMode, readOnly: s.readOnly, model: s.model || undefined, effort: s.effort || undefined },
      })
      for await (const e of events) {
        log.debug('chat', e.type, e.type === 'tool' ? e.name : e.type === 'error' ? e.message : '')
        if (e.type === 'context') {
          this.ring.set(e.used, e.window)
          continue
        }
        assistant.take(e)
        this.scroll()
        if (e.type === 'status' && e.text === 'stopped') stopped = true
        if (e.type === 'error') failed = true
        if (e.type === 'tool') this.lastTool = e.name
        // A write just finished, so whatever it changed is on disk: a light read now, the full one when the turn ends.
        if (e.type === 'tool-done' && WRITE_TOOLS.has(this.lastTool)) void this.plugin.refreshSnapshot(true)
      }
      if (abort.signal.aborted && !stopped) assistant.take({ type: 'status', text: 'stopped' })
      if (backend.sessionId && kind === 'claude') {
        s.lastSession = backend.sessionId
        s.lastPrompt = prompt
        void this.plugin.saveSettings()
      }
    } catch (e) {
      failed = true
      assistant.take({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      assistant.finish()
      this.running = null
      this.showSend()
      // A failed turn puts the prompt back, so the retry is one keystroke, unless something new was typed meanwhile.
      if (failed && !this.composer.value.trim()) this.composer.value = prompt
      this.scroll()
      void this.plugin.refreshSnapshot()
    }
  }
}

/** The source page that came in last, by when its file was made; not a kept version. */
function newestSource(app: App): string | null {
  let best: TFile | null = null
  for (const f of app.vault.getMarkdownFiles()) {
    if (!isFeed(f.path) || f.path.includes('/_')) continue
    if (!best || f.stat.ctime > best.stat.ctime) best = f
  }
  return best?.path ?? null
}

/** An llm-wiki command in the agent's own words: "Running inbox-joe", "Reading the job list". Null for anything else. */
export function toolSentence(tool: string, detail?: string): string | null {
  if (tool !== 'Bash' || !detail) return null
  const m = /^(?:LLM_WIKI_[A-Z_]+=\S+\s+)*(?:llm-wiki-ops|llm-wiki-cli wiki(?: --read-only)? \S+)\s+(.*)$/.exec(detail.trim())
  if (!m) return null
  const words = (m[1] ?? '').replace(/\s--json\b/, '').split(/\s+/)
  const [a, b, c] = words
  const arg = c && !c.includes('=') && !c.startsWith('-') ? c : undefined
  const table: Record<string, string> = {
    'jobs request': `Running ${arg ?? 'a job'}`, 'jobs ls': 'Reading the job list', 'jobs due': 'Reading what is due', 'jobs show': `Reading job ${arg ?? ''}`, 'jobs add': 'Declaring a job', 'jobs run': 'Running the pass',
    'tickets ls': 'Reading the run list', 'tickets retry': `Retrying run ${arg ?? ''}`, 'page ls': 'Reading the page list', 'page curate': 'Curating pages', 'page adopt': 'Adopting pages',
    'search query': 'Searching the wiki', 'search index': 'Refreshing the search index', 'doctor': 'Running the doctor', 'status': 'Reading the status', 'skills ls': 'Reading the skills', 'skills install': `Installing ${arg ?? 'a skill'}`,
    'skills enable': `Enabling ${arg ?? 'a skill'}`, 'skills bind': 'Binding a skill to its profile', 'sandboxes enable': `Enabling the ${arg ?? ''} profile`, 'credentials ls': 'Reading the credential list', 'credentials bind': 'Binding a credential',
    'op since': 'Reading recent runs', 'op record': 'Recording the run', 'git commit': 'Committing', 'git sync': 'Syncing',
    'whereami': 'Checking how this session runs', 'git log': 'Reading recent history', 'page read': `Reading ${arg ?? 'a page'}`, 'page history': 'Reading a page’s history', 'search status': 'Checking search', 'reference': 'Reading the reference',
  }
  return table[`${a} ${b}`] ?? table[a ?? ''] ?? null
}

/** `Run <command>?`, `Edit <path>?`: what the agent wants, not which tool. */
function permissionTitle(req: PermissionRequest): string {
  const verb: Record<string, string> = { Bash: 'Run', Edit: 'Edit', Write: 'Write', MultiEdit: 'Edit', NotebookEdit: 'Edit', Read: 'Read', WebFetch: 'Fetch', WebSearch: 'Search the web for' }
  const v = verb[req.tool]
  return v ? `${v} this?` : `Allow ${req.tool}?`
}

/** A card the turn ended under, unanswered. */
const TURN_ENDED = 'The turn ended before anyone answered'

/** One assistant turn in the transcript: streamed markdown, tool rows, permission cards. */
export class AssistantBubble {
  private readonly el: HTMLElement
  /** The text block being streamed into; made on the first text after a tool row, so text sits in order. */
  private body: HTMLElement | null = null
  private text = ''
  private renderTimer: number | null = null
  private readonly renderer = new Component()

  /** Everything the agent said this turn, for Copy. */
  private all = ''
  /** Tool rows this turn, newest last, for a permission card to settle onto. */
  private readonly rows: { row: ToolRowView; group: ToolGroupView }[] = []
  /** Rows by the call's id, for its result to land on. */
  private readonly byId = new Map<string, ToolRowView>()
  /** The calls running back to back now; text after them starts a new group. */
  private group: ToolGroupView | null = null
  /** Cards still waiting on a click; the turn's end answers them. */
  private readonly pending = new Set<(d: PermissionDecision) => void>()

  constructor(
    parent: HTMLElement,
    private readonly app: App,
    private readonly owner: Component,
    /** The wiki root, so a file the agent touched is named, and opened, by its vault path. */
    private readonly root: string | null = null,
  ) {
    this.el = parent.createDiv({ cls: 'llm-wiki-msg llm-wiki-assistant' })
    owner.addChild(this.renderer)
  }

  take(e: ChatEvent): void {
    switch (e.type) {
      case 'start':
        break
      case 'tool-done':
        if (e.id) this.byId.get(e.id)?.done(e.output, e.error === true)
        break
      case 'status':
        this.line('llm-wiki-muted', e.text)
        break
      case 'text':
        this.closeGroup()
        this.text += e.text
        this.all += e.text
        this.scheduleRender()
        break
      case 'tool': {
        // A tool row closes the text so far, so later text starts a fresh block in order.
        this.flushText()
        const group = (this.group ??= new ToolGroupView(this.el, this.root))
        const row = group.add({ name: e.name, input: e.input, detail: e.detail, sentence: toolSentence(e.name, e.detail) })
        this.rows.push({ row, group })
        if (e.id) this.byId.set(e.id, row)
        break
      }
      case 'result':
        this.flushText()
        if (e.text && !this.text) this.line(e.ok ? '' : 'llm-wiki-error', e.text)
        // The duration and outcome ride on the bubble, for whoever hovers.
        if (e.detail) this.el.title = e.detail
        break
      case 'error':
        this.flushText()
        this.line('llm-wiki-error', e.message)
        break
    }
  }

  /**
   * A permission card under the call it asks about; resolves on the click.
   * Answered, it folds away: the row above already says what ran, and a
   * refusal leaves a mark on it.
   */
  ask(req: PermissionRequest): Promise<PermissionDecision> {
    this.flushText()
    const asked = [...this.rows].reverse().find((r) => r.row.call.name === req.tool)
    const row = asked?.row ?? null
    // The call being asked about stays in view until it is answered.
    asked?.group.setOpen(true)
    const card = this.el.createDiv({ cls: 'llm-wiki-permission' })
    card.createDiv({ cls: 'llm-wiki-permission-title', text: permissionTitle(req) })
    // What the row above already says is not said twice; a command the row put in words is.
    const summary = describeTool(req.tool, req.input, req.summary, this.root).detail ?? req.summary
    if (summary !== row?.shown) card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: summary.replace(/\s--json\b/, '') })
    const buttons = card.createDiv({ cls: 'llm-wiki-permission-buttons' })
    const allow = buttons.createEl('button', { text: 'Allow', cls: 'mod-cta' })
    const allowTurn = buttons.createEl('button', { text: 'Allow for this turn', attr: { title: 'Every tool this turn still wants runs without asking' } })
    const deny = buttons.createEl('button', { text: 'Deny' })
    return new Promise((resolve) => {
      const settle = (d: PermissionDecision) => {
        if (!this.pending.delete(settle)) return
        card.remove()
        if (!d.allow) {
          const denied = d.reason === TURN_ENDED ? 'Not answered' : 'Denied'
          if (row) row.mark(denied, 'is-denied')
          else this.line('llm-wiki-tool-mark is-denied', denied)
        } else if (row && d.forTurn) row.mark('Allowed for this turn')
        resolve(d)
      }
      this.pending.add(settle)
      allow.addEventListener('click', () => settle({ allow: true }))
      allowTurn.addEventListener('click', () => settle({ allow: true, forTurn: true }))
      deny.addEventListener('click', () => settle({ allow: false, reason: 'Denied in Obsidian' }))
    })
  }

  finish(): void {
    for (const settle of [...this.pending]) settle({ allow: false, reason: TURN_ENDED })
    this.closeGroup()
    this.flushText()
    if (!this.all.trim()) return
    const copy = this.el.createEl('button', { cls: 'llm-wiki-copy clickable-icon', attr: { 'aria-label': 'Copy the reply as markdown' } })
    setIcon(copy, 'copy')
    const text = this.all
    copy.addEventListener('click', () => void navigator.clipboard.writeText(text).then(() => new Notice('Copied', 1500)))
  }

  dispose(): void {
    this.owner.removeChild(this.renderer)
  }

  /** The calls so far are one group; whatever comes next sits after it. */
  private closeGroup(): void {
    this.group?.settle()
    this.group = null
  }

  private line(cls: string, text: string): void {
    this.closeGroup()
    this.el.createDiv({ cls: `llm-wiki-line ${cls}`.trim(), text })
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) return
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null
      void this.render()
    }, 120)
  }

  private flushText(): void {
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer)
      this.renderTimer = null
    }
    if (!this.text) return
    void this.render()
    this.text = ''
    this.body = null
  }

  private async render(): Promise<void> {
    const target = (this.body ??= this.el.createDiv({ cls: 'llm-wiki-assistant-body' }))
    const md = this.text
    target.empty()
    await MarkdownRenderer.render(this.app, md, target, '', this.renderer)
  }
}
