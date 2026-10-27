// The agent's tool calls in a turn, quieter than its words: grey rows that
// open on a click to say exactly what ran and what came back, gathered into
// one group when several run back to back.
import { setIcon } from 'obsidian'
import { clip, describeTool, groupSummary, toolDetail, type DetailBlock } from '../chat/describe'

export interface ToolCall {
  name: string
  input?: Record<string, unknown>
  detail?: string
  /** The llm-wiki command in words, when there is one. */
  sentence: string | null
}

/** One call: a line that toggles a panel with the command, the edit, the output. */
export class ToolRowView {
  readonly el: HTMLElement
  readonly line: HTMLElement
  /** What the line shows after the label, for a permission card not to repeat. */
  readonly shown: string | undefined
  private panel: HTMLElement | null = null
  private result: { text: string; error: boolean } | null = null
  private readonly caret: HTMLElement
  /** `Denied`, `Not answered`, `Failed`: what went wrong, for the group's line to count. */
  trouble: string | null = null
  /** Told when a mark lands, so a folded group can say so. */
  onMark: (() => void) | null = null

  constructor(parent: HTMLElement, readonly call: ToolCall, root: string | null) {
    const d = describeTool(call.name, call.input, call.detail, root, call.sentence)
    this.shown = d.detail
    this.el = parent.createDiv({ cls: 'llm-wiki-tool is-running' })
    this.line = this.el.createDiv({ cls: 'llm-wiki-tool-line', attr: { role: 'button', tabindex: '0', 'aria-expanded': 'false' } })
    setIcon(this.line.createSpan({ cls: 'llm-wiki-tool-icon' }), d.icon)
    this.line.createSpan({ cls: 'llm-wiki-tool-name', text: d.label })
    // A page in the wiki opens on a click: the transcript's link handler takes `internal-link`.
    if (d.open) this.line.createEl('a', { cls: 'internal-link llm-wiki-tool-detail llm-wiki-tool-file', text: d.detail, href: d.open, attr: { 'data-href': d.open } })
    else if (d.detail) this.line.createSpan({ cls: 'llm-wiki-tool-detail', text: d.detail })
    this.caret = this.line.createSpan({ cls: 'llm-wiki-tool-caret' })
    setIcon(this.caret, 'chevron-right')
    this.line.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a')) return
      this.toggle()
    })
    this.line.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      this.toggle()
    })
  }

  toggle(open = !this.panel): void {
    this.el.toggleClass('is-open', open)
    this.line.setAttribute('aria-expanded', String(open))
    if (!open) {
      this.panel?.remove()
      this.panel = null
      return
    }
    this.panel ??= this.el.createDiv({ cls: 'llm-wiki-tool-panel' })
    this.drawPanel()
  }

  /** The call's answer; an open panel shows it at once. */
  done(text: string | undefined, error: boolean): void {
    this.el.removeClass('is-running')
    this.result = { text: text ?? '', error }
    // A refusal already says why on the line; a failure says so once.
    if (error && !this.trouble) this.mark('Failed', 'is-denied')
    if (this.panel) this.drawPanel()
  }

  /** A mark beside what ran; one with `is-denied` is trouble the group counts. */
  mark(text: string, cls = ''): void {
    this.line.insertBefore(this.line.createSpan({ cls: `llm-wiki-tool-mark ${cls}`.trim(), text }), this.caret)
    if (cls === 'is-denied') this.trouble = text
    this.onMark?.()
  }

  private drawPanel(): void {
    const panel = this.panel
    if (!panel) return
    panel.empty()
    const blocks: DetailBlock[] = toolDetail(this.call.name, this.call.input, this.call.detail)
    for (const b of blocks) block(panel, b)
    if (!this.result) panel.createDiv({ cls: 'llm-wiki-tool-label', text: 'Running…' })
    else if (!this.result.text.trim()) panel.createDiv({ cls: 'llm-wiki-tool-label', text: this.result.error ? 'Failed, with no output' : 'No output' })
    else block(panel, { label: this.result.error ? 'Error' : 'Output', text: clip(this.result.text), kind: 'code' }, this.result.error)
  }
}

function block(parent: HTMLElement, b: DetailBlock, error = false): void {
  parent.createDiv({ cls: 'llm-wiki-tool-label', text: b.label })
  const pre = parent.createEl('pre', { cls: `llm-wiki-tool-pre${error ? ' is-error' : ''}` })
  if (b.kind !== 'diff') {
    pre.setText(b.text)
    return
  }
  for (const l of b.text.split('\n')) pre.createDiv({ cls: l.startsWith('+ ') ? 'is-added' : l.startsWith('- ') ? 'is-removed' : '', text: l })
}

/**
 * Calls made back to back. One call is just its row; from the second on a
 * head line counts them and folds the rows away once the agent speaks again,
 * unless the person opened or shut it themselves.
 */
export class ToolGroupView {
  readonly el: HTMLElement
  readonly rows: ToolRowView[] = []
  private readonly head: HTMLElement
  private readonly summary: HTMLElement
  private readonly list: HTMLElement
  private touched = false

  constructor(parent: HTMLElement, private readonly root: string | null) {
    this.el = parent.createDiv({ cls: 'llm-wiki-work is-open' })
    this.head = this.el.createDiv({ cls: 'llm-wiki-work-head', attr: { role: 'button', tabindex: '0', 'aria-expanded': 'true' } })
    setIcon(this.head.createSpan({ cls: 'llm-wiki-tool-caret' }), 'chevron-right')
    this.summary = this.head.createSpan()
    this.head.hide()
    this.list = this.el.createDiv({ cls: 'llm-wiki-work-list' })
    const flip = () => {
      this.touched = true
      this.setOpen(!this.el.hasClass('is-open'))
    }
    this.head.addEventListener('click', flip)
    this.head.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      flip()
    })
  }

  add(call: ToolCall): ToolRowView {
    const row = new ToolRowView(this.list, call, this.root)
    row.onMark = () => this.describe()
    this.rows.push(row)
    this.describe()
    return row
  }

  /** The head's line: what ran, then what went wrong, which a folded group would otherwise hide. */
  private describe(): void {
    if (this.rows.length < 2) return
    this.head.show()
    this.el.addClass('has-head')
    const trouble = new Map<string, number>()
    for (const r of this.rows) if (r.trouble) trouble.set(r.trouble, (trouble.get(r.trouble) ?? 0) + 1)
    this.summary.empty()
    this.summary.createSpan({ text: groupSummary(this.rows.map((r) => r.call.name)) })
    for (const [what, n] of trouble) this.summary.createSpan({ cls: 'llm-wiki-tool-mark is-denied', text: `${n} ${what.toLowerCase()}` })
  }

  setOpen(open: boolean): void {
    this.el.toggleClass('is-open', open)
    this.head.setAttribute('aria-expanded', String(open))
  }

  /** The agent spoke again or the turn ended: fold away, unless there is one row or the person chose. */
  settle(): void {
    if (this.rows.length > 1 && !this.touched) this.setOpen(false)
  }
}
