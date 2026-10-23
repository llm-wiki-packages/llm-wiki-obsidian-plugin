import { Component, ItemView, MarkdownRenderer, setIcon, type WorkspaceLeaf } from 'obsidian'
import type { ChatBackend, ChatEvent, PermissionDecision, PermissionRequest } from '../chat/types'
import { log } from '../logger'
import type LlmWikiPlugin from '../main'
import type { ChatMode } from '../settings'

export const VIEW_CHAT = 'llm-wiki-chat'

/** Tools after which the wiki may have changed. */
const WRITE_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const CAPABILITY: Record<ChatMode, string> = {
  agent: 'Agent: runs jobs and edits pages directly; asks you before each tool it would prompt for.',
  ask: 'Ask: read-only, jailed; each question starts fresh.',
}

export class ChatView extends ItemView {
  private transcript!: HTMLElement
  private composer!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private stopBtn!: HTMLButtonElement
  private modeSelect!: HTMLSelectElement
  private status!: HTMLElement
  private chips!: HTMLElement
  private capability!: HTMLElement
  private continueBtn!: HTMLButtonElement
  private newBtn!: HTMLButtonElement
  /** The last tool the agent called, so a refresh follows a write and not every Read. */
  private lastTool = ''
  private hint!: HTMLElement
  /** One backend per mode, so switching modes and back keeps the Agent session. */
  private backends: Partial<Record<ChatMode, ChatBackend>> = {}
  private mode: ChatMode
  private running: AbortController | null = null
  /** Rendered turns hold a Component each while on screen; New chat releases them. */
  private bubbles: AssistantBubble[] = []

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(leaf)
    this.mode = plugin.settings.defaultChatMode
    // Agent needs claude; without it the pane starts in Ask rather than failing on Send.
    if (this.mode === 'agent' && !plugin.claudeBin && plugin.cliBin) this.mode = 'ask'
  }

  getViewType(): string {
    return VIEW_CHAT
  }

  getDisplayText(): string {
    return 'LLM wiki chat'
  }

  getIcon(): string {
    return 'message-square'
  }

  onOpen(): Promise<void> {
    const root = this.contentEl
    root.empty()
    root.addClass('llm-wiki', 'llm-wiki-chat')

    const bar = root.createDiv({ cls: 'llm-wiki-chat-bar' })
    this.modeSelect = bar.createEl('select', { cls: 'dropdown' })
    this.modeSelect.createEl('option', { value: 'agent', text: 'Agent' })
    this.modeSelect.createEl('option', { value: 'ask', text: 'Ask' })
    this.modeSelect.value = this.mode
    this.registerDomEvent(this.modeSelect, 'change', () => {
      this.mode = this.modeSelect.value as ChatMode
      this.showCapability()
    })
    const newBtn = bar.createEl('button', { text: 'New chat' })
    this.registerDomEvent(newBtn, 'click', () => this.newChat())
    this.continueBtn = bar.createEl('button', { text: 'Continue last chat' })
    this.registerDomEvent(this.continueBtn, 'click', () => this.continueLast())
    this.newBtn = newBtn
    const skillsBtn = bar.createEl('button', { text: 'Commands…', attr: { title: 'The /llm-wiki: commands the installed plugin ships' } })
    this.registerDomEvent(skillsBtn, 'click', () => this.plugin.pickSkill())
    this.status = bar.createDiv({ cls: 'llm-wiki-muted llm-wiki-chat-status' })

    this.transcript = root.createDiv({ cls: 'llm-wiki-transcript' })
    this.hint = this.transcript.createDiv({ cls: 'llm-wiki-note llm-wiki-muted llm-wiki-hint' })
    this.chips = root.createDiv({ cls: 'llm-wiki-chips' })

    const composer = root.createDiv({ cls: 'llm-wiki-composer' })
    this.composer = composer.createEl('textarea', { placeholder: 'Ask the wiki, or ask the agent to do something…', cls: 'llm-wiki-composer-input' })
    this.composer.rows = 3
    this.capability = composer.createDiv({ cls: 'llm-wiki-muted llm-wiki-capability' })
    const buttons = composer.createDiv({ cls: 'llm-wiki-composer-buttons' })
    this.sendBtn = buttons.createEl('button', { text: 'Send', cls: 'mod-cta' })
    this.stopBtn = buttons.createEl('button', { text: 'Stop' })
    this.stopBtn.disabled = true
    this.registerDomEvent(this.sendBtn, 'click', () => void this.send())
    this.registerDomEvent(this.stopBtn, 'click', () => this.running?.abort())
    this.registerDomEvent(this.composer, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void this.send()
      }
      if (e.key === 'Escape' && this.running) this.running.abort()
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.showChips()))
    this.showReadiness()
    this.showChips()
    this.showCapability()
    return Promise.resolve()
  }

  private showCapability(): void {
    this.capability.setText(CAPABILITY[this.mode])
    const agentOption = this.modeSelect.options[0]
    if (agentOption) {
      agentOption.disabled = !this.plugin.claudeBin
      agentOption.title = this.plugin.claudeBin ? '' : 'claude was not found; set its path in the plugin settings'
    }
    // One of the two shows: an empty pane with a session to pick up offers Continue; otherwise New chat.
    const offerContinue = Boolean(this.plugin.settings.lastSession && this.plugin.claudeBin) && this.transcript.childElementCount <= 1 && !this.backends.agent
    this.continueBtn.toggle(offerContinue)
    this.newBtn.toggle(!offerContinue)
    if (offerContinue && this.plugin.settings.lastPrompt) this.continueBtn.title = `Continuing: ${this.plugin.settings.lastPrompt}`
    this.hint.setText(this.plugin.claudeBin || this.mode === 'ask' ? 'Ask about the wiki, or tell the agent what to do.' : 'Agent mode needs claude; set its path in the plugin settings. Ask mode works without it.')
    this.hint.toggle(this.transcript.childElementCount <= 1)
  }

  /** Picks the last Agent session back up, so closing the pane did not lose the thread. */
  private continueLast(): void {
    const id = this.plugin.settings.lastSession
    if (!id) return
    void this.plugin.backend('agent', id).then((b) => {
      this.backends.agent = b
      this.mode = 'agent'
      this.modeSelect.value = 'agent'
      const last = this.plugin.settings.lastPrompt
      this.note(last ? `Continuing: ${last.length > 120 ? `${last.slice(0, 119)}…` : last}` : 'continuing the last chat')
      this.showCapability()
    }).catch((e: unknown) => this.note(e instanceof Error ? e.message : String(e)))
  }

  /** Three starting points above an empty transcript, by what the person is looking at. */
  private showChips(): void {
    this.chips.empty()
    if (this.transcript.childElementCount > 1) return
    const file = this.app.workspace.getActiveFile()
    const prompts = file
      ? [`Summarize [[${file.path}]]`, `Verify [[${file.path}]] against its sources`, `What links to [[${file.path}]]?`]
      : ['What needs attention in this wiki?', 'What did the wiki learn since yesterday?']
    for (const p of prompts) {
      const chip = this.chips.createEl('button', { cls: 'llm-wiki-chip', text: p })
      // Chips are rebuilt on every leaf change; the DOM owns the listener with the node.
      chip.addEventListener('click', () => this.prefill(p, this.mode))
    }
    if (!file) {
      const add = this.chips.createEl('button', { cls: 'llm-wiki-chip', text: 'Add a source…' })
      add.addEventListener('click', () => void this.plugin.addJob())
    }
  }

  onClose(): Promise<void> {
    this.running?.abort()
    return Promise.resolve()
  }

  /** Put text in the composer and focus it, for a button elsewhere that starts a conversation. */
  prefill(text: string, mode: ChatMode = 'agent'): void {
    if (this.mode !== mode) {
      this.mode = mode
      this.modeSelect.value = mode
      this.showCapability()
    }
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
    this.transcript.empty()
    this.transcript.appendChild(this.hint)
    for (const b of this.bubbles) b.dispose()
    this.bubbles = []
    this.showChips()
    this.showCapability()
  }

  private note(text: string): void {
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
    let backend = this.backends[this.mode]
    try {
      backend ??= this.backends[this.mode] = await this.plugin.backend(this.mode)
    } catch (e) {
      this.note(e instanceof Error ? e.message : String(e))
      return
    }
    this.chips.empty()
    this.hint.hide()
    this.capability.hide()
    this.continueBtn.hide()
    this.transcript.createDiv({ cls: 'llm-wiki-msg llm-wiki-user', text: prompt })
    let failed = false
    const assistant = new AssistantBubble(this.transcript, this.app, this)
    this.bubbles.push(assistant)
    const abort = new AbortController()
    this.running = abort
    this.sendBtn.disabled = true
    this.stopBtn.disabled = false
    try {
      const events = backend.send(prompt, {
        wiki,
        signal: abort.signal,
        askPermission: (req) => assistant.ask(req),
        onStderr: (chunk) => log.debug('harness stderr', chunk),
      })
      for await (const e of events) {
        assistant.take(e)
        this.scroll()
        if (e.type === 'error') failed = true
        if (e.type === 'tool') this.lastTool = e.name
        // A write just finished, so whatever it changed is on disk; the dashboard should not wait a minute to say so.
        if (e.type === 'tool-done' && WRITE_TOOLS.has(this.lastTool)) void this.plugin.refreshSnapshot()
      }
      if (abort.signal.aborted) assistant.take({ type: 'status', text: 'stopped' })
      if (backend.sessionId && this.mode === 'agent') {
        this.plugin.settings.lastSession = backend.sessionId
        this.plugin.settings.lastPrompt = prompt
        void this.plugin.saveSettings()
      }
    } catch (e) {
      failed = true
      assistant.take({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      assistant.finish()
      this.running = null
      this.sendBtn.disabled = false
      this.stopBtn.disabled = true
      // A failed turn keeps the prompt, so the retry is one click.
      if (!failed) this.composer.value = ''
      this.scroll()
      void this.plugin.refreshSnapshot()
    }
  }
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
    'tickets ls': 'Reading the ticket list', 'tickets retry': `Retrying ticket ${arg ?? ''}`, 'page ls': 'Reading the page list', 'page curate': 'Curating pages', 'page adopt': 'Adopting pages',
    'search query': 'Searching the wiki', 'search index': 'Refreshing the search index', 'doctor': 'Running the doctor', 'status': 'Reading the status', 'skills ls': 'Reading the skills', 'skills install': `Installing ${arg ?? 'a skill'}`,
    'skills enable': `Enabling ${arg ?? 'a skill'}`, 'skills bind': 'Binding a skill stage to its sandbox', 'sandboxes enable': `Enabling the ${arg ?? ''} sandbox`, 'credentials ls': 'Reading the credential list', 'credentials bind': 'Binding a credential',
    'op since': 'Reading recent runs', 'op record': 'Recording the run', 'git commit': 'Committing', 'git sync': 'Syncing',
  }
  return table[`${a} ${b}`] ?? table[a ?? ''] ?? null
}

