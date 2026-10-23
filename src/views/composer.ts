// The controls under the chat box: the permission popover, the model and
// effort lists, the context ring, and the `/` skill list. The pure helpers
// at the top are what the tests read.
import { setIcon } from 'obsidian'
import { slashCommand, type SkillEntry } from '../chat/skills'
import { PERMISSION_NAMES, type LlmWikiSettings } from '../settings'

/** The word after a `/` that opens a line, when the caret sits at its end; null otherwise. */
export function slashQuery(text: string, caret: number): string | null {
  const m = /(?:^|\n)\/(\S*)$/.exec(text.slice(0, caret))
  return m ? (m[1] ?? '') : null
}

/** Skills whose name holds the query first, then those whose description does; the `llm-wiki:` prefix typed out is ignored. */
export function matchSkills(skills: SkillEntry[], query: string): SkillEntry[] {
  const q = query.toLowerCase().replace(/^llm-wiki:/, '')
  if (!q || 'llm-wiki:'.startsWith(q)) return skills
  const rank = (s: SkillEntry): number => (s.name.startsWith(q) ? 0 : s.name.includes(q) ? 1 : s.description.toLowerCase().includes(q) ? 2 : 3)
  return skills.map((s) => ({ s, r: rank(s) })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r).map((x) => x.s)
}

/** What the permission button says: the mode, or the sandbox that replaces it. */
export function permissionLabel(s: Pick<LlmWikiSettings, 'permissionMode' | 'readOnly' | 'sandboxed' | 'sandbox'>): string {
  if (s.sandboxed) return `Sandbox: ${s.sandbox}`
  return `${PERMISSION_NAMES[s.permissionMode]}${s.readOnly ? ' · read-only' : ''}`
}

