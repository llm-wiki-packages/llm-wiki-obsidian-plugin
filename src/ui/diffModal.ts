// What changed in one page: a commit's own change, or the edits since the last
// save. Properties are listed apart from the body, as the CLI's `page diff`
// keeps them; Older and Newer step through the page's history.
import { Modal } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { CliError } from '../wiki/cli'
import { diffSummary, pageEvent, valueText, type DiffAnswer, type DiffHunk } from '../wiki/diff'
import type { Commit } from '../wiki/model'
import { whoOf } from '../wiki/who'
import { button, relativeTime } from './dom'

export interface DiffTarget {
  path: string
  /** The commit whose change to show; absent for the edits not saved yet. */
  commit?: Commit
  /** The page's history, newest first, for Older and Newer. */
  history?: Commit[]
}

export function openDiff(plugin: LlmWikiPlugin, target: DiffTarget): void {
  new DiffModal(plugin, target).open()
}

class DiffModal extends Modal {
  private at: number

  constructor(private readonly plugin: LlmWikiPlugin, private readonly target: DiffTarget) {
    super(plugin.app)
    this.at = target.commit && target.history ? target.history.findIndex((c) => c.sha === target.commit?.sha) : -1
    this.modalEl.addClass('llm-wiki', 'llm-wiki-diff-modal')
  }

  /** The commit on screen: one from the history while stepping, else the one asked for. */
  private commit(): Commit | undefined {
    return this.at >= 0 ? this.target.history?.[this.at] : this.target.commit
  }

  onOpen(): void {
    void this.draw()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async draw(): Promise<void> {
    const { cli, wiki, snapshot } = this.plugin
    const el = this.contentEl
    el.empty()
    const c = this.commit()
    // The path the page had at that commit: a renamed page's old change reads under its old name.
    const path = c?.path ?? this.target.path
    this.setTitle(path.split('/').at(-1)?.replace(/\.md$/, '') ?? path)

    const head = el.createDiv({ cls: 'llm-wiki-diff-head' })
    const words = head.createDiv({ cls: 'llm-wiki-row-main' })
    if (c) {
      const jobName = (slug: string) => snapshot?.jobs.find((j) => j.slug === slug)?.name
      const who = whoOf(c, snapshot?.machine ?? null, jobName)
      words.createDiv({ cls: 'llm-wiki-row-title', text: c.subject })
      const detail = words.createDiv({ cls: 'llm-wiki-row-detail' })
      detail.createSpan({ cls: `llm-wiki-who is-${who.kind}`, text: who.label })
      detail.createSpan({ text: ` · ${relativeTime(c.at)} · ${c.sha.slice(0, 7)}` })
      detail.title = new Date(c.at).toLocaleString()
    } else {
      words.createDiv({ cls: 'llm-wiki-row-title', text: 'Edits since the last save' })
      words.createDiv({ cls: 'llm-wiki-row-detail', text: path })
    }
    const history = this.target.history
    if (history && this.at >= 0) {
      const nav = head.createDiv({ cls: 'llm-wiki-row-actions' })
      const older = button(nav, 'Older', () => this.step(1), { icon: 'chevron-left' })
      nav.createSpan({ cls: 'llm-wiki-muted', text: `${this.at + 1} of ${history.length}` })
      const newer = button(nav, 'Newer', () => this.step(-1), { icon: 'chevron-right' })
      older.disabled = this.at >= history.length - 1
      newer.disabled = this.at <= 0
    }

    const body = el.createDiv({ cls: 'llm-wiki-diff-body' })
    body.createDiv({ cls: 'llm-wiki-muted', text: 'Reading…' })
    let d: DiffAnswer
    try {
      if (!cli || !wiki) throw new Error('the wiki is not connected')
      d = await cli.run<DiffAnswer>('wiki.page.diff', { wiki: wiki.key, path, ...(c ? { commit: c.sha } : {}) })
    } catch (e) {
      if (this.commit() !== c) return
      body.empty()
      body.createDiv({ cls: 'llm-wiki-muted', text: `Could not read the change: ${e instanceof CliError ? e.short : String(e)}` })
      return
    }
    // Stepped on meanwhile: that draw owns the body now.
    if (this.commit() !== c) return
    body.empty()
    renderDiff(body, d)

    const file = this.app.vault.getFileByPath(this.target.path)
    if (file) {
      const foot = el.createDiv({ cls: 'llm-wiki-row-actions llm-wiki-diff-foot' })
      button(foot, 'Open page', () => {
        this.close()
        void this.app.workspace.getLeaf(false).openFile(file)
      }, { icon: 'file-text' })
    }
  }

  private step(by: number): void {
    const n = this.at + by
    if (!this.target.history?.[n]) return
    this.at = n
    void this.draw()
  }
}

/** The answer, drawn: what happened to the page, the properties that changed, then the body's hunks. */
export function renderDiff(el: HTMLElement, d: DiffAnswer): void {
  const event = pageEvent(d)
  el.createDiv({ cls: 'llm-wiki-diff-summary', text: [event, diffSummary(d)].filter(Boolean).join(' · ') })
  if (d.identical) return
  if (d.frontmatter.length) {
    el.createDiv({ cls: 'llm-wiki-diff-label', text: 'Properties' })
    const rows = el.createDiv({ cls: 'llm-wiki-diff-props' })
    for (const f of d.frontmatter) {
      rows.createDiv({ cls: 'llm-wiki-diff-key', text: f.key })
      const v = rows.createDiv({ cls: `llm-wiki-diff-value is-${f.change}` })
      if (f.change !== 'added') v.createSpan({ cls: 'llm-wiki-diff-old', text: valueText(f.old) })
      if (f.change === 'changed') v.createSpan({ cls: 'llm-wiki-diff-arrow', text: ' → ' })
      if (f.change !== 'removed') v.createSpan({ cls: 'llm-wiki-diff-new', text: valueText(f.new) })
    }
  }
  if (d.hunks.length) {
    el.createDiv({ cls: 'llm-wiki-diff-label', text: 'Page' })
    for (const h of d.hunks) hunk(el, h)
  }
}

function hunk(parent: HTMLElement, h: DiffHunk): void {
  const box = parent.createDiv({ cls: 'llm-wiki-diff-hunk' })
  const at = h.new_count ? h.new_start : h.old_start
  box.createDiv({ cls: 'llm-wiki-diff-at', text: `Line ${at}` })
  for (const l of h.lines) {
    const row = box.createDiv({ cls: `llm-wiki-diff-line is-${l.kind}` })
    row.createSpan({ cls: 'llm-wiki-diff-num', text: l.old === null ? '' : String(l.old) })
    row.createSpan({ cls: 'llm-wiki-diff-num', text: l.new === null ? '' : String(l.new) })
    row.createSpan({ cls: 'llm-wiki-diff-sign', text: l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : '' })
    row.createSpan({ cls: 'llm-wiki-diff-text', text: l.text || ' ' })
  }
}