/** `Run <command>?`, `Edit <path>?`: what the agent wants, not which tool. */
function permissionTitle(req: PermissionRequest): string {
  const verb: Record<string, string> = { Bash: 'Run', Edit: 'Edit', Write: 'Write', MultiEdit: 'Edit', NotebookEdit: 'Edit', Read: 'Read', WebFetch: 'Fetch', WebSearch: 'Search the web for' }
  const v = verb[req.tool]
  return v ? `${v} this?` : `Allow ${req.tool}?`
}

/** One assistant turn in the transcript: streamed markdown, tool rows, permission cards. */
class AssistantBubble {
  private readonly el: HTMLElement
  private body: HTMLElement
  private text = ''
  private renderTimer: number | null = null
  private readonly renderer = new Component()

  constructor(
    parent: HTMLElement,
    private readonly app: ItemView['app'],
    private readonly owner: Component,
  ) {
    this.el = parent.createDiv({ cls: 'llm-wiki-msg llm-wiki-assistant' })
    this.body = this.el.createDiv({ cls: 'llm-wiki-assistant-body' })
    owner.addChild(this.renderer)
  }

  take(e: ChatEvent): void {
    switch (e.type) {
      case 'start':
      case 'tool-done':
        break
      case 'status':
        this.line('llm-wiki-muted', e.text)
        break
      case 'text':
        this.text += e.text
        this.scheduleRender()
        break
      case 'tool': {
        // A tool row closes the text so far, so later text starts a fresh block in order.
        this.flushText()
        const row = this.el.createDiv({ cls: 'llm-wiki-tool' })
        setIcon(row.createSpan({ cls: 'llm-wiki-tool-icon' }), 'wrench')
        const said = toolSentence(e.name, e.detail)
        row.createSpan({ cls: 'llm-wiki-tool-name', text: said ?? e.name })
        if (e.detail && !said) row.createSpan({ cls: 'llm-wiki-tool-detail llm-wiki-muted', text: e.detail })
        if (e.detail) row.title = e.detail
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

  /** A permission card; resolves on the click. */
  ask(req: PermissionRequest): Promise<PermissionDecision> {
    this.flushText()
    const card = this.el.createDiv({ cls: 'llm-wiki-permission' })
    card.createDiv({ cls: 'llm-wiki-permission-title', text: permissionTitle(req) })
    card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: req.summary.replace(/\s--json\b/, '') })
    const buttons = card.createDiv({ cls: 'llm-wiki-permission-buttons' })
    const allow = buttons.createEl('button', { text: 'Allow', cls: 'mod-cta' })
    const allowTurn = buttons.createEl('button', { text: 'Allow for this turn', attr: { title: 'Every tool this turn still wants runs without asking' } })
    const deny = buttons.createEl('button', { text: 'Deny' })
    return new Promise((resolve) => {
      const settle = (d: PermissionDecision) => {
        allow.disabled = allowTurn.disabled = deny.disabled = true
        card.addClass(d.allow ? 'is-allowed' : 'is-denied')
        resolve(d)
      }
      allow.addEventListener('click', () => settle({ allow: true }))
      allowTurn.addEventListener('click', () => settle({ allow: true, forTurn: true }))
      deny.addEventListener('click', () => settle({ allow: false, reason: 'Denied in Obsidian' }))
    })
  }

  finish(): void {
    this.flushText()
  }

  dispose(): void {
    this.owner.removeChild(this.renderer)
  }

  private line(cls: string, text: string): void {
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
    this.body = this.el.createDiv({ cls: 'llm-wiki-assistant-body' })
  }

  private async render(): Promise<void> {
    const target = this.body
    const md = this.text
    target.empty()
    await MarkdownRenderer.render(this.app, md, target, '', this.renderer)
  }
}
