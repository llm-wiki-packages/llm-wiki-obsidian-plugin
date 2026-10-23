import { Menu } from 'obsidian'
import { button, clockTime, empty, pill, relativeTime, section, table } from '../../ui/dom'
import { slotWords } from '../../wiki/slots'
import { openJobModal } from '../../ui/jobModal'
import type { JobView, NextKind } from '../../wiki/model'
import type { TabContext } from './index'

/** The jobs, what each is waiting on, and the one button that matters on each row. */
export function renderJobs(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const actions = ctx.plugin.actions
  const due = snapshot.jobs.filter((j) => j.next.kind === 'due')
  const body = section(root, 'Jobs', {
    count: snapshot.jobs.length,
    actions: (bar) => {
      if (due.length > 1 && actions) button(bar, `Run all due (${due.length})`, () => ctx.write(async () => {
        const outs = await Promise.all(due.map((j) => actions.runJob(j.slug)))
        return { ok: outs.every((o) => o.ok), message: outs.map((o) => o.message).join('; ') }
      }), { icon: 'play' })
      button(bar, 'Add a source…', () => ctx.plugin.addJob(), { icon: 'plus', cta: true })
      if (snapshot.jobs.length && actions) button(bar, '', (e) => {
        const menu = new Menu()
        const live = snapshot.jobs.filter((j) => !j.paused)
        const paused = snapshot.jobs.filter((j) => j.paused)
        if (live.length) menu.addItem((i) => i.setTitle(`Pause all (${live.length})`).setIcon('pause').onClick(() => ctx.write(async () => { await Promise.all(live.map((j) => actions.pauseJob(j.slug))); return { ok: true, message: `${live.length} jobs paused` } })))
        if (paused.length) menu.addItem((i) => i.setTitle(`Resume all (${paused.length})`).setIcon('play').onClick(() => ctx.write(async () => { await Promise.all(paused.map((j) => actions.resumeJob(j.slug))); return { ok: true, message: `${paused.length} jobs resumed` } })))
        menu.showAtMouseEvent(e)
      }, { icon: 'ellipsis', title: 'More' })
    },
  })
  if (!snapshot.jobs.length) {
    empty(body, 'No jobs yet.', 'Add one to start capturing: a URL, a mailbox, or a task in plain words.')
    return
  }
  const jobs = sorted(snapshot.jobs)
  let filter = ''
  let expanded = false
  const draw = () => {
    list.empty()
    const shown = filter ? jobs.filter((j) => `${j.name} ${j.slug} ${j.kind} ${j.skill ?? ''}`.toLowerCase().includes(filter)) : jobs
    if (!shown.length) {
      empty(list, 'No job matches.')
      return
    }
    const t = table(list, ['Job', 'Every', 'Last', 'Next', ''])
    let group = ''
    let inGroup = 0
    let hidden = 0
    for (const j of shown) {
      const g = groupOf(j)
      if (g !== group && !filter) {
        group = g
        inGroup = 0
        const head = t.row().createEl('td', { cls: 'llm-wiki-group', attr: { colspan: '5' } })
        head.createSpan({ text: g })
        if (g === 'Scheduled' && !snapshot.runner) head.createSpan({ cls: 'llm-wiki-group-note', text: ' · no runner here: these run when you press Run' })
      }
      inGroup++
      // A long scheduled list folds after ten; the ones that need you never do.
      if (group === 'Scheduled' && inGroup > 10 && !expanded && !filter) {
        hidden++
        continue
      }
      jobRow(t.row(), j, ctx)
    }
    if (hidden) {
      const more = t.row().createEl('td', { cls: 'llm-wiki-more-link', text: `Show ${hidden} more`, attr: { colspan: '5' } })
      more.addEventListener('click', () => {
        expanded = true
        draw()
      })
    }
  }
  if (jobs.length > 10) {
    const field = body.createEl('input', { type: 'search', cls: 'llm-wiki-filter', placeholder: 'Filter jobs' })
    field.addEventListener('input', () => {
      filter = field.value.trim().toLowerCase()
      draw()
    })
  }
  const list = body.createDiv()
  draw()
}

