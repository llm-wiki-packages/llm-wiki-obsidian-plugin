// The Sources panel on an open note: on a wiki page, the sources its frontmatter
// cites, each with the section and the quoted words, a click away; on a source,
// the pages that cite it. It sits in the empty right margin beside the text when
// the pane is wide enough, else at the bottom, just above Linked mentions. The
// note itself is never changed.
//
// Internal, as read from Obsidian 1.15: the editing view's sizer is `.cm-sizer`
// and reading view's footer is `.markdown-preview-sizer > .mod-footer`, the two
// places Obsidian itself moves Linked mentions (`.embedded-backlinks`) between.
// `eState.match` is what search and Backlinks open a note with to highlight a range.
import { Keymap, MarkdownView, TFile, type WorkspaceLeaf } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { log } from '../logger'
import { CiteIndex, citesOf, grouped, locate, placeIn, sideWidth, sourceRows, type Row } from '../vault/citations'

const HOVER = 'llm-wiki-sources'

interface Mount {
  side: HTMLElement
  bottom: HTMLElement
  observer: ResizeObserver
  /** What was last drawn, so an unchanged panel is not redrawn. */
  drawn: string
}

/** One section's content: a heading and its rows. */
interface Section {
  title: string
  rows: Row[]
  /** The file a quote's passage is in: each row's own file, or this note. */
  quoteIn: 'row' | 'self'
}

