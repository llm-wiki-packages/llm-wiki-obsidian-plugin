// Lent values in a page's Properties panel (design-lend-and-state.md §2.1, §3.1).
// On a bundle root, each key it lends gets a mark that says how many pages the
// value reaches. On a page under one, each lent value is muted with the root it
// comes from, and a lent list item is a dashed pill with no remove button. A line
// under the panel says it in words, with the Why? panel a click away. Read-only:
// nothing here writes a file.
//
// Internal, as read from Obsidian 1.15: a row is `.metadata-property[data-property-key]`,
// its key cell `.metadata-property-key`, its value `.metadata-property-value`, a list
// value's items `.multi-select-pill` with `.multi-select-pill-content`. The line
// under the panel is ours, so it carries the message when the rows change shape.
import { Keymap, MarkdownView, TFile, setIcon, type App } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { openExplain } from '../ui/explainModal'
import { LendIndex, inherits, lendsTitle, lentTitle, lineText, rootName, type Fm, type RowCue } from './lends'

const LENDS = 'is-llm-wiki-lends'
const LENT = 'is-llm-wiki-lent'
const MARK = 'llm-wiki-lend-mark'
const FROM = 'llm-wiki-lent-from'
const LINE = 'llm-wiki-bundle-line'
/** A pill whose tooltip is ours, so it is taken off when the item stops being lent. */
const LABELLED = 'has-llm-wiki-label'

/** The icons: a root's value going down into its pages, and a page's value coming from above. */
export const LENDS_ICON = 'layers'
export const LENT_ICON = 'corner-left-up'

/** The file a Properties panel shows: its editor's file, or, in the sidebar's panel, the active one. */
export function fileOfPanel(app: App, box: HTMLElement): TFile | null {
  let found: TFile | null = null
  app.workspace.iterateAllLeaves((leaf) => {
    if (found || !leaf.view.containerEl.contains(box)) return
    const file = (leaf.view as { file?: unknown }).file
    if (file instanceof TFile) found = file
  })
  return found ?? app.workspace.getActiveFile()
}

