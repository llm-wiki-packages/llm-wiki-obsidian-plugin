import { button, empty, humanEvery, pill, relativeTime, section, table } from '../../ui/dom'
import type { JobView, NextKind } from '../../wiki/model'
import type { TabContext } from './index'

/** The jobs, what each is waiting on, and one Run button each. */
export function renderJobs(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const body = section(root, 'Jobs', {
    count: snapshot.jobs.length,
    actions: (bar) => button(bar, 'Add a job…', () => addJob(ctx), { icon: 'plus', cta: true }),
  })
  if (!snapshot.runner) body.createDiv({ cls: 'llm-wiki-notice', text: 'No runner on this machine. Jobs run when you press Run.' })
  if (!snapshot.jobs.length) {
    empty(body, 'No jobs yet.', 'Add one to start capturing: a URL, a mailbox, or a task in plain words.')
    return
  }
  const t = table(body, ['Job', 'Every', 'Last', 'Next', ''])
  for (const j of snapshot.jobs) {
    const tr = t.row()
    if (j.running) tr.addClass('is-running')
    if (j.paused) tr.addClass('is-paused')
    const name = tr.createEl('td')
    name.createDiv({ cls: 'llm-wiki-row-title', text: j.name })
    name.createDiv({ cls: 'llm-wiki-muted', text: j.name === j.slug ? j.kind : `${j.slug} · ${j.kind}` })
    tr.createEl('td', { text: j.schedule })
    const last = tr.createEl('td')
    lastCell(last, j)
    const next = tr.createEl('td', { cls: `llm-wiki-next is-${j.next.kind}` })
    nextCell(next, j)
    const actions = tr.createEl('td').createDiv({ cls: 'llm-wiki-row-actions' })
    jobButtons(actions, j, ctx)
  }
}

/** One job as a card, for the Overview strip. */
export function jobCard(parent: HTMLElement, j: JobView, ctx: TabContext): void {
  const card = parent.createDiv({ cls: 'llm-wiki-card' })
  card.createDiv({ cls: 'llm-wiki-card-title', text: j.name })
  const next = card.createDiv({ cls: `llm-wiki-next is-${j.next.kind}` })
  nextCell(next, j)
  const actions = card.createDiv({ cls: 'llm-wiki-row-actions' })
  jobButtons(actions, j, ctx)
}

function lastCell(td: HTMLElement, j: JobView): void {
  if (!j.last.at) {
    td.createSpan({ cls: 'llm-wiki-muted', text: 'never' })
    return
  }
  td.createSpan({ text: relativeTime(j.last.at) })
  if (j.last.outcome) {
    td.createSpan({ text: ' · ' })
    pill(td, j.last.outcome, j.last.outcome === 'ok' ? 'ok' : j.last.outcome === 'failed' ? 'error' : 'muted')
  }
}

function nextCell(td: HTMLElement, j: JobView): void {
  if (j.running) {
    td.createSpan({ cls: 'llm-wiki-spinner' })
    td.createSpan({ text: ` Running ${j.running.since ? relativeTime(j.running.since).replace(' ago', '') : ''}` })
    if (j.running.stage) td.createDiv({ cls: 'llm-wiki-muted', text: j.running.stage })
    return
  }
  td.createSpan({ text: j.next.text })
  if (j.next.reason) td.title = j.next.reason
}

const RUNNABLE: NextKind[] = ['due', 'at', 'manual', 'blocked', 'unknown']

function jobButtons(parent: HTMLElement, j: JobView, ctx: TabContext): void {
  const actions = ctx.plugin.actions
  if (!actions) return
  if (j.paused) {
    button(parent, 'Resume', () => ctx.write(() => actions.resumeJob(j.slug)), { icon: 'play' })
    return
  }
  if (!j.running && RUNNABLE.includes(j.next.kind)) {
    button(parent, 'Run', () => ctx.write(() => actions.runJob(j.slug)), { icon: 'play', cta: j.next.kind === 'due', title: `llm-wiki-ops jobs request ${j.slug}` })
  }
  if (!j.running) button(parent, 'Pause', () => ctx.write(() => actions.pauseJob(j.slug)), { icon: 'pause' })
}

/** One field; the add skill decides the rest in chat. */
export async function addJob(ctx: TabContext): Promise<void> {
  const text = await ctx.plugin.promptAddJob()
  if (text) await ctx.act({ kind: 'ask', prompt: `/llm-wiki:add ${text}` })
}
