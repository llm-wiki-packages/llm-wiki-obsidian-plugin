// Small DOM helpers over Obsidian's createEl, so the views read as layout and not as plumbing.
import { setIcon } from 'obsidian'

export function section(parent: HTMLElement, title: string, opts: { count?: number; actions?: (bar: HTMLElement) => void } = {}): HTMLElement {
  const el = parent.createDiv({ cls: 'llm-wiki-section' })
  const head = el.createDiv({ cls: 'llm-wiki-section-head' })
  head.createEl('h3', { text: title, cls: 'llm-wiki-section-title' })
  if (opts.count !== undefined) head.createSpan({ cls: 'llm-wiki-count', text: String(opts.count) })
  if (opts.actions) opts.actions(head.createDiv({ cls: 'llm-wiki-section-actions' }))
  return el.createDiv({ cls: 'llm-wiki-section-body' })
}

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted'

export function pill(parent: HTMLElement, text: string, tone: Tone = 'muted'): HTMLElement {
  return parent.createSpan({ cls: `llm-wiki-pill is-${tone}`, text })
}

export function icon(parent: HTMLElement, name: string, cls = ''): HTMLElement {
  const el = parent.createSpan({ cls: `llm-wiki-icon ${cls}`.trim() })
  setIcon(el, name)
  return el
}

export interface ButtonOpts {
  icon?: string
  cta?: boolean
  title?: string
}

export function button(parent: HTMLElement, label: string, onClick: (e: MouseEvent) => void | Promise<void>, opts: ButtonOpts = {}): HTMLButtonElement {
  const btn = parent.createEl('button', { cls: opts.cta ? 'llm-wiki-button mod-cta' : 'llm-wiki-button' })
  if (opts.icon) icon(btn, opts.icon)
  if (label) btn.createSpan({ text: label })
  if (opts.title) btn.title = opts.title
  // Rows are rebuilt on every render; the DOM owns the listener with the node.
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const r = onClick(e)
    if (r instanceof Promise) {
      btn.disabled = true
      void r.finally(() => (btn.disabled = false))
    }
  })
  return btn
}

export function empty(parent: HTMLElement, text: string, hint?: string): HTMLElement {
  const el = parent.createDiv({ cls: 'llm-wiki-empty' })
  el.createDiv({ text })
  if (hint) el.createDiv({ cls: 'llm-wiki-muted', text: hint })
  return el
}

export function table(parent: HTMLElement, headers: string[]): { row: () => HTMLElement } {
  const t = parent.createEl('table', { cls: 'llm-wiki-table' })
  const tr = t.createEl('thead').createEl('tr')
  for (const h of headers) tr.createEl('th', { text: h })
  const body = t.createEl('tbody')
  return { row: () => body.createEl('tr') }
}

/** `3m ago`, `2h ago`, `yesterday`, `in 40m`; empty for nothing. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  const diff = now - t
  const abs = Math.abs(diff)
  const future = diff < 0
  const m = Math.round(abs / 60_000)
  let s: string
  if (m < 1) s = 'now'
  else if (m < 60) s = `${m}m`
  else if (m < 36 * 60) s = `${Math.round(m / 60)}h`
  else s = `${Math.round(m / (24 * 60))}d`
  if (s === 'now') return future ? 'now' : 'just now'
  return future ? `in ${s}` : `${s} ago`
}

/** `13:00` in the user's locale, or the raw string when it does not parse. */
export function clockTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