export class LendCues {
  private index: LendIndex | null = null

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    let timer: number | null = null
    // A root's edit changes what its children's rows say, and a new page changes a root's count.
    const changed = () => {
      this.index = null
      if (timer !== null) return
      timer = window.setTimeout(() => {
        timer = null
        p.properties.refresh()
      }, 150)
    }
    p.app.workspace.onLayoutReady(() => {
      p.registerEvent(p.app.metadataCache.on('changed', changed))
      p.registerEvent(p.app.metadataCache.on('deleted', changed))
      p.registerEvent(p.app.vault.on('rename', changed))
      p.registerEvent(p.app.vault.on('delete', changed))
      // The Why? link needs the wiki, found after the layout is ready.
      p.registerEvent(p.app.workspace.on('llm-wiki:snapshot' as 'layout-change', () => p.properties.refresh()))
    })
    p.register(() => {
      if (timer !== null) window.clearTimeout(timer)
      this.clear(document.body)
    })
  }

  private lendIndex(): LendIndex {
    if (this.index) return this.index
    const { vault, metadataCache } = this.plugin.app
    const files = vault.getMarkdownFiles().filter((f) => inherits(f.path))
    this.index = new LendIndex(files.map((f) => ({ path: f.path, fm: metadataCache.getFileCache(f)?.frontmatter })))
    return this.index
  }

  /** Take every cue off: the setting is off, or the plugin unloads. */
  private clear(root: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll(`.${MARK}, .${FROM}, .${LINE}`))) el.remove()
    for (const el of Array.from(root.querySelectorAll(`.${LABELLED}`))) el.removeAttribute('aria-label')
    for (const el of Array.from(root.querySelectorAll(`.${LENDS}, .${LENT}, .${LABELLED}`))) el.removeClass(LENDS, LENT, LABELLED)
  }

  /** One panel, marked to match its file. Called from the Properties pass, unwatched, so it changes only what differs. */
  draw(box: HTMLElement, list: HTMLElement): void {
    if (!this.plugin.settings.lendCues) {
      this.clear(box)
      return
    }
    const file = fileOfPanel(this.plugin.app, box)
    if (!file || !inherits(file.path)) {
      this.clear(box)
      return
    }
    const index = this.lendIndex()
    // The cache's own copy is fresher than the index's after a keystroke in this file.
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
    const cues = index.cues(file.path, fm)
    for (const row of Array.from(list.querySelectorAll<HTMLElement>('.metadata-property'))) {
      this.row(row, cues.get(row.dataset.propertyKey ?? ''))
    }
    this.line(box, list, file.path, index, fm)
  }

  private row(row: HTMLElement, cue: RowCue | undefined): void {
    const lends = !!cue?.lends
    const lent = !!cue?.lent && !lends
    if (row.hasClass(LENDS) !== lends) row.toggleClass(LENDS, lends)
    if (row.hasClass(LENT) !== lent) row.toggleClass(LENT, lent)
    const keyEl = row.querySelector<HTMLElement>('.metadata-property-key')
    let mark = row.querySelector<HTMLElement>(`.${MARK}`)
    const title = cue?.lends ? lendsTitle(cue.lends) : cue?.lent ? lentTitle({ ...cue.lent, from: rootName(cue.lent.from) }) : null
    if (!title || !keyEl) mark?.remove()
    else {
      const name = lends ? LENDS_ICON : LENT_ICON
      if (!mark || mark.dataset.icon !== name) {
        mark?.remove()
        mark = createSpan({ cls: MARK, attr: { 'data-icon': name } })
        setIcon(mark, name)
        keyEl.prepend(mark)
      }
      if (mark.getAttr('aria-label') !== title) mark.setAttr('aria-label', title)
    }
    // A lent single value names its root after the value; a list marks its lent items instead.
    const single = cue?.lent && cue.lent.items === null ? cue.lent.from : null
    let from = row.querySelector<HTMLElement>(`.${FROM}`)
    if (!single || lends) from?.remove()
    else if (!from || from.dataset.root !== single) {
      from?.remove()
      from = createEl('a', { cls: FROM, text: `from ${rootName(single)}`, attr: { href: '#', 'data-root': single, 'aria-label': lentTitle({ from: single, items: null }) } })
      from.addEventListener('click', (e) => this.open(e, single))
      row.append(from)
    }
    const items = cue?.lent?.items ?? null
    for (const pill of Array.from(row.querySelectorAll<HTMLElement>('.multi-select-pill'))) {
      const t = pill.querySelector('.multi-select-pill-content')?.textContent ?? ''
      const isLent = !!items?.has(t)
      if (pill.hasClass(LENT) !== isLent) pill.toggleClass(LENT, isLent)
      const label = isLent && cue?.lent ? lentTitle({ ...cue.lent, from: rootName(cue.lent.from) }) : null
      if (label) {
        if (pill.getAttr('aria-label') !== label) pill.setAttr('aria-label', label)
      } else if (pill.hasClass(LABELLED)) pill.removeAttribute('aria-label')
      if (pill.hasClass(LABELLED) !== !!label) pill.toggleClass(LABELLED, !!label)
    }
  }

  private line(box: HTMLElement, list: HTMLElement, path: string, index: LendIndex, fm: Fm | undefined): void {
    const s = index.summary(path, fm)
    let el = box.querySelector<HTMLElement>(`.${LINE}`)
    const canExplain = !!this.plugin.cli && !!this.plugin.wiki
    const drawn = s ? JSON.stringify([s, canExplain]) : ''
    if (!s) {
      el?.remove()
      return
    }
    if (el && el.dataset.drawn === drawn) return
    el?.remove()
    el = createDiv({ cls: LINE, attr: { 'data-drawn': drawn } })
    const words = lineText(s)
    if (words.lends) {
      const part = el.createSpan({ cls: 'llm-wiki-bundle-part' })
      setIcon(part.createSpan({ cls: 'llm-wiki-bundle-icon' }), LENDS_ICON)
      part.createSpan({ text: words.lends })
    }
    if (words.lent) {
      if (words.lends) el.createSpan({ cls: 'llm-wiki-muted', text: ' · ' })
      const part = el.createSpan({ cls: 'llm-wiki-bundle-part' })
      setIcon(part.createSpan({ cls: 'llm-wiki-bundle-icon' }), LENT_ICON)
      part.createSpan({ text: `${words.lent} ` })
      s.from.forEach((root, i) => {
        if (i) part.createSpan({ text: ', ' })
        const a = part.createEl('a', { text: rootName(root), attr: { href: '#', 'aria-label': root } })
        a.addEventListener('click', (e) => this.open(e, root))
      })
      if (canExplain) {
        el.createSpan({ cls: 'llm-wiki-muted', text: ' · ' })
        const why = el.createEl('a', { cls: 'llm-wiki-bundle-why', text: 'Why?', attr: { href: '#', 'aria-label': 'Where each value comes from, and what the next write changes' } })
        why.addEventListener('click', (e) => {
          e.preventDefault()
          openExplain(this.plugin, path)
        })
      }
    }
    // After the More row when there is one, so the line stays last.
    const more = box.querySelector<HTMLElement>('.llm-wiki-props-more')
    ;(more ?? list).after(el)
  }

  private open(e: MouseEvent, root: string): void {
    e.preventDefault()
    e.stopPropagation()
    const file = this.plugin.app.vault.getFileByPath(root)
    if (file) void this.plugin.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(file)
  }
}

/** The Why? command's target: the active note, when it sits where pages inherit. */
export function explainTarget(app: App): string | null {
  const view = app.workspace.getActiveViewOfType(MarkdownView)
  const path = view?.file?.path ?? null
  return path && inherits(path) ? path : null
}