export function shortTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${Number((n / 1_000_000).toFixed(1))}m`
}

export interface Choice {
  title: string
  desc?: string
  icon?: string
  checked: boolean
  disabled?: boolean
  pick(): void
}

/**
 * A panel above its anchor, shut by a click outside or Escape. Built here and
 * not as an Obsidian Menu, because the permission panel holds toggles and a
 * text field a Menu cannot.
 */
export function openPopover(anchor: HTMLElement, build: (el: HTMLElement, close: () => void) => void, cls = ''): () => void {
  const doc = anchor.ownerDocument
  const el = doc.body.createDiv({ cls: `llm-wiki-popover ${cls}`.trim() })
  const onDown = (e: MouseEvent) => {
    const t = e.target as Node
    if (!el.contains(t) && !anchor.contains(t)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  function close(): void {
    el.remove()
    doc.removeEventListener('mousedown', onDown, true)
    doc.removeEventListener('keydown', onKey, true)
    anchor.removeClass('is-active')
  }
  build(el, close)
  place(el, anchor)
  anchor.addClass('is-active')
  doc.addEventListener('mousedown', onDown, true)
  doc.addEventListener('keydown', onKey, true)
  return close
}

function place(el: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect()
  const win = anchor.ownerDocument.defaultView ?? window
  el.style.left = `${Math.max(8, Math.min(r.left, win.innerWidth - el.offsetWidth - 8))}px`
  el.style.bottom = `${win.innerHeight - r.top + 6}px`
}

/** One row of a choice list: a title, a line under it, a check when chosen. */
export function choiceRow(parent: HTMLElement, c: Choice, close: () => void): HTMLElement {
  const row = parent.createDiv({ cls: 'llm-wiki-choice' })
  row.toggleClass('is-checked', c.checked)
  row.toggleClass('is-disabled', Boolean(c.disabled))
  const head = row.createDiv({ cls: 'llm-wiki-choice-head' })
  if (c.icon) setIcon(head.createSpan({ cls: 'llm-wiki-choice-icon' }), c.icon)
  head.createSpan({ cls: 'llm-wiki-choice-title', text: c.title })
  if (c.checked) setIcon(head.createSpan({ cls: 'llm-wiki-choice-check' }), 'check')
  if (c.desc) row.createDiv({ cls: 'llm-wiki-choice-desc', text: c.desc })
  if (!c.disabled)
    row.addEventListener('click', () => {
      c.pick()
      close()
    })
  return row
}

/** A labeled switch inside a popover; the label carries what it does. */
export function switchRow(parent: HTMLElement, title: string, desc: string, on: boolean, disabled: boolean, change: (on: boolean) => void): HTMLElement {
  const row = parent.createDiv({ cls: 'llm-wiki-switch' })
  row.toggleClass('is-disabled', disabled)
  const text = row.createDiv({ cls: 'llm-wiki-switch-text' })
  text.createDiv({ cls: 'llm-wiki-choice-title', text: title })
  text.createDiv({ cls: 'llm-wiki-choice-desc', text: desc })
  const toggle = row.createDiv({ cls: 'checkbox-container' })
  toggle.toggleClass('is-enabled', on)
  if (!disabled)
    row.addEventListener('click', () => {
      on = !on
      toggle.toggleClass('is-enabled', on)
      change(on)
    })
  return row
}

const SVG = 'http://www.w3.org/2000/svg'

/** How full the conversation is: a ring, with the numbers on hover. */
export class ContextRing {
  readonly el: HTMLElement
  private readonly arc: SVGCircleElement
  private used: number | undefined
  private window: number | undefined
  private detail: HTMLElement | null = null

  constructor(parent: HTMLElement) {
    this.el = parent.createDiv({ cls: 'llm-wiki-ring', attr: { role: 'img', 'aria-label': 'Context window' } })
    const doc = parent.ownerDocument
    const svg = doc.createElementNS(SVG, 'svg')
    svg.setAttribute('viewBox', '0 0 20 20')
    const track = doc.createElementNS(SVG, 'circle')
    this.arc = doc.createElementNS(SVG, 'circle')
    for (const c of [track, this.arc]) {
      c.setAttribute('cx', '10')
      c.setAttribute('cy', '10')
      c.setAttribute('r', '7.5')
      svg.appendChild(c)
    }
    track.setAttribute('class', 'llm-wiki-ring-track')
    this.arc.setAttribute('class', 'llm-wiki-ring-arc')
    this.arc.setAttribute('transform', 'rotate(-90 10 10)')
    this.el.appendChild(svg)
    this.el.addEventListener('mouseenter', () => this.showDetail())
    this.el.addEventListener('mouseleave', () => this.hideDetail())
    this.draw()
  }

  set(used?: number, window?: number): void {
    if (used !== undefined) this.used = used
    if (window !== undefined) this.window = window
    this.draw()
  }

  clear(): void {
    this.used = this.window = undefined
    this.draw()
  }

  private get fraction(): number | undefined {
    return this.used !== undefined && this.window ? Math.min(1, this.used / this.window) : undefined
  }

  private draw(): void {
    const length = 2 * Math.PI * 7.5
    const f = this.fraction ?? 0
    this.arc.setAttribute('stroke-dasharray', `${(f * length).toFixed(2)} ${length.toFixed(2)}`)
    this.el.toggleClass('is-high', f >= 0.8)
  }

  private showDetail(): void {
    this.hideDetail()
    const el = this.el.ownerDocument.body.createDiv({ cls: 'llm-wiki-popover llm-wiki-ring-detail' })
    const head = el.createDiv({ cls: 'llm-wiki-ring-head' })
    head.createSpan({ cls: 'llm-wiki-choice-title', text: 'Context window' })
    const f = this.fraction
    if (this.used === undefined) {
      el.createDiv({ cls: 'llm-wiki-choice-desc', text: 'Shown after the first reply.' })
    } else {
      head.createSpan({ cls: 'llm-wiki-muted', text: f !== undefined ? `${Math.round(f * 100)}% · ${shortTokens(this.used)}/${shortTokens(this.window ?? 0)}` : `${shortTokens(this.used)} tokens` })
      if (f !== undefined) el.createDiv({ cls: 'llm-wiki-ring-bar' }).createDiv({ cls: 'llm-wiki-ring-fill' }).style.width = `${(f * 100).toFixed(1)}%`
      el.createDiv({ cls: 'llm-wiki-choice-desc', text: 'Claude compacts the chat when it fills. New chat starts an empty one.' })
    }
    place(el, this.el)
    this.detail = el
  }

  private hideDetail(): void {
    this.detail?.remove()
    this.detail = null
  }
}

/** The list that opens on `/`: arrow keys move, Enter or Tab takes, Escape shuts it. */
export class SlashMenu {
  private readonly el: HTMLElement
  private items: SkillEntry[] = []
  private index = 0
  /** Escape shut it for this `/word`; typing on reopens it. */
  private dismissed: string | null = null

  constructor(
    host: HTMLElement,
    private readonly input: HTMLTextAreaElement,
    private readonly skills: () => Promise<SkillEntry[]>,
    private readonly enabled: () => boolean,
  ) {
    this.el = host.createDiv({ cls: 'llm-wiki-slash' })
    this.el.hide()
  }

  get open(): boolean {
    return this.items.length > 0
  }

  /** After each keystroke: open, filter, or shut. */
  update(): void {
    const q = this.enabled() ? slashQuery(this.input.value, this.input.selectionStart ?? 0) : null
    if (q === null || q === this.dismissed) {
      if (q === null) this.dismissed = null
      this.close()
      return
    }
    this.dismissed = null
    void this.skills().then((all) => {
      // The answer can land after the next keystroke; only the current query renders.
      if (slashQuery(this.input.value, this.input.selectionStart ?? 0) !== q) return
      this.items = matchSkills(all, q).slice(0, 8)
      this.index = 0
      this.render()
    })
  }

  /** Arrow keys, Enter, Tab and Escape while the list is open; true when the key was the list's. */
  key(e: KeyboardEvent): boolean {
    if (!this.open) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length
      this.render()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const s = this.items[this.index]
      if (s) this.take(s)
    } else if (e.key === 'Escape') {
      this.dismissed = slashQuery(this.input.value, this.input.selectionStart ?? 0)
      this.close()
    } else {
      return false
    }
    e.preventDefault()
    return true
  }

  close(): void {
    this.items = []
    this.el.empty()
    this.el.hide()
  }

  private take(s: SkillEntry): void {
    const caret = this.input.selectionStart ?? 0
    const before = this.input.value.slice(0, caret)
    const start = before.lastIndexOf('/')
    const insert = `${slashCommand(s)} `
    this.input.value = this.input.value.slice(0, start) + insert + this.input.value.slice(caret)
    const at = start + insert.length
    this.input.setSelectionRange(at, at)
    this.input.focus()
    this.close()
  }

  private render(): void {
    this.el.empty()
    if (!this.items.length) {
      this.el.hide()
      return
    }
    this.el.show()
    this.items.forEach((s, i) => {
      const row = this.el.createDiv({ cls: 'llm-wiki-slash-row' })
      row.toggleClass('is-selected', i === this.index)
      row.createSpan({ cls: 'llm-wiki-slash-name', text: `/llm-wiki:${s.name}` })
      row.createSpan({ cls: 'llm-wiki-slash-desc', text: s.args ? `${s.args} — ${s.description}` : s.description })
      // mousedown, not click: a click would blur the box first.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.take(s)
      })
      if (i === this.index) row.scrollIntoView?.({ block: 'nearest' })
    })
  }
}