/** Needs you, running, due, scheduled soonest first, manual, paused last. */
const ORDER: Record<NextKind, number> = { unbound: 0, blocked: 0, running: 1, due: 2, queued: 2, held: 3, at: 3, unknown: 4, manual: 5, paused: 6 }
const GROUP: Record<NextKind, string> = { unbound: 'Needs you', blocked: 'Needs you', running: 'Running', due: 'Due', queued: 'Due', held: 'Scheduled', at: 'Scheduled', unknown: 'Scheduled', manual: 'Manual', paused: 'Paused' }

export function sorted(jobs: JobView[]): JobView[] {
  return [...jobs].sort((a, b) => ORDER[a.next.kind] - ORDER[b.next.kind] || (a.next.at ?? '').localeCompare(b.next.at ?? '') || a.name.localeCompare(b.name))
}

function groupOf(j: JobView): string {
  return GROUP[j.next.kind]
}

function jobRow(tr: HTMLElement, j: JobView, ctx: TabContext): void {
  if (j.running) tr.addClass('is-running')
  if (j.paused) tr.addClass('is-paused')
  tr.addClass('is-link')
  tr.tabIndex = 0
  tr.addEventListener('click', () => openJobModal(ctx.plugin.app, j, ctx))
  tr.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openJobModal(ctx.plugin.app, j, ctx)
  })
  const name = tr.createEl('td')
  name.createDiv({ cls: 'llm-wiki-row-title', text: j.name })
  name.createDiv({ cls: 'llm-wiki-muted', text: j.name === j.slug ? j.kind : `${j.slug} · ${j.kind}` })
  tr.createEl('td', { text: j.schedule })
  lastCell(tr.createEl('td'), j)
  nextCell(tr.createEl('td', { cls: `llm-wiki-next is-${j.next.kind}` }), j, ctx)
  jobButtons(tr.createEl('td').createDiv({ cls: 'llm-wiki-row-actions' }), j, ctx)
}

/** One job as a card, for the Overview strip. */
export function jobCard(parent: HTMLElement, j: JobView, ctx: TabContext): void {
  const card = parent.createDiv({ cls: 'llm-wiki-card is-link' })
  card.addEventListener('click', () => openJobModal(ctx.plugin.app, j, ctx))
  card.createDiv({ cls: 'llm-wiki-card-title', text: j.name })
  nextCell(card.createDiv({ cls: `llm-wiki-next is-${j.next.kind}` }), j, ctx)
  jobButtons(card.createDiv({ cls: 'llm-wiki-row-actions' }), j, ctx)
}

function lastCell(td: HTMLElement, j: JobView): void {
  if (!j.last.at && !j.last.outcome) {
    td.createSpan({ cls: 'llm-wiki-muted', text: 'never' })
    return
  }
  if (j.last.at) td.createSpan({ text: relativeTime(j.last.at) })
  if (j.last.outcome === 'failed') {
    const why = j.tickets.find((t) => t.state === 'failed')?.reason
    td.createDiv({ cls: 'llm-wiki-failed', text: why ? `failed: ${why}` : 'failed' })
  } else if (j.last.outcome && j.last.outcome !== 'ok') {
    td.createSpan({ text: ' · ' })
    pill(td, j.last.outcome)
  }
}

/** The Next column in plain words, formatted now so a reopened dashboard is not stale. */
export function nextText(j: JobView, runner = true): string {
  const n = j.next
  switch (n.kind) {
    case 'due': return 'Due now'
    case 'queued': return 'Queued'
    case 'running': return 'Running'
    case 'paused': return 'Paused'
    case 'held': return n.at ? `Held until ${clockTime(n.at)}` : 'Held'
    case 'at': return n.at ? relativeTime(n.at) : (n.detail ?? 'Scheduled')
    case 'blocked': return `Blocked: ${n.detail ?? ''}`
    case 'unbound': return j.credential?.name ? `Credential ${j.credential.problem}` : `Needs ${slotWords(j.credential?.slot ?? '').what}`
    case 'manual': return 'Manual'
    case 'unknown': return ''
  }
}

