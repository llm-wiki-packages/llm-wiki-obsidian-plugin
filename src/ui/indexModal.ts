import { Modal, Notice, type App } from 'obsidian'
import type LlmWikiPlugin from '../main'
import type { Outcome } from '../wiki/actions'
import { CliError } from '../wiki/cli'
import { corpusTrees, inCorpus } from '../wiki/searchText'
import type { SearchStatusAnswer } from '../wiki/snapshot'
import { button, icon, type Tone } from './dom'
import { confirm } from './modals'

/** A hit the last searches showed that the page no longer backs. */
export interface StaleHit {
  path: string
  why: 'deleted' | 'changed'
}

export interface IndexModalOptions {
  stale: StaleHit[]
  /** After a pass that went in: the pane clears what it saw and searches again. */
  onIndexed: () => void
}

const SHORT = 7
const LISTED = 40
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, SHORT) : '')
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

/** What the index owes, in one verdict, and the two passes that pay it. */
export function openIndexModal(app: App, plugin: LlmWikiPlugin, opts: IndexModalOptions): void {
  new IndexModal(app, plugin, opts).open()
}

class IndexModal extends Modal {
  private status: SearchStatusAnswer | null = null
  private changed: string[] | null = null
  private running: 'index' | 'reindex' | null = null
  private outcome: Outcome | null = null
  private problem = ''

  constructor(
    app: App,
    private readonly plugin: LlmWikiPlugin,
    private readonly opts: IndexModalOptions,
  ) {
    super(app)
  }

