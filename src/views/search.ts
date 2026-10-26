import { Component, debounce, type App } from 'obsidian'
import { log } from '../logger'
import type LlmWikiPlugin from '../main'
import { icon } from '../ui/dom'
import { openIndexModal, type StaleHit } from '../ui/indexModal'
import { CliError, type SearchAnswer, type SearchFilter, type SearchFilterKind, type SearchHit } from '../wiki/cli'
import { excerpt, holdsPassage, lineOf, passageOf, queryTerms } from '../wiki/searchText'
import type { SearchStatusAnswer } from '../wiki/snapshot'

/** One field of the filter panel: a `filter=` kind, maybe negated, and how it is typed. */
interface FieldDef {
  kind: SearchFilterKind
  negated?: true
  label: string
  placeholder?: string
  input?: 'date' | 'folder'
  options?: string[]
}

// The kinds `search query` takes, in the order a person narrows by. A comma inside one ORs.
const FIELDS: FieldDef[] = [
  { kind: 'under', label: 'In folder', placeholder: 'wiki/notes', input: 'folder' },
  { kind: 'under', negated: true, label: 'Not in folder', placeholder: 'sources/web', input: 'folder' },
  { kind: 'type', label: 'Page type', placeholder: 'concept, web-page' },
  { kind: 'tag', label: 'Tag', placeholder: 'pricing, sales' },
  { kind: 'author', label: 'Author', placeholder: 'who wrote it' },
  { kind: 'area', label: 'Area', placeholder: 'an area it is filed under' },
  { kind: 'source_host', label: 'Source site', placeholder: 'example.com' },
  { kind: 'prop', label: 'Property', placeholder: 'key=value' },
  { kind: 'curation', label: 'Curation', options: ['', 'curated', 'stale', 'unprocessed'] },
  { kind: 'captured_from', label: 'Captured from', input: 'date' },
  { kind: 'captured_to', label: 'Captured to', input: 'date' },
]
const same = (f: SearchFilter, d: FieldDef) => f.kind === d.kind && Boolean(f.negated) === Boolean(d.negated)

/** The search pane: the dashboard's Search tab. */
export class SearchPane extends Component {
  private input!: HTMLInputElement
  private filterButton!: HTMLButtonElement
  private indexButton!: HTMLButtonElement
  private panel!: HTMLElement
  private chips!: HTMLElement
  private status!: HTMLElement
  private banner!: HTMLElement
  private results!: HTMLElement
  private seq = 0
  /** The search in flight; a new one kills it rather than racing it. */
  private inFlight: AbortController | null = null
  private last: SearchAnswer | null = null
  /** Hits this session's searches found the page no longer backs, by path, until a pass lands. */
  private readonly stale = new Map<string, StaleHit>()

  private get app(): App {
    return this.plugin.app
  }

  private get filters(): SearchFilter[] {
    return this.plugin.settings.searchFilters ?? []
  }

  private get indexStatus(): SearchStatusAnswer | null {
    return this.plugin.snapshot?.search ?? null
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
    root.addClass('llm-wiki-search')
    const bar = root.createDiv({ cls: 'llm-wiki-search-bar' })
    this.input = bar.createEl('input', { type: 'search', placeholder: 'Search the wiki…', cls: 'llm-wiki-search-input' })
    this.filterButton = bar.createEl('button', { cls: 'llm-wiki-search-tool clickable-icon' })
    this.registerDomEvent(this.filterButton, 'click', () => this.togglePanel())
    this.indexButton = bar.createEl('button', { cls: 'llm-wiki-search-tool clickable-icon' })
    icon(this.indexButton, 'refresh-cw')
    this.registerDomEvent(this.indexButton, 'click', () => this.openIndex())
    this.panel = root.createDiv({ cls: 'llm-wiki-search-filters' })
    this.panel.hide()
    this.chips = root.createDiv({ cls: 'llm-wiki-search-chips' })
    this.status = root.createDiv({ cls: 'llm-wiki-muted llm-wiki-search-status' })
    this.banner = root.createDiv({ cls: 'llm-wiki-search-banner' })
    this.banner.hide()
    this.results = root.createDiv({ cls: 'llm-wiki-search-results' })
    this.results.createDiv({ cls: 'llm-wiki-muted llm-wiki-search-hint', text: 'Finds pages by meaning, through the wiki’s own search index. Enter searches now; a result opens as a note in a new tab, Cmd-click in a split.' })
    // A pause in typing searches; Enter searches now. Each search is one CLI process, so bursts are not.
    const run = debounce(() => void this.search(), 600, true)
    this.registerDomEvent(this.input, 'input', () => run())
    this.registerDomEvent(this.input, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        run.cancel()
        void this.search()
      }
      if (e.key === 'Escape') {
        run.cancel()
        this.seq++
        this.inFlight?.abort()
        this.input.value = ''
        this.last = null
        this.results.empty()
        this.banner.hide()
        this.status.setText('')
      }
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.registerEvent(this.app.workspace.on('llm-wiki:snapshot' as 'layout-change', () => this.showIndexState()))
    this.showFilters()
    this.showIndexState()
    this.showReadiness()
  }