export class SourcesPanel {
  private readonly index = new CiteIndex()
  private stale = true
  private readonly mounts = new Map<MarkdownView, Mount>()
  private timer: number | null = null

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.registerHoverLinkSource(HOVER, { display: 'LLM wiki sources panel', defaultMod: true })
    p.app.workspace.onLayoutReady(() => {
      const ws = p.app.workspace
      const soon = () => this.schedule()
      const changed = () => {
        this.stale = true
        this.schedule()
      }
      p.registerEvent(ws.on('file-open', soon))
      p.registerEvent(ws.on('layout-change', soon))
      p.registerEvent(ws.on('active-leaf-change', soon))
      p.registerEvent(ws.on('css-change', soon))
      p.registerEvent(p.app.metadataCache.on('changed', changed))
      p.registerEvent(p.app.metadataCache.on('deleted', changed))
      p.registerEvent(p.app.vault.on('rename', changed))
      p.registerEvent(p.app.vault.on('create', changed))
      p.registerEvent(p.app.vault.on('delete', changed))
      this.schedule()
    })
    p.register(() => {
      if (this.timer !== null) window.clearTimeout(this.timer)
      for (const view of [...this.mounts.keys()]) this.unmount(view)
    })
  }

  /** The setting changed: redraw every open note. */
  refresh(): void {
    for (const m of this.mounts.values()) m.drawn = ''
    this.schedule()
  }

  private schedule(): void {
    if (this.timer !== null) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.guard(() => this.pass())
    }, 100)
  }

  private pass(): void {
    const open = new Set<MarkdownView>()
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView) open.add(leaf.view)
    }
    for (const view of [...this.mounts.keys()]) if (!open.has(view)) this.unmount(view)
    if (this.plugin.settings.sourcesPanel === 'off') {
      for (const view of [...this.mounts.keys()]) this.unmount(view)
      return
    }
    if (this.stale) this.reindex()
    for (const view of open) this.guard(() => this.show(view))
  }

  private reindex(): void {
    const { vault, metadataCache } = this.plugin.app
    this.stale = false
    this.index.rebuild(
      vault.getMarkdownFiles().map((f) => {
        const fm = metadataCache.getFileCache(f)?.frontmatter
        return { path: f.path, title: fm?.title as unknown, frontmatter: fm }
      }),
      (resource, from) => this.resolve(resource, from)?.path ?? null,
    )
  }

  private resolve(resource: string, from: string): TFile | null {
    const { vault, metadataCache } = this.plugin.app
    return vault.getFileByPath(resource) ?? metadataCache.getFirstLinkpathDest(resource.replace(/\.md$/, ''), from)
  }

  private sections(file: TFile): Section[] {
    const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
    const out: Section[] = []
    const sources = sourceRows(citesOf(fm), (r) => this.resolve(r, file.path)?.path ?? null)
    if (sources.length) out.push({ title: 'Sources', rows: sources, quoteIn: 'row' })
    const citing = this.index.citing(file.path)
    if (citing.length) out.push({ title: 'Cited by', rows: citing, quoteIn: 'self' })
    return out
  }

  private show(view: MarkdownView): void {
    const file = view.file
    const sections = file ? this.sections(file) : []
    if (!file || sections.length === 0) {
      this.unmount(view)
      return
    }
    let m = this.mounts.get(view)
    if (!m) {
      const side = createDiv({ cls: 'llm-wiki-sources is-side' })
      const bottom = createDiv({ cls: 'llm-wiki-sources is-bottom' })
      const observer = new ResizeObserver(() => this.guard(() => this.place(view)))
      observer.observe(view.contentEl)
      m = { side, bottom, observer, drawn: '' }
      this.mounts.set(view, m)
    }
    const key = JSON.stringify([file.path, sections])
    if (m.drawn !== key) {
      m.drawn = key
      for (const el of [m.side, m.bottom]) this.draw(el, view, file, sections)
    }
    this.place(view)
  }

  /** Put each copy where the setting and the room beside the text say. */
  private place(view: MarkdownView): void {
    const m = this.mounts.get(view)
    if (!m) return
    const host = view.contentEl
    const preview = view.getMode() === 'preview'
    const sizer = preview
      ? view.previewMode.containerEl.querySelector<HTMLElement>('.markdown-preview-sizer')
      : host.querySelector<HTMLElement>('.markdown-source-view .cm-sizer')
    const free = sizer && host.isShown() ? host.getBoundingClientRect().right - sizer.getBoundingClientRect().right : 0
    const width = sideWidth(free)
    const where = placeIn(this.plugin.settings.sourcesPanel, width)

    if (where.side && width !== null) {
      host.addClass('llm-wiki-sources-host')
      m.side.setCssProps({ '--llm-wiki-sources-width': `${width}px` })
      if (m.side.parentElement !== host) host.appendChild(m.side)
    } else {
      m.side.detach()
      host.removeClass('llm-wiki-sources-host')
    }

    const footer = preview ? sizer?.querySelector<HTMLElement>(':scope > .mod-footer') ?? sizer : sizer
    if (where.bottom && footer) {
      const backlinks = footer.querySelector<HTMLElement>(':scope > .embedded-backlinks')
      if (backlinks) {
        if (m.bottom.nextElementSibling !== backlinks) footer.insertBefore(m.bottom, backlinks)
      } else if (m.bottom.parentElement !== footer || footer.lastElementChild !== m.bottom) footer.appendChild(m.bottom)
    } else {
      m.bottom.detach()
    }
  }

  private draw(el: HTMLElement, view: MarkdownView, file: TFile, sections: Section[]): void {
    el.empty()
    for (const s of sections) {
      const box = el.createDiv({ cls: 'llm-wiki-sources-section' })
      const head = box.createDiv({ cls: 'llm-wiki-sources-title' })
      head.createSpan({ text: s.title })
      head.createSpan({ cls: 'llm-wiki-sources-count', text: String(s.rows.length) })
      for (const g of grouped(s.rows)) {
        box.createDiv({ cls: 'llm-wiki-sources-group', text: g.label })
        for (const row of g.rows) this.drawRow(box, view, file, row, s.quoteIn === 'row' ? row.path : file.path)
      }
    }
  }

  private drawRow(box: HTMLElement, view: MarkdownView, file: TFile, row: Row, quoteIn: string): void {
    const item = box.createDiv({ cls: 'llm-wiki-sources-row' })
    const name = item.createEl('a', { cls: 'llm-wiki-sources-name internal-link', text: row.name, href: row.path })
    if (row.exists) {
      name.addEventListener('click', (e) => {
        e.preventDefault()
        this.open(view.leaf, row.path, e)
      })
      name.addEventListener('mouseover', (e) => {
        this.plugin.app.workspace.trigger('hover-link', { event: e, source: HOVER, hoverParent: view, targetEl: name, linktext: row.path, sourcePath: file.path })
      })
    } else {
      name.addClass('is-unresolved')
      name.title = `${row.path}: no such file in this vault`
    }
    for (const c of row.cites) {
      const cite = item.createDiv({ cls: 'llm-wiki-sources-cite' })
      const line = cite.createDiv({ cls: 'llm-wiki-sources-span' })
      const quote = c.quote
      if (quote) {
        line.addClass('is-foldable')
        line.createSpan({ cls: 'llm-wiki-sources-chevron', text: '›' })
      }
      line.createSpan({ text: c.span ?? 'Quote' })
      if (!quote) continue
      const body = cite.createDiv({ cls: 'llm-wiki-sources-quote', text: `“${quote}”` })
      body.title = 'Open the source at this passage'
      line.addEventListener('click', () => cite.toggleClass('is-open', !cite.hasClass('is-open')))
      if (!row.exists && quoteIn === row.path) continue
      body.addEventListener('click', (e) => void this.openAt(view.leaf, quoteIn, quote, c.span, e))
    }
  }

  private open(leaf: WorkspaceLeaf, path: string, e: MouseEvent): void {
    const target = this.plugin.app.vault.getFileByPath(path)
    if (!target) return
    const to = Keymap.isModEvent(e) ? this.plugin.app.workspace.getLeaf(Keymap.isModEvent(e)) : leaf
    void to.openFile(target)
  }

  /** Open `path` scrolled to the quoted words, highlighted as search does; or to the span's heading. */
  private async openAt(leaf: WorkspaceLeaf, path: string, quote: string, span: string | undefined, e: MouseEvent): Promise<void> {
    const target = this.plugin.app.vault.getFileByPath(path)
    if (!(target instanceof TFile)) return
    try {
      const text = await this.plugin.app.vault.cachedRead(target)
      const spot = locate(text, quote, span)
      const eState = !spot ? undefined : 'from' in spot ? { line: spot.line, match: { content: text, matches: [[spot.from, spot.to]] } } : { line: spot.line }
      const to = Keymap.isModEvent(e) ? this.plugin.app.workspace.getLeaf(Keymap.isModEvent(e)) : leaf
      await to.openFile(target, { eState })
    } catch (err) {
      log.warn('sources panel: open', err)
    }
  }

  private unmount(view: MarkdownView): void {
    const m = this.mounts.get(view)
    if (!m) return
    m.observer.disconnect()
    m.side.detach()
    m.bottom.detach()
    view.contentEl.removeClass('llm-wiki-sources-host')
    this.mounts.delete(view)
  }

  private guard(run: () => void): void {
    try {
      run()
    } catch (e) {
      log.warn('sources panel:', e)
    }
  }
}
