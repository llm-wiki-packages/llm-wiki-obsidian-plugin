import { button, empty, relativeTime, section } from '../../ui/dom'
import type { AttentionItem, JobView } from '../../wiki/model'
import type { TabContext } from './index'
import { jobCard } from './jobs'

/** Do I need to do anything? The verdict first, then what needs a person, then what is moving. */
export function renderOverview(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const health = root.createDiv({ cls: 'llm-wiki-health' })
  health.createSpan({ cls: `llm-wiki-dot is-${snapshot.health.tone}` })
  health.createSpan({ text: snapshot.health.sentence })

  const needs = section(root, 'Needs you', { count: snapshot.attention.length })
  if (!snapshot.attention.length) empty(needs, 'Nothing needs you.')
  for (const item of snapshot.attention) attentionRow(needs, item, ctx)

  const moving = snapshot.jobs.filter((j) => j.running || j.next.kind === 'due')
  const strip = section(root, 'Running and due', {
    count: moving.length,
    actions: (bar) => button(bar, 'All jobs', () => ctx.goTo('jobs')),
  })
  if (!snapshot.runner) strip.createDiv({ cls: 'llm-wiki-notice', text: 'No runner on this machine. Jobs run when you press Run.' })
  if (!moving.length) empty(strip, 'Nothing is running or due.', nextUp(snapshot.jobs))
  else {
    const cards = strip.createDiv({ cls: 'llm-wiki-cards' })
    for (const j of moving.slice(0, 6)) jobCard(cards, j, ctx)
  }

  const curation = section(root, 'Waiting for curation', {
    count: snapshot.curation.length,
    actions: (bar) => button(bar, 'Review', () => ctx.goTo('pages')),
  })
  if (!snapshot.curation.length) empty(curation, 'No pages are waiting.')
  else curation.createDiv({ cls: 'llm-wiki-muted', text: snapshot.curation.slice(0, 5).map((c) => c.path).join(' · ') + (snapshot.curation.length > 5 ? ' · …' : '') })

  const recent = section(root, 'Recent', { count: snapshot.recent.length })
  if (!snapshot.recent.length) empty(recent, 'No runs in the last day.')
  for (const r of snapshot.recent.slice(0, 10)) {
    const row = recent.createDiv({ cls: 'llm-wiki-row' })
    row.createSpan({ cls: `llm-wiki-dot is-${r.outcome === 'ok' ? 'ok' : r.outcome === 'failed' ? 'error' : 'muted'}` })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: `${r.op} · ${r.outcome}` })
    if (r.summary) main.createDiv({ cls: 'llm-wiki-row-detail', text: r.summary })
    row.createSpan({ cls: 'llm-wiki-muted', text: relativeTime(r.at) })
  }
}

function nextUp(jobs: JobView[]): string | undefined {
  const next = jobs
    .filter((j) => j.next.kind === 'at' && j.next.at)
    .sort((a, b) => Date.parse(a.next.at!) - Date.parse(b.next.at!))[0]
  return next ? `Next up: ${next.name} ${relativeTime(next.next.at)}.` : undefined
}

function attentionRow(parent: HTMLElement, item: AttentionItem, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row' })
  row.createSpan({ cls: `llm-wiki-dot is-${item.severity}` })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: item.title })
  if (item.detail) main.createDiv({ cls: 'llm-wiki-row-detail', text: item.detail })
  if (item.fix) main.createDiv({ cls: 'llm-wiki-row-fix', text: item.fix })
  const actions = row.createDiv({ cls: 'llm-wiki-row-actions' })
  const a = item.action
  if (!a) return
  const label = a.kind === 'ask' ? (a.label ?? 'Ask the agent') : a.kind === 'open' ? 'Open' : a.kind === 'retry' ? 'Retry' : 'Reindex'
  button(actions, label, () => ctx.act(a), { icon: a.kind === 'ask' ? 'message-square' : undefined })
}
