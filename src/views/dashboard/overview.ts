import { button, empty, relativeTime, section } from '../../ui/dom'
import type { AttentionItem, Snapshot } from '../../wiki/model'
import type { TabContext } from './index'
import { jobCard, sorted } from './jobs'

/** Do I need to do anything? The verdict first, then what needs a person, then what is moving. */
export function renderOverview(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  if (!snapshot.jobs.length) {
    firstMorning(root, ctx)
    return
  }
  const health = root.createDiv({ cls: 'llm-wiki-health' })
  health.createSpan({ cls: `llm-wiki-dot is-${snapshot.health.tone}` })
  health.createSpan({ text: healthSentence(snapshot) })

  // The count is the pill's: what needs a person. Info rows follow under their own small label, uncounted.
  const needs = section(root, 'Needs you', { count: snapshot.health.count })
  const counted = snapshot.attention.filter((a) => a.severity !== 'info')
  const also = snapshot.attention.filter((a) => a.severity === 'info')
  if (!counted.length) empty(needs, 'Nothing needs you.')
  for (const item of counted) attentionRow(needs, item, ctx)
  if (also.length) {
    needs.createDiv({ cls: 'llm-wiki-group', text: 'Also' })
    for (const item of also) attentionRow(needs, item, ctx)
  }
  if (!snapshot.runner) {
    const notice = needs.createDiv({ cls: 'llm-wiki-notice llm-wiki-notice-row' })
    notice.createSpan({ text: 'No runner is installed on this machine, so nothing runs on its schedule. Jobs run when you press Run.' })
    button(notice, 'Install the runner', () => ctx.act({ kind: 'ask', prompt: 'Install the llm-wiki runner on this machine so jobs run on their schedule.' }), { icon: 'message-square' })
  }

  const moving = sorted(snapshot.jobs.filter((j) => j.running || j.next.kind === 'due' || j.next.kind === 'queued'))
  const strip = section(root, 'Running and due', {
    count: moving.length,
    actions: (bar) => button(bar, 'All jobs', () => ctx.goTo('jobs')),
  })
  if (!moving.length) empty(strip, 'Nothing is running or due.')
  else {
    const cards = strip.createDiv({ cls: 'llm-wiki-cards' })
    for (const j of moving.slice(0, 4)) jobCard(cards, j, ctx)
    if (moving.length > 4) {
      const more = strip.createDiv({ cls: 'llm-wiki-muted llm-wiki-more-link', text: `and ${moving.length - 4} more` })
      more.addEventListener('click', () => ctx.goTo('jobs'))
    }
  }

  const curation = section(root, 'Waiting for curation', {
    count: snapshot.curation.length,
    actions: (bar) => button(bar, 'Review', () => ctx.goTo('pages')),
  })
  if (snapshot.unadopted?.length) curation.createDiv({ cls: 'llm-wiki-muted', text: `${snapshot.unadopted.length} new under sources/ not yet in the wiki.` })
  if (!snapshot.curation.length) empty(curation, 'No pages are waiting.')
  else curation.createDiv({ cls: 'llm-wiki-muted', text: snapshot.curation.slice(0, 5).map((c) => c.path).join(' · ') + (snapshot.curation.length > 5 ? ' · …' : '') })

  const failed = snapshot.recent.filter((r) => r.outcome === 'failed').length
  const recent = section(root, 'Last day', { count: snapshot.recent.length })
  if (!snapshot.recent.length) empty(recent, 'No runs in the last day.')
  else recent.createDiv({ cls: 'llm-wiki-muted', text: `${snapshot.recent.length} ${snapshot.recent.length === 1 ? 'run' : 'runs'}${failed ? `, ${failed} failed` : ''}. ${snapshot.curation.length ? `${snapshot.curation.length} ${snapshot.curation.length === 1 ? 'page is' : 'pages are'} waiting for review.` : ''}` })
  for (const r of snapshot.recent.slice(0, 10)) {
    const row = recent.createDiv({ cls: 'llm-wiki-row' })
    row.createSpan({ cls: `llm-wiki-dot is-${r.outcome === 'ok' ? 'ok' : r.outcome === 'failed' ? 'error' : 'muted'}` })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: r.outcome === 'ok' ? opName(r.op) : `${opName(r.op)} · ${r.outcome}` })
    if (r.summary) main.createDiv({ cls: 'llm-wiki-row-detail', text: r.summary })
    row.createSpan({ cls: 'llm-wiki-muted', text: relativeTime(r.at) })
  }
}