  focus(): void {
    this.input.focus()
  }

  private showReadiness(): void {
    this.status.setText(this.plugin.wiki ? '' : this.plugin.problem ?? 'detecting…')
  }

  /** The refresh icon carries a dot when the index owes something; its tooltip says what. */
  private showIndexState(): void {
    const s = this.indexStatus
    const owed: string[] = []
    if (s?.engine_configured && s.realm_ready === false) owed.push(`the search engine is not ready${s.realm_reason ? `: ${s.realm_reason}` : ''}`)
    if (s?.dirty) owed.push(`${s.dirty} ${s.dirty === 1 ? 'file is' : 'files are'} not indexed yet`)
    if (s?.reindex_required) owed.push('the search paths changed since the last rebuild')
    if (this.stale.size) owed.push(`${this.stale.size} ${this.stale.size === 1 ? 'result was' : 'results were'} out of date`)
    this.indexButton.toggleClass('is-stale', owed.length > 0)
    this.indexButton.title = owed.length ? `Search index: ${owed.join('; ')}. Click to update it.` : 'Search index: check and update it'
    this.indexButton.ariaLabel = this.indexButton.title
  }

  openIndex(): void {
    openIndexModal(this.app, this.plugin, {
      stale: [...this.stale.values()],
      onIndexed: () => {
        this.stale.clear()
        this.showIndexState()
        if (this.input.value.trim()) void this.search()
      },
    })
  }

  private togglePanel(): void {
    const open = this.panel.style.display === 'none'
    this.panel.toggle(open)
    this.filterButton.toggleClass('is-active', open)
    if (open) this.drawPanel()
  }

  /** The filter count on its button, and one removable chip per filter in force. */
  private showFilters(): void {
    const active = this.filters
    this.filterButton.empty()
    icon(this.filterButton, 'sliders-horizontal')
    if (active.length) this.filterButton.createSpan({ cls: 'llm-wiki-search-badge', text: String(active.length) })
    this.filterButton.title = active.length ? `Filters: ${active.length} on` : 'Filters: folder, type, tag, dates…'
    this.filterButton.ariaLabel = this.filterButton.title
    this.chips.empty()
    this.chips.toggle(active.length > 0)
    for (const f of active) {
      const def = FIELDS.find((d) => same(f, d))
      const chip = this.chips.createEl('button', { cls: 'llm-wiki-chip llm-wiki-search-chip' })
      chip.createSpan({ cls: 'llm-wiki-muted', text: `${def?.label ?? f.kind}: ` })
      chip.createSpan({ text: f.value })
      icon(chip, 'x')
      chip.title = 'Remove this filter'
      chip.addEventListener('click', () => this.setFilter(def ?? { kind: f.kind, label: f.kind, ...(f.negated ? { negated: true as const } : {}) }, ''))
    }
    if (active.length > 1) {
      const clear = this.chips.createEl('button', { cls: 'llm-wiki-chip llm-wiki-search-chip is-clear', text: 'Clear all' })
      clear.addEventListener('click', () => this.setFilters([]))
    }
  }

