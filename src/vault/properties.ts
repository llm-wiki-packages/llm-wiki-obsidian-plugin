// A page's Properties panel, sorted for a person: the keys they write first,
// the wiki's own bookkeeping (a page's id, its revision, when it was made and
// checked) last and folded behind a More row until it is asked for. Nothing in
// the YAML moves; rows are sorted with `order` and hidden with a class. The
// More row is sticky: open, it stays open on every note until it is closed.
import type LlmWikiPlugin from '../main'

/** Keys a person writes, in the order they lead the panel. Any other key follows them. */
export const FIRST_KEYS = ['title', 'type', 'description', 'tags', 'aliases', 'author', 'published']

/** Keys the wiki keeps for itself: last, and hidden until More is clicked. */
export const BOOKKEEPING_KEYS = ['document_id', 'document_revision', 'generated', 'verified', 'resource', 'supersedes', 'superseded_by', 'stale_after', 'status', 'observed']

/** Where a key sorts in the panel: a first key by its place, bookkeeping after everything, the rest in between as Obsidian has them. */
export function keyOrder(key: string): number {
  const first = FIRST_KEYS.indexOf(key)
  if (first >= 0) return first - FIRST_KEYS.length
  return BOOKKEEPING_KEYS.includes(key) ? 100 : 0
}

/** The More row's words: how many are folded away, or how to fold them. */
export function moreText(hidden: number, open: boolean): string {
  return open ? 'Less' : `More (${hidden})`
}

const ON = 'llm-wiki-tidy-props'
const OPEN = 'is-llm-wiki-open'
const ROW = 'is-llm-wiki-bookkeeping'
const MORE = 'llm-wiki-props-more'

export class TidyProperties {
  private open = false
  private observer: MutationObserver | null = null
  private queued = false

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.app.workspace.onLayoutReady(() => {
      this.apply()
      // Obsidian redraws the panel on every note opened and every key added, renamed or removed.
      this.observer = new MutationObserver(() => this.queue())
      this.watch()
      p.register(() => this.observer?.disconnect())
    })
    p.register(() => {
      document.body.removeClass(ON)
      for (const el of Array.from(document.querySelectorAll(`.${MORE}`))) el.remove()
    })
  }

  /** The setting changed: turn the sorting and folding on or off. */
  apply(): void {
    document.body.toggleClass(ON, this.plugin.settings.tidyProperties)
    this.pass()
  }

  private queue(): void {
    if (this.queued) return
    this.queued = true
    window.requestAnimationFrame(() => {
      this.queued = false
      this.pass()
    })
  }

  private watch(): void {
    this.observer?.observe(this.plugin.app.workspace.containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-property-key'] })
  }

  /** One pass, unwatched: what it changes itself must not wake it again. */
  private pass(): void {
    this.observer?.disconnect()
    try {
      this.draw()
    } finally {
      this.watch()
    }
  }

  /** Every panel on screen: rows sorted and marked, the More row added where it is missing and kept counting. */
  private draw(): void {
    const on = this.plugin.settings.tidyProperties
    for (const box of Array.from(this.plugin.app.workspace.containerEl.querySelectorAll<HTMLElement>('.metadata-container'))) {
      const list = box.querySelector<HTMLElement>('.metadata-properties')
      if (!list) continue
      let hidden = 0
      for (const row of Array.from(list.querySelectorAll<HTMLElement>('.metadata-property'))) {
        const key = row.dataset.propertyKey ?? ''
        const order = on ? keyOrder(key) : 0
        if (row.style.order !== (order ? String(order) : '')) row.style.order = order ? String(order) : ''
        const bookkeeping = order === 100
        if (row.hasClass(ROW) !== bookkeeping) row.toggleClass(ROW, bookkeeping)
        if (bookkeeping) hidden++
      }
      if (box.hasClass(OPEN) !== this.open) box.toggleClass(OPEN, this.open)
      let more = box.querySelector<HTMLElement>(`.${MORE}`)
      if (!on || !hidden) {
        more?.remove()
        continue
      }
      if (!more) {
        more = createDiv({ cls: MORE, attr: { role: 'button', tabindex: '0' } })
        more.addEventListener('click', () => this.toggle())
        more.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            this.toggle()
          }
        })
        list.after(more)
      }
      const text = moreText(hidden, this.open)
      if (more.getText() !== text) more.setText(text)
      const title = this.open ? 'Hide the wiki’s bookkeeping properties' : `Show the wiki’s bookkeeping properties: ${BOOKKEEPING_KEYS.join(', ')}`
      if (more.title !== title) more.title = title
    }
  }

  private toggle(): void {
    this.open = !this.open
    this.pass()
  }
}