function nextCell(td: HTMLElement, j: JobView, ctx: TabContext): void {
  if (j.running) {
    td.createSpan({ cls: 'llm-wiki-spinner' })
    td.createSpan({ text: ` Running ${j.running.since ? relativeTime(j.running.since).replace(' ago', '') : ''}` })
    td.createDiv({ cls: 'llm-wiki-muted', text: [j.running.stage, `ticket ${j.running.ticket}`].filter(Boolean).join(' · ') })
    return
  }
  td.createSpan({ text: nextText(j, ctx.snapshot.runner) })
  // The detail earns its line only when it adds the credential's name; "needs a credential" twice is noise.
  if (j.next.kind === 'unbound' && j.credential?.name) td.createDiv({ cls: 'llm-wiki-muted', text: j.next.detail })
  else if (j.next.detail) td.title = j.next.detail
}

/** Run can start anything that is not running; without a runner even a queued or held ticket waits for a press. */
const RUNNABLE: NextKind[] = ['due', 'at', 'manual', 'blocked', 'unknown', 'unbound']
const RUNNABLE_BY_HAND: NextKind[] = [...RUNNABLE, 'queued', 'held']

/** The one button the row needs now, plus a menu with everything else. */
export function jobButtons(parent: HTMLElement, j: JobView, ctx: TabContext, full = false): void {
  const actions = ctx.plugin.actions
  if (!actions) return
  const run = () => ctx.write(() => actions.runJob(j.slug))
  const runTitle = `llm-wiki-ops jobs request ${j.slug}`
  const c = j.credential
  if (j.paused) button(parent, 'Resume', () => ctx.write(() => actions.resumeJob(j.slug)), { icon: 'play', cta: true })
  else if (c && j.skill) button(parent, c.name ? 'Replace credential' : 'Set credential', () => ctx.act({ kind: 'credential', skill: j.skill!, slot: c.slot, ...(c.name ? { name: c.name } : {}) }), { icon: 'key-round', cta: true })
  else if (j.next.kind === 'due') button(parent, 'Run', run, { icon: 'play', cta: true, title: runTitle })
  // Without a runner a scheduled job only runs by hand, so the row says so and offers the button.
  else if ((full || !ctx.snapshot.runner) && !j.running && (ctx.snapshot.runner ? RUNNABLE : RUNNABLE_BY_HAND).includes(j.next.kind)) button(parent, 'Run', run, { icon: 'play', title: runTitle })
  if (j.running && !full) return
  if (full) {
    if (!j.running && !j.paused) button(parent, 'Pause', () => ctx.write(() => actions.pauseJob(j.slug)), { icon: 'pause' })
    return
  }
  const more = button(parent, '', (e) => {
    const menu = new Menu()
    if (!j.running && !j.paused && j.next.kind !== 'due' && RUNNABLE.includes(j.next.kind)) menu.addItem((i) => i.setTitle('Run now').setIcon('play').onClick(run))
    if (!j.running && !j.paused) menu.addItem((i) => i.setTitle('Pause').setIcon('pause').onClick(() => ctx.write(() => actions.pauseJob(j.slug))))
    menu.addItem((i) => i.setTitle('Details').setIcon('info').onClick(() => openJobModal(ctx.plugin.app, j, ctx)))
    menu.addItem((i) => i.setTitle('Ask the agent about it').setIcon('message-square').onClick(() => ctx.act({ kind: 'ask', prompt: askAbout(j) })))
    menu.showAtMouseEvent(e)
  }, { icon: 'ellipsis', title: 'More' })
  more.addClass('llm-wiki-more')
}

/** A chat opener that carries what the dashboard knows: the state, the reason, the last failure. */
export function askAbout(j: JobView): string {
  const failed = j.tickets.find((t) => t.state === 'failed')
  const facts = [`job ${j.slug} (${j.name})`, `state: ${nextText(j)}`, j.next.detail, failed ? `last failure (ticket ${failed.id}, ${failed.stage}): ${failed.reason ?? 'no reason recorded'}` : null].filter(Boolean)
  return failed ? `Why does ${facts.join('; ')} keep failing, and what fixes it? ` : `About ${facts.join('; ')}: `
}
