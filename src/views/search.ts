import { ItemView, debounce, type WorkspaceLeaf } from 'obsidian'
import { log } from '../logger'
import type LlmWikiPlugin from '../main'
import { CliError, type SearchAnswer } from '../wiki/cli'

export const VIEW_SEARCH = 'llm-wiki-search'

export class SearchView extends ItemView {
  private input!: HTMLInputElement
  private status!: HTMLElement
  private results!: HTMLElement
  private seq = 0

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_SEARCH
  }

  getDisplayText(): string {
    return 'LLM wiki search'
  }

  getIcon(): string {
    return 'search'
  }

  onOpen(): Promise<void> {
    const root = this.contentEl
    root.empty()
    root.addClass('llm-wiki')
    const bar = root.createDiv({ cls: 'llm-wiki-search-bar' })
    this.input = bar.createEl('input', { type: 'search', placeholder: 'Search the wiki…', cls: 'llm-wiki-search-input' })
    this.status = root.createDiv({ cls: 'llm-wiki-muted llm-wiki-search-status' })
    this.results = root.createDiv({ cls: 'llm-wiki-search-results' })
    const run = debounce(() => void this.search(), 300, true)
    this.registerDomEvent(this.input, 'input', () => run())
    this.registerDomEvent(this.input, 'keydown', (e) => {
      if (e.key === 'Enter') void this.search()
      if (e.key === 'Escape') {
        this.input.value = ''
        this.results.empty()
      }
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.showReadiness()
    return Promise.resolve()
  }

  private showReadiness(): void {
    this.status.setText(this.plugin.wiki ? `wiki ${this.plugin.wiki.key}` : this.plugin.problem ?? 'detecting…')
  }

  private async search(): Promise<void> {
    const q = this.input.value.trim()
    const { cli, wiki } = this.plugin
    if (!q || !cli || !wiki) return
    const mine = ++this.seq
    this.status.setText('Searching…')
    try {
      const ans = await cli.run<SearchAnswer>('wiki.search.query', { wiki: wiki.key, text: q, k: this.plugin.settings.searchK })
      if (mine !== this.seq) return
      this.render(ans)
    } catch (e) {
      if (mine !== this.seq) return
      const msg = e instanceof CliError ? e.message : String(e)
      log.warn('search', msg)
      this.status.setText(msg)
    }
  }

  private render(ans: SearchAnswer): void {
    const hits = ans.hits ?? []
    const notes = [`${hits.length} hits`, ans.backend ?? '', ans.degraded ? 'degraded' : ''].filter(Boolean)
    this.status.setText(notes.join(' · '))
    this.results.empty()
    for (const h of hits) {
      const path = h.source_path ?? h.locator ?? ''
      const row = this.results.createDiv({ cls: 'llm-wiki-hit' })
      row.createDiv({ cls: 'llm-wiki-hit-title', text: h.title || path })
      row.createDiv({ cls: 'llm-wiki-hit-path llm-wiki-muted', text: path })
      if (h.snippet) row.createDiv({ cls: 'llm-wiki-hit-snippet', text: h.snippet.replace(/\s+/g, ' ').trim() })
      this.registerDomEvent(row, 'click', (ev) => {
        void this.app.workspace.openLinkText(path, '', ev.metaKey || ev.ctrlKey)
      })
    }
  }
}