  private drawPanel(): void {
    const panel = this.panel
    panel.empty()
    const grid = panel.createDiv({ cls: 'llm-wiki-search-filter-grid' })
    const listId = 'llm-wiki-search-folders'
    for (const def of FIELDS) {
      const current = this.filters.find((f) => same(f, def))?.value ?? ''
      const field = grid.createEl('label', { cls: 'llm-wiki-search-field' })
      field.createSpan({ cls: 'llm-wiki-muted', text: def.label })
      if (def.options) {
        const sel = field.createEl('select', { cls: 'dropdown' })
        for (const o of def.options) sel.createEl('option', { text: o || 'Any', value: o })
        sel.value = current
        sel.addEventListener('change', () => this.setFilter(def, sel.value))
        continue
      }
      const box = field.createEl('input', { type: def.input === 'date' ? 'date' : 'text', placeholder: def.placeholder ?? '', value: current })
      if (def.input === 'folder') box.setAttribute('list', listId)
      // A field commits on change (blur or Enter), not per keystroke: each commit is a search.
      box.addEventListener('change', () => this.setFilter(def, box.value))
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') box.blur()
      })
    }
    const folders = panel.createEl('datalist')
    folders.id = listId
    for (const f of this.folders()) folders.createEl('option', { value: f })
    const foot = panel.createDiv({ cls: 'llm-wiki-search-filter-foot' })
    foot.createSpan({ cls: 'llm-wiki-muted', text: 'Commas mean any of: tag “a, b” finds either. Filters stay on until you clear them.' })
    const clear = foot.createEl('button', { text: 'Clear filters' })
    clear.disabled = !this.filters.length
    clear.addEventListener('click', () => this.setFilters([]))
  }

  /** The vault's folders under what search answers from, for the folder fields. */
  private folders(): string[] {
    const include = (this.indexStatus?.paths ?? []).map((p) => p.pattern)
    const all = this.app.vault.getAllLoadedFiles?.() ?? []
    return all
      .filter((f) => 'children' in f && f.path !== '/' && (!include.length || include.some((p) => `${f.path}/`.startsWith(p))))
      .map((f) => `${f.path}/`)
      .sort()
  }

  private setFilter(def: FieldDef, value: string): void {
    const rest = this.filters.filter((f) => !same(f, def))
    const v = value.trim()
    this.setFilters(v ? [...rest, { kind: def.kind, value: v, ...(def.negated ? { negated: true } : {}) }] : rest)
  }

  private setFilters(next: SearchFilter[]): void {
    this.plugin.settings.searchFilters = next
    void this.plugin.saveSettings()
    this.showFilters()
    if (this.panel.style.display !== 'none') this.drawPanel()
    if (this.input.value.trim()) void this.search()
  }

  private async search(): Promise<void> {
    const q = this.input.value.trim()
    const { cli, wiki } = this.plugin
    if (!q || !cli || !wiki) return
    const mine = ++this.seq
    this.inFlight?.abort()
    const abort = new AbortController()
    this.inFlight = abort
    this.status.setText('Searching…')
    try {
      const ans = await cli.run<SearchAnswer>('wiki.search.query', { wiki: wiki.key, text: q, k: this.plugin.settings.searchK, filters: this.filters }, { signal: abort.signal })
      if (mine !== this.seq) return
      this.last = ans
      this.render(ans, q, mine)
    } catch (e) {
      if (mine !== this.seq) return
      const msg = e instanceof CliError ? e.message : String(e)
      log.warn('search', msg)
      this.status.setText(msg)
    }
  }

  private render(ans: SearchAnswer, q: string, mine: number): void {
    const hits = ans.hits ?? []
    const why = (ans.degradations ?? []).map((d) => d.detail).filter(Boolean).join('; ')
    const marker = ans.backend_metadata?.index_as_of?.source_commit
    const head = ans._cmd_?.head
    const behind = Boolean(marker && head && !head.startsWith(marker.slice(0, 7)))
    const notes = [
      hits.length ? `${hits.length} ${hits.length === 1 ? 'hit' : 'hits'}` : 'No pages match',
      ans.backend ?? '',
      marker ? `index built at ${marker.slice(0, 7)}${behind ? ', older than this checkout' : ''}` : '',
      ans.degraded ? `degraded${why ? `: ${why}` : ''}` : '',
      ans.filter_recall_incomplete ? 'some filters could not be applied everywhere; matches may be missing' : '',
    ].filter(Boolean)
    this.status.setText(notes.join(' · '))
    this.status.toggleClass('is-behind', behind)
    this.banner.hide()
    this.results.empty()
    // Rows are rebuilt per search; the DOM owns their listeners with the node.
    const ask = this.results.createEl('button', { cls: 'llm-wiki-chip', text: 'Ask the agent about this' })
    ask.addEventListener('click', () => void this.plugin.openChat(`About "${q}" in this wiki: `))
    const terms = queryTerms(q)
    const checks = hits.map((h) => this.hit(h, terms))
    // The pages are read after the rows are on screen: a stale mark arrives a beat later, never a blank list.
    void Promise.all(checks.map((c) => c())).then((verdicts) => {
      if (mine !== this.seq) return
      this.showBanner(verdicts.filter((v) => v !== 'ok').length, hits.length)
    })
  }

  /** One row now; the returned check reads the page and marks the row when the index's copy is older. */
  private hit(h: SearchHit, terms: string[]): () => Promise<'ok' | 'changed' | 'deleted'> {
    const path = h.source_path ?? h.locator ?? ''
    const row = this.results.createDiv({ cls: 'llm-wiki-hit' })
    const top = row.createDiv({ cls: 'llm-wiki-hit-head' })
    top.createSpan({ cls: 'llm-wiki-hit-title', text: h.title || path })
    const where = row.createDiv({ cls: 'llm-wiki-hit-path llm-wiki-muted' })
    const pathEl = where.createSpan({ text: path })
    if (h.passages_retained && h.passages_retained > 1) where.createSpan({ text: ` · ${h.passages_retained}${h.passages_truncated ? '+' : ''} passages` })
    const passage = passageOf(h)
    const snip = row.createDiv({ cls: 'llm-wiki-hit-snippet' })
    for (const seg of excerpt(passage, terms)) {
      if (seg.mark) snip.createEl('mark', { text: seg.text })
      else snip.createSpan({ text: seg.text })
    }
    let line = typeof h.line === 'number' ? h.line : null
    let gone = false
    if (line) pathEl.setText(`${path}:${line}`)
    row.addEventListener('click', (ev) => {
      if (gone) return
      void this.app.workspace.openLinkText(path, '', ev.metaKey || ev.ctrlKey ? 'split' : 'tab', line ? { eState: { line: line - 1 } } : undefined)
    })
    return async () => {
      const verdict = await this.check(path, passage, h)
      if (verdict.line && !line) {
        line = verdict.line
        pathEl.setText(`${path}:${line}`)
      }
      if (verdict.why === 'ok') {
        this.stale.delete(path)
      } else {
        gone = verdict.why === 'deleted'
        row.addClass(gone ? 'is-gone' : 'is-stale')
        const p = top.createSpan({ cls: `llm-wiki-pill is-${gone ? 'error' : 'warn'}`, text: gone ? 'page deleted' : 'text changed' })
        p.title = gone
          ? 'This page no longer exists. The index still holds it; a rebuild removes it.'
          : 'The page no longer says this. The index holds an older copy; updating the index fixes it.'
        this.stale.set(path, { path, why: verdict.why })
      }
      this.showIndexState()
      return verdict.why
    }
  }

  /** The page, read now, against the passage the index answered with. A grep hit was read live and is never stale. */
  private async check(path: string, passage: string, h: SearchHit): Promise<{ why: 'ok' | 'changed' | 'deleted'; line?: number }> {
    if (!path || (h.backend ?? this.last?.backend) === 'grep') return { why: 'ok' }
    const adapter = this.app.vault.adapter
    try {
      if (!(await adapter.exists(path))) return { why: 'deleted' }
      const text = await adapter.read(path)
      const holds = holdsPassage(text, passage)
      if (holds === false) return { why: 'changed' }
      return { why: 'ok', line: holds ? lineOf(text, passage) ?? undefined : undefined }
    } catch {
      // A page this process cannot read is not a page that changed.
      return { why: 'ok' }
    }
  }

  /** One line over the results when some of them come from an older copy of their page. */
  private showBanner(stale: number, total: number): void {
    this.banner.empty()
    this.banner.toggle(stale > 0)
    if (!stale) return
    icon(this.banner, 'triangle-alert')
    this.banner.createSpan({ text: `${stale} of ${total} ${total === 1 ? 'result is' : 'results are'} out of date: the index holds an older copy of ${stale === 1 ? 'that page' : 'those pages'}.` })
    const fix = this.banner.createEl('button', { cls: 'mod-cta', text: 'Update the index' })
    fix.addEventListener('click', () => this.openIndex())
  }
}
