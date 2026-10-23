import { Component, debounce, type App } from 'obsidian'
import { log } from '../logger'
import type LlmWikiPlugin from '../main'
import { CliError, type SearchAnswer } from '../wiki/cli'

/** The search pane: the dashboard's Search tab. */
export class SearchPane extends Component {
  private input!: HTMLInputElement
  private status!: HTMLElement
  private results!: HTMLElement
  private seq = 0
  /** The search in flight; a new one kills it rather than racing it. */
  private inFlight: AbortController | null = null

  private get app(): App {
    return this.plugin.app
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
    this.status = root.createDiv({ cls: 'llm-wiki-muted llm-wiki-search-status' })
    this.results = root.createDiv({ cls: 'llm-wiki-search-results' })
    this.results.createDiv({ cls: 'llm-wiki-muted llm-wiki-search-hint', text: 'Finds pages by meaning, through the wiki’s own search index. Enter searches now; a result opens as a note, Cmd-click in a new tab.' })
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
        this.results.empty()
        this.status.setText('')
      }
    })
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => this.showReadiness()))
    this.showReadiness()
  }

  focus(): void {
    this.input.focus()
  }

  private showReadiness(): void {
    this.status.setText(this.plugin.wiki ? '' : this.plugin.problem ?? 'detecting…')
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
      const ans = await cli.run<SearchAnswer>('wiki.search.query', { wiki: wiki.key, text: q, k: this.plugin.settings.searchK }, { signal: abort.signal })
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
    const why = (ans.degradations ?? []).map((d) => d.detail).filter(Boolean).join('; ')
    const notes = [hits.length ? `${hits.length} ${hits.length === 1 ? 'hit' : 'hits'}` : 'No pages match', ans.backend ?? '', ans.degraded ? `degraded${why ? `: ${why}` : ''}` : ''].filter(Boolean)
    this.status.setText(notes.join(' · '))
    this.results.empty()
    const q = this.input.value.trim()
    // Rows are rebuilt per search; the DOM owns their listeners with the node.
    const ask = this.results.createEl('button', { cls: 'llm-wiki-chip', text: 'Ask the agent about this' })
    ask.addEventListener('click', () => void this.plugin.openChat(`About "${q}" in this wiki: `))
    for (const h of hits) {
      const path = h.source_path ?? h.locator ?? ''
      const row = this.results.createDiv({ cls: 'llm-wiki-hit' })
      row.createDiv({ cls: 'llm-wiki-hit-title', text: h.title || path })
      row.createDiv({ cls: 'llm-wiki-hit-path llm-wiki-muted', text: path })
      if (h.snippet) row.createDiv({ cls: 'llm-wiki-hit-snippet', text: h.snippet.replace(/\s+/g, ' ').trim() })
      row.addEventListener('click', (ev) => {
        void this.app.workspace.openLinkText(path, '', ev.metaKey || ev.ctrlKey)
      })
    }
  }
}