  onOpen(): void {
    this.setTitle('Search index')
    this.modalEl.addClass('llm-wiki-index-modal')
    this.draw()
    void this.load()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async load(): Promise<void> {
    const { cli, wiki } = this.plugin
    if (!cli || !wiki) return
    try {
      this.status = await cli.run<SearchStatusAnswer>('wiki.search.status', { wiki: wiki.key })
      this.problem = ''
    } catch (e) {
      this.problem = e instanceof CliError ? e.short : String(e)
    }
    this.changed = null
    this.draw()
    // The files themselves: what moved since the commit the index was built at, under the trees it owes.
    const s = this.status
    const marker = s?.index_as_of?.source_commit
    if (!s?.dirty || !marker || s.marker_known === false) return
    const include = (s.paths ?? []).map((p) => p.pattern)
    const exclude = (s.not_indexed ?? []).map((p) => p.pattern)
    try {
      const a = await cli.run<{ files?: string[] }>('wiki.git.changed', { wiki: wiki.key, commit: marker, dirs: corpusTrees(include) })
      this.changed = (a.files ?? []).filter((f) => inCorpus(f, include, exclude)).sort()
    } catch {
      this.changed = []
    }
    this.draw()
  }

  /** The one sentence at the top, and how loud it is. */
  private verdict(): { tone: Tone; title: string; detail: string } {
    const s = this.status
    const deleted = this.opts.stale.filter((h) => h.why === 'deleted').length
    const changed = this.opts.stale.length - deleted
    if (this.problem) return { tone: 'error', title: 'Could not read the search status', detail: this.problem }
    if (!s) return { tone: 'muted', title: 'Reading the search status…', detail: '' }
    if (!s.engine_configured) return { tone: 'ok', title: 'This wiki searches with grep', detail: 'Grep reads the files as they are now, so there is no index to go stale.' }
    if (s.realm_ready === false) return { tone: 'error', title: 'The search engine is not ready', detail: `${s.realm_reason || 'no reason given'}. A rebuild sets it up again where it can.` }
    if (deleted) return { tone: 'error', title: `Search is answering with ${plural(deleted, 'deleted page')}`, detail: 'Only a rebuild removes pages that no longer exist.' }
    if (s.reindex_required) return { tone: 'warn', title: 'The search paths changed since the last rebuild', detail: 'Pages that no longer belong may still turn up. A rebuild drops them.' }
    if (s.dirty) return { tone: 'warn', title: `${plural(s.dirty, 'file')} changed since the last index`, detail: changed ? `${plural(changed, 'result')} in your last searches showed text the page no longer has.` : 'Search may show old text for them, or miss what is new.' }
    if (changed) return { tone: 'warn', title: `${plural(changed, 'result')} showed text the page no longer has`, detail: 'The index holds an older copy. A rebuild re-reads every page.' }
    return { tone: 'ok', title: 'The index is up to date', detail: `Every one of the ${plural(s.corpus_files ?? 0, 'file')} is indexed as it is now.` }
  }

  /** Which pass fixes what the verdict names. */
  private recommended(): 'index' | 'reindex' | null {
    const s = this.status
    if (!s?.engine_configured) return null
    if (s.realm_ready === false || s.reindex_required || this.opts.stale.length) return 'reindex'
    return s.dirty ? 'index' : null
  }

  private draw(): void {
    const el = this.contentEl
    el.empty()
    const v = this.verdict()
    const hero = el.createDiv({ cls: `llm-wiki-index-hero is-${v.tone}` })
    icon(hero, v.tone === 'ok' ? 'circle-check' : v.tone === 'muted' ? 'loader' : 'triangle-alert', 'llm-wiki-index-hero-icon')
    const text = hero.createDiv()
    text.createDiv({ cls: 'llm-wiki-index-hero-title', text: v.title })
    if (v.detail) text.createDiv({ cls: 'llm-wiki-muted', text: v.detail })

    const s = this.status
    if (s?.engine_configured) {
      const facts: string[] = []
      const marker = s.index_as_of?.source_commit
      const head = s._cmd_?.head
      if (marker) facts.push(head && !head.startsWith(marker.slice(0, SHORT)) ? `built at ${short(marker)}, checkout at ${short(head)}` : `built at ${short(marker)}`)
      else facts.push('built at no known commit')
      facts.push(plural(s.corpus_files ?? 0, 'file'))
      const paths = (s.paths ?? []).map((p) => p.pattern)
      if (paths.length) facts.push(`from ${paths.join(', ')}`)
      if (s.not_indexed?.length) facts.push(`not ${s.not_indexed.map((p) => p.pattern).join(', ')}`)
      el.createDiv({ cls: 'llm-wiki-muted llm-wiki-index-facts', text: facts.join(' · ') })
    }

    if (s?.dirty) this.fileList(el, `Waiting to be indexed`, s.dirty, this.changed, s.marker_known === false
      ? 'The index names no commit this checkout knows, so every file is offered; the pass skips the ones it already holds.'
      : undefined)
    if (this.opts.stale.length) this.staleList(el)

    if (this.outcome) el.createDiv({ cls: `llm-wiki-index-outcome ${this.outcome.ok ? 'is-ok' : 'is-error'}`, text: this.outcome.message })
    if (s?.engine_configured) this.choices(el)
  }

  private fileList(parent: HTMLElement, title: string, count: number, files: string[] | null, note?: string): void {
    const box = parent.createDiv({ cls: 'llm-wiki-index-list' })
    const head = box.createDiv({ cls: 'llm-wiki-index-list-head' })
    head.createSpan({ text: title })
    head.createSpan({ cls: 'llm-wiki-count', text: count.toLocaleString() })
    if (note) box.createDiv({ cls: 'llm-wiki-muted', text: note })
    if (files === null && !note) box.createDiv({ cls: 'llm-wiki-muted', text: 'Finding the files…' })
    for (const f of (files ?? []).slice(0, LISTED)) this.fileRow(box, f)
    if (files && files.length > LISTED) box.createDiv({ cls: 'llm-wiki-muted', text: `and ${(files.length - LISTED).toLocaleString()} more` })
  }

  private staleList(parent: HTMLElement): void {
    const box = parent.createDiv({ cls: 'llm-wiki-index-list' })
    const head = box.createDiv({ cls: 'llm-wiki-index-list-head' })
    head.createSpan({ text: 'Out of date in your last searches' })
    head.createSpan({ cls: 'llm-wiki-count', text: String(this.opts.stale.length) })
    for (const h of this.opts.stale.slice(0, LISTED)) this.fileRow(box, h.path, h.why === 'deleted' ? 'page deleted' : 'text changed', h.why === 'deleted')
  }

  private fileRow(parent: HTMLElement, path: string, tag?: string, gone = false): void {
    const row = parent.createDiv({ cls: `llm-wiki-index-file${gone ? '' : ' is-link'}` })
    row.createSpan({ cls: 'llm-wiki-index-path', text: path })
    if (tag) row.createSpan({ cls: `llm-wiki-pill is-${gone ? 'error' : 'warn'}`, text: tag })
    if (!gone) row.addEventListener('click', () => void this.app.workspace.openLinkText(path, '', 'tab'))
  }

  private choices(parent: HTMLElement): void {
    const s = this.status!
    const best = this.recommended()
    const wrap = parent.createDiv({ cls: 'llm-wiki-index-choices' })
    const card = (kind: 'index' | 'reindex', label: string, body: string, run: () => Promise<void>) => {
      const c = wrap.createDiv({ cls: `llm-wiki-index-choice${best === kind ? ' is-recommended' : ''}` })
      const head = c.createDiv({ cls: 'llm-wiki-index-choice-head' })
      head.createSpan({ cls: 'llm-wiki-index-choice-title', text: label })
      if (best === kind) head.createSpan({ cls: 'llm-wiki-pill is-info', text: 'recommended' })
      c.createDiv({ cls: 'llm-wiki-muted', text: body })
      const b = button(c, this.running === kind ? 'Running…' : label, run, { icon: kind === 'index' ? 'refresh-cw' : 'database', cta: best === kind })
      if (this.running) b.disabled = true
      if (this.running === kind) b.addClass('llm-wiki-spin')
    }
    card('index', 'Update index',
      s.dirty ? `Index the ${plural(s.dirty, 'changed file')}. Quick, and removes nothing.` : 'Index whatever changed since the last pass. Quick, and removes nothing.',
      () => this.run('index'))
    card('reindex', 'Rebuild index',
      `Re-read all ${plural(s.corpus_files ?? 0, 'file')} and drop deleted pages from the index. Use it when search shows pages or text that are gone. Slower.`,
      async () => {
        const ok = await confirm(this.app, {
          title: 'Rebuild the search index?',
          body: `This re-reads every one of the ${plural(s.corpus_files ?? 0, 'file')} and removes pages that no longer exist from the index. On a large wiki it can take several minutes.`,
          cta: 'Rebuild',
        })
        if (ok) await this.run('reindex')
      })
    if (this.running) wrap.createDiv({ cls: 'llm-wiki-muted llm-wiki-index-wait', text: 'This can take a few minutes. You can close this; the pass keeps going and reports when it is done.' })
  }

  private async run(kind: 'index' | 'reindex'): Promise<void> {
    const actions = this.plugin.actions
    if (!actions || this.running) return
    this.running = kind
    this.outcome = null
    this.draw()
    const out = kind === 'index' ? await actions.index() : await actions.reindex()
    this.running = null
    this.outcome = out
    // Closed mid-pass: the Notice is the only place left to say how it went.
    if (!this.modalEl.isConnected) new Notice(out.message, out.ok ? 4000 : 8000)
    if (out.ok) this.opts.onIndexed()
    void this.plugin.refreshSnapshot()
    if (this.modalEl.isConnected) {
      if (out.ok) this.opts.stale.length = 0
      await this.load()
    }
  }
}