/** The op trailer in words: `pass` is the scheduled pass, the rest are the skills by name. */
export function opName(op: string): string {
  if (op === 'pass') return 'Scheduled pass'
  if (op === 'none' || !op) return 'A run'
  return op.charAt(0).toUpperCase() + op.slice(1)
}

/** A wiki with no jobs: one card that says what a job is and offers the two ways in. */
function firstMorning(root: HTMLElement, ctx: TabContext): void {
  const card = root.createDiv({ cls: 'llm-wiki-first' })
  card.createEl('h3', { text: 'Nothing is pulling into this wiki yet.' })
  card.createEl('p', { cls: 'llm-wiki-muted', text: 'A job follows a source on a schedule: a URL, a mailbox, a channel. A skill is how it knows the venue. Add a job in plain words and the agent sets up both.' })
  const bar = card.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Add a job…', () => ctx.plugin.addJob(), { icon: 'plus', cta: true })
  button(bar, 'Browse skills', () => ctx.goTo('skills'), { icon: 'puzzle' })
  if (ctx.snapshot.attention.length) {
    const needs = section(root, 'Needs you', { count: ctx.snapshot.health.count })
    for (const item of ctx.snapshot.attention) attentionRow(needs, item, ctx)
  }
}

/** One sentence: what is moving. The count already sits in the pill and the section head. */
export function healthSentence(s: Snapshot): string {
  const parts: string[] = []
  const running = s.jobs.filter((j) => j.running)
  const due = s.jobs.filter((j) => !j.running && j.next.kind === 'due')
  if (running.length) parts.push(`Running ${running.map((j) => j.name).join(', ')}.`)
  if (due.length) parts.push(`${due.length} ${due.length === 1 ? 'job is' : 'jobs are'} due now.`)
  const lastRun = s.jobs.map((j) => j.last.at).filter((x): x is string => Boolean(x)).sort().at(-1)
  if (lastRun && !running.length) parts.push(`Last run ${relativeTime(lastRun)}.`)
  const next = s.jobs.filter((j) => j.next.kind === 'at' && j.next.at).sort((a, b) => Date.parse(a.next.at!) - Date.parse(b.next.at!))[0]
  if (next && !due.length && s.runner) parts.push(`Next up ${next.name} ${relativeTime(next.next.at)}.`)
  if (!parts.length) parts.push(s.health.count ? 'Nothing is moving.' : 'All quiet.')
  return parts.join(' ')
}

const LABEL: Record<Exclude<AttentionItem['action'], undefined>['kind'], string> = { ask: 'Ask the agent', open: 'Open', retry: 'Retry', reindex: 'Reindex', credential: 'Set credential', inspect: 'Inspect' }
const ICON: Record<Exclude<AttentionItem['action'], undefined>['kind'], string | undefined> = { ask: 'message-square', open: undefined, retry: 'rotate-ccw', reindex: undefined, credential: 'key-round', inspect: 'file-text' }

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
  const label = a.kind === 'ask' ? (a.label ?? 'Ask the agent') : a.kind === 'credential' && a.name ? 'Replace credential' : LABEL[a.kind]
  button(actions, label, () => ctx.act(a), { icon: ICON[a.kind], cta: a.kind === 'credential' })
  // A stopped job can also simply be retried; the credential button is the fix, this is the escape hatch.
  if (a.kind === 'credential' && a.retry) button(actions, 'Retry', () => ctx.act({ kind: 'retry', ticket: a.retry! }), { icon: 'rotate-ccw' })
}
