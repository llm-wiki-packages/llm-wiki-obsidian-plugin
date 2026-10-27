// An icon in every page's header, beside Obsidian's own actions: whether the
// page has edits not yet in history, and on a click its recent commits. The
// diff arrives with the CLI's `page diff` (llm-wiki-plugins #3675).
import { MarkdownView, Notice, type WorkspaceLeaf } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { CliError } from '../wiki/cli'
import { isContent } from '../wiki/layout'
import type { Commit } from '../wiki/model'
import { whoOf } from '../wiki/who'
import { button, relativeTime } from './dom'

interface HistoryAnswer {
  commits?: { sha: string; at: string; subject: string; op?: string | null; actor?: string | null }[]
}

const SHOWN = 10

export class PageHistory {
  private readonly actions = new WeakMap<MarkdownView, HTMLElement>()
  private popover: HTMLElement | null = null

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    const each = () => p.app.workspace.iterateAllLeaves((leaf) => this.decorate(leaf))
    p.app.workspace.onLayoutReady(each)
    p.registerEvent(p.app.workspace.on('active-leaf-change', each))
    p.registerEvent(p.app.workspace.on('file-open', each))
    p.registerEvent(p.app.workspace.on('llm-wiki:saved' as 'layout-change', each))
    p.registerEvent(p.app.workspace.on('llm-wiki:snapshot' as 'layout-change', each))
    p.register(() => this.close())
  }

  /** Add the icon once per view, then keep its state current. */
  private decorate(leaf: WorkspaceLeaf): void {
    const view = leaf.view
    if (!(view instanceof MarkdownView)) return
    let el = this.actions.get(view)
    if (!el) {
      el = view.addAction('history', 'Page history', (e) => void this.open(view, e))
      el.addClass('llm-wiki-history-action')
      this.actions.set(view, el)
    }
    const path = view.file?.path
    const shown = Boolean(path && isContent(path) && this.plugin.wiki)
    el.toggle(shown)
    const unsaved = shown && path ? this.plugin.autosave.isUnsaved(path) : false
    el.toggleClass('is-unsaved', unsaved)
    el.setAttribute('aria-label', unsaved ? 'Page history · edited, not saved to history yet' : 'Page history')
  }

  private close(): void {
    this.popover?.remove()
    this.popover = null
  }

  private async open(view: MarkdownView, e: MouseEvent): Promise<void> {
    const file = view.file
    const { cli, wiki } = this.plugin
    if (!file || !cli || !wiki) return
    this.close()
    const pop = document.body.createDiv({ cls: 'llm-wiki llm-wiki-history-popover' })
    this.popover = pop
    const at = (e.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    pop.style.top = `${(at?.bottom ?? e.clientY) + 6}px`
    pop.style.right = `${Math.max(8, window.innerWidth - (at?.right ?? e.clientX))}px`
    const dismiss = (ev: MouseEvent | KeyboardEvent) => {
      if (ev instanceof KeyboardEvent ? ev.key === 'Escape' : !pop.contains(ev.target as Node)) {
        this.close()
        document.removeEventListener('mousedown', dismiss, true)
        document.removeEventListener('keydown', dismiss, true)
      }
    }
    document.addEventListener('mousedown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)

    const unsaved = this.plugin.autosave.isUnsaved(file.path)
    const state = pop.createDiv({ cls: 'llm-wiki-history-state' })
    state.createSpan({ cls: `llm-wiki-dot is-${unsaved ? 'warn' : 'ok'}` })
    const words = state.createDiv()
    const title = words.createDiv({ cls: 'llm-wiki-row-title', text: unsaved ? 'Edited · not saved to history yet' : 'Reading history…' })
    const detail = words.createDiv({ cls: 'llm-wiki-row-detail' })
    const mode = this.plugin.autosave.mode()
    if (unsaved && (mode === 'commit' || mode === 'sync')) button(pop.createDiv({ cls: 'llm-wiki-row-actions' }), 'Save now', () => this.plugin.autosave.saveNow(), { icon: 'save', cta: true })
    const list = pop.createDiv({ cls: 'llm-wiki-history-list' })

    let commits: Commit[] = []
    try {
      const a = await cli.run<HistoryAnswer>('wiki.page.history', { wiki: wiki.key, path: file.path })
      commits = (a.commits ?? []).map((c) => ({ sha: c.sha, at: c.at, subject: c.subject, op: c.op ?? 'none', actor: c.actor ?? '' }))
    } catch (err) {
      detail.setText(err instanceof CliError ? err.short : String(err))
    }
    if (this.popover !== pop) return
    const machine = this.plugin.snapshot?.machine ?? null
    const jobName = (slug: string) => this.plugin.snapshot?.jobs.find((j) => j.slug === slug)?.name
    const last = commits[0]
    if (!unsaved) title.setText(commits.length ? 'Saved' : 'Not in history yet')
    if (last) detail.setText(`last saved ${relativeTime(last.at)} by ${whoOf(last, machine, jobName).label}`)
    for (const c of commits.slice(0, SHOWN)) {
      const who = whoOf(c, machine, jobName)
      const row = list.createDiv({ cls: 'llm-wiki-history-row' })
      row.createSpan({ cls: 'llm-wiki-history-when', text: relativeTime(c.at) })
      row.createSpan({ cls: `llm-wiki-who is-${who.kind}`, text: who.label })
      row.createSpan({ cls: 'llm-wiki-row-detail', text: c.subject })
      row.title = `${c.sha.slice(0, 7)} · ${new Date(c.at).toLocaleString()}`
    }
    if (commits.length > SHOWN) list.createDiv({ cls: 'llm-wiki-muted', text: `and ${commits.length - SHOWN} older` })
    const foot = pop.createDiv({ cls: 'llm-wiki-history-foot' })
    const commands = (this.plugin.app as unknown as { commands?: { executeCommandById(id: string): boolean } }).commands
    button(foot, 'Local snapshots…', () => {
      this.close()
      if (!commands?.executeCommandById('file-recovery:open')) new Notice('Turn on file recovery under core plugins to see local snapshots.', 6000)
    }, { icon: 'clock' })
  }
}
