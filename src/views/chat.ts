import { Component, ItemView, MarkdownRenderer, setIcon, type WorkspaceLeaf } from 'obsidian'
import type { ChatBackend, ChatEvent, PermissionDecision, PermissionRequest } from '../chat/types'
import { log } from '../logger'
import type LlmWikiPlugin from '../main'
import type { ChatMode } from '../settings'

export const VIEW_CHAT = 'llm-wiki-chat'

export class ChatView extends ItemView {
  private transcript!: HTMLElement
  private composer!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private stopBtn!: HTMLButtonElement
  private modeSelect!: HTMLSelectElement
  private status!: HTMLElement
  private backend: ChatBackend | null = null
  private mode: ChatMode
  private running: AbortController | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(leaf)
    this.mode = plugin.settings.defaultChatMode
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
    this.modeSelect.createEl('option', { value: 'safe', text: 'Safe (jailed)' })
    this.modeSelect.value = this.mode
    this.registerDomEvent(this.modeSelect, 'change', () => {
      this.mode = this.modeSelect.value as ChatMode
      this.backend = null
      this.note(`mode: ${this.mode}`)
    })
    const newBtn = bar.createEl('button', { text: 'New chat' })
    this.registerDomEvent(newBtn, 'click', () => this.newChat())
    this.status = bar.createDiv({ cls: 'llm-wiki-muted llm-wiki-chat-status' })

    this.transcript = root.createDiv({ cls: 'llm-wiki-transcript' })

    const composer = root.createDiv({ cls: 'llm-wiki-composer' })
    this.composer = composer.createEl('textarea', { placeholder: 'Ask the wiki, or ask the agent to do something…', cls: 'llm-wiki-composer-input' })
    this.composer.rows = 3
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
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.showReadiness()
    return Promise.resolve()
  }

  onClose(): Promise<void> {
    this.running?.abort()
    return Promise.resolve()
  }

  private showReadiness(): void {
    this.status.setText(this.plugin.wiki ? `${this.plugin.wiki.key}` : this.plugin.problem ?? 'detecting…')
  }

  private newChat(): void {
    this.running?.abort()
    this.backend?.reset()
    this.backend = null
    this.transcript.empty()
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
    try {
      this.backend ??= await this.plugin.backend(this.mode)
    } catch (e) {
      this.note(e instanceof Error ? e.message : String(e))
      return
    }
    this.composer.value = ''
    this.transcript.createDiv({ cls: 'llm-wiki-msg llm-wiki-user', text: prompt })
    const assistant = new AssistantBubble(this.transcript, this.app, this)
    const abort = new AbortController()
    this.running = abort
    this.sendBtn.disabled = true
    this.stopBtn.disabled = false
    try {
      const events = this.backend.send(prompt, {
        wiki,
        signal: abort.signal,
        askPermission: (req) => assistant.ask(req),
        onStderr: (chunk) => log.debug('harness stderr', chunk),
      })
      for await (const e of events) {
        assistant.take(e)
        this.scroll()
      }
      if (abort.signal.aborted) assistant.take({ type: 'status', text: 'stopped' })
    } catch (e) {
      assistant.take({ type: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      assistant.finish()
      this.running = null
      this.sendBtn.disabled = false
      this.stopBtn.disabled = true
      if (!this.backend?.multiTurn) this.note('safe mode: each question is its own session')
      this.scroll()
    }
  }
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
        if (e.detail) this.line('llm-wiki-muted', e.detail)
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
        row.createSpan({ cls: 'llm-wiki-tool-name', text: e.name })
        if (e.detail) row.createSpan({ cls: 'llm-wiki-tool-detail llm-wiki-muted', text: e.detail })
        break
      }
      case 'result':
        this.flushText()
        if (e.text && !this.text) this.line(e.ok ? '' : 'llm-wiki-error', e.text)
        if (e.detail) this.line('llm-wiki-muted', e.detail)
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
    card.createDiv({ cls: 'llm-wiki-permission-title', text: `Allow ${req.tool}?` })
    card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: req.summary })
    const buttons = card.createDiv({ cls: 'llm-wiki-permission-buttons' })
    const allow = buttons.createEl('button', { text: 'Allow', cls: 'mod-cta' })
    const deny = buttons.createEl('button', { text: 'Deny' })
    return new Promise((resolve) => {
      const settle = (d: PermissionDecision) => {
        allow.disabled = deny.disabled = true
        card.addClass(d.allow ? 'is-allowed' : 'is-denied')
        resolve(d)
      }
      this.owner.registerDomEvent(allow, 'click', () => settle({ allow: true }))
      this.owner.registerDomEvent(deny, 'click', () => settle({ allow: false, reason: 'Denied in Obsidian' }))
    })
  }

  finish(): void {
    this.flushText()
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
