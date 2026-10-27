import { button, empty, relativeTime, section } from '../../ui/dom'
import { openJobModal } from '../../ui/jobModal'
import { draftsIn } from '../../vault/pages'
import type { AttentionItem, JobView, MachineView, Snapshot } from '../../wiki/model'
import { dayOf } from '../../wiki/who'
import { newPages } from './changes'
import type { TabContext } from './index'
import { jobButtons, jobCard, nextText, sorted } from './jobs'

/** Is the wiki well, which machines carry it, and what runs next. Pages live in Changes. */
export function renderOverview(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  if (!snapshot.jobs.length) {
    firstMorning(root, ctx)
    return
  }
  healthStrip(root, ctx)

  // The count is the pill's: what needs a person. Info rows follow under their own small label, uncounted.
  const counted = snapshot.attention.filter((a) => a.severity !== 'info')
  const also = snapshot.attention.filter((a) => a.severity === 'info')
  if (counted.length || also.length || !snapshot.runner) {
    const needs = section(root, 'Needs you', { count: snapshot.health.count })
    if (!counted.length) empty(needs, 'Nothing needs you.')
    for (const item of counted) attentionRow(needs, item, ctx)
    for (const [n, item] of also.entries()) {
      const row = needs.createDiv({ cls: 'llm-wiki-also' })
      if (n === 0) row.createSpan({ cls: 'llm-wiki-also-label', text: 'Also' })
      row.createSpan({ cls: 'llm-wiki-muted', text: item.title })
      if (item.action) button(row, item.action.kind === 'ask' ? (item.action.label ?? 'Ask the agent') : LABEL[item.action.kind], () => ctx.act(item.action!), {}).addClass('llm-wiki-small')
    }
    if (!snapshot.runner && !snapshot.fleet.some((m) => !m.me && m.roles.length)) {
      const notice = needs.createDiv({ cls: 'llm-wiki-notice llm-wiki-notice-row' })
      notice.createSpan({ text: 'No runner on this machine. Another machine may run the schedule; here, jobs run when you press Run.' })
      button(notice, 'Install the runner', () => ctx.act({ kind: 'ask', prompt: 'Install the llm-wiki runner on this machine so jobs run on their schedule.' }), { icon: 'message-square' })
    }
  }

  if (snapshot.fleet.length > 1) fleet(section(root, 'Fleet', { count: snapshot.fleet.length }), snapshot.fleet)

  jobsBlock(root, ctx)
  todayLine(root, ctx)
}

/** One sentence, and three pills that each open where their state is fixed. */
function healthStrip(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const strip = root.createDiv({ cls: 'llm-wiki-health' })
  strip.createSpan({ cls: `llm-wiki-dot is-${snapshot.health.tone}` })
  strip.createSpan({ cls: 'llm-wiki-health-text', text: healthSentence(snapshot) })
  const pills = strip.createDiv({ cls: 'llm-wiki-health-pills' })
  const pillButton = (tone: string, text: string, title: string, go: () => void) => {
    const b = pills.createEl('button', { cls: 'llm-wiki-status-pill', title })
    b.createSpan({ cls: `llm-wiki-dot is-${tone}` })
    b.createSpan({ text })
    b.addEventListener('click', go)
  }
  const s = snapshot.search
  if (s) {
    const stale = s.engine_configured ? (s.realm_ready === false ? 'not ready' : s.dirty ? `${s.dirty} stale` : '') : ''
    pillButton(stale ? 'warn' : 'ok', s.engine_configured ? `Search ${stale || 'fresh'}` : 'Search by grep', 'The search index; click to review it', () => void ctx.act({ kind: 'reindex' }))
  }
  const sync = snapshot.sync
  const mode = ctx.plugin.autosave.mode()
  const unsaved = Math.max(ctx.plugin.autosave.unsaved().length, (sync?.dirty ?? 0) + (sync?.untracked ?? 0))
  const syncBits = [unsaved ? `${unsaved} unsaved` : '', sync?.unpushed ? `↑${sync.unpushed}` : '', sync?.behind ? `↓${sync.behind}` : ''].filter(Boolean)
  pillButton(unsaved || sync?.behind ? 'warn' : 'ok', `History ${syncBits.join(' ') || 'saved'}`, mode === 'off' ? 'Saving edits to history is off in the settings' : 'Edits not yet in history, and commits not yet shared; click for Changes', () => ctx.goTo('changes'))
  const elsewhere = snapshot.fleet.filter((m) => !m.me && m.roles.length && m.state !== 'stuck').map((m) => m.name)
  pillButton(snapshot.runner || elsewhere.length ? 'ok' : 'muted', snapshot.runner ? 'Runner here' : elsewhere.length ? `Runner on ${elsewhere[0]}${elsewhere.length > 1 ? ` +${elsewhere.length - 1}` : ''}` : 'No runner', 'What runs the schedule; click for the jobs', () => ctx.goTo('jobs'))
}

const SVG = 'http://www.w3.org/2000/svg'
function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  if (text !== undefined) el.textContent = text
  parent.appendChild(el)
  return el
}

const STATE_TONE: Record<string, string> = { healthy: 'ok', 'no-cadence': 'ok', quiet: 'warn', stuck: 'error', unreadable: 'error' }

/** The shared remote in the middle, each machine around it: its state, when it was last seen, what it runs. */
function fleet(parent: HTMLElement, machines: MachineView[]): void {
  const W = 640
  const nodeW = 230
  const nodeH = 54
  const rows = Math.ceil(machines.length / 2)
  const H = Math.max(150, rows * (nodeH + 18) + 20)
  const box = parent.createDiv({ cls: 'llm-wiki-fleet' })
  const root = svg(box, 'svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `${machines.length} machines share this wiki` })
  const cx = W / 2
  const cy = H / 2
  const ordered = [...machines].sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name))
  ordered.forEach((m, i) => {
    const left = i % 2 === 0
    const row = Math.floor(i / 2)
    const x = left ? 12 : W - nodeW - 12
    const y = (H - rows * (nodeH + 18) + 18) / 2 + row * (nodeH + 18)
    const tone = STATE_TONE[m.state] ?? 'muted'
    svg(root, 'line', { x1: cx, y1: cy, x2: left ? x + nodeW : x, y2: y + nodeH / 2, class: `llm-wiki-fleet-edge is-${tone}` })
    const g = svg(root, 'g', { class: `llm-wiki-fleet-node${m.me ? ' is-me' : ''}` })
    svg(g, 'title', {}, [m.name, m.state, m.lastSeen ? `seen ${relativeTime(m.lastSeen)}` : '', m.roles.length ? `runs ${m.roles.join(', ')}` : '', m.detail ?? ''].filter(Boolean).join(' · '))
    svg(g, 'rect', { x, y, width: nodeW, height: nodeH, rx: 8 })
    svg(g, 'circle', { cx: x + 16, cy: y + 18, r: 4, class: `llm-wiki-fleet-dot is-${tone}` })
    svg(g, 'text', { x: x + 28, y: y + 22, class: 'llm-wiki-fleet-name' }, `${m.name}${m.me ? ' (this)' : ''}`)
    const sub = [m.state === 'healthy' || m.state === 'no-cadence' ? '' : m.state, m.lastSeen ? `seen ${relativeTime(m.lastSeen)}` : 'never seen', m.roles.slice(0, 3).join(' · ')].filter(Boolean).join(' · ')
    svg(g, 'text', { x: x + 12, y: y + 42, class: 'llm-wiki-fleet-sub' }, sub.length > 40 ? `${sub.slice(0, 39)}…` : sub)
  })
  svg(root, 'circle', { cx, cy, r: 24, class: 'llm-wiki-fleet-hub' })
  svg(root, 'text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'llm-wiki-fleet-sub' }, 'remote')
}

/** When a job runs next, for sorting: running and due first, then the clock. */
function nextAt(j: JobView): number {
  if (j.running) return -2
  if (j.next.kind === 'due' || j.next.kind === 'queued') return -1
  if (j.next.kind === 'at' && j.next.at) return Date.parse(j.next.at)
  return Number.POSITIVE_INFINITY
}

function jobsBlock(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const body = section(root, 'Jobs', { count: snapshot.jobs.length, actions: (bar) => button(bar, 'All jobs', () => ctx.goTo('jobs'), { icon: 'arrow-right' }) })
  const running = sorted(snapshot.jobs.filter((j) => j.running))
  if (running.length) {
    const cards = body.createDiv({ cls: 'llm-wiki-cards' })
    for (const j of running.slice(0, 4)) jobCard(cards, j, ctx)
  }
  const upcoming = snapshot.jobs.filter((j) => !j.running && Number.isFinite(nextAt(j))).sort((a, b) => nextAt(a) - nextAt(b)).slice(0, 6)
  if (!running.length && !upcoming.length) empty(body, 'Nothing is running or scheduled.', 'Jobs that run by hand are on the Jobs tab.')
  for (const j of upcoming) {
    const row = body.createDiv({ cls: 'llm-wiki-row is-link llm-wiki-upnext' })
    row.addEventListener('click', () => openJobModal(ctx.plugin.app, j, ctx))
    row.createSpan({ cls: `llm-wiki-upnext-when is-${j.next.kind}`, text: j.next.kind === 'at' && j.next.at ? relativeTime(j.next.at) : nextText(j) })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: j.name })
    main.createDiv({ cls: 'llm-wiki-row-detail', text: [j.schedule, j.last.at ? `last ${j.last.outcome === 'failed' ? 'failed' : 'ran'} ${relativeTime(j.last.at)}` : 'never ran'].join(' · ') })
    const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
    // With a runner, a scheduled job's row offers no Run of its own; here, ahead of its time, it does.
    const actions = ctx.plugin.actions
    if (actions && snapshot.runner && j.next.kind === 'at' && !j.credential) button(bar, 'Run now', () => ctx.write(() => actions.runJob(j.slug)), { icon: 'play' })
    jobButtons(bar, j, ctx)
  }
}

/** One line about content, pointing at Changes. */
function todayLine(root: HTMLElement, ctx: TabContext): void {
  const fresh = newPages(ctx).length
  const drafts = draftsIn(ctx.plugin.app).length
  const today = ctx.snapshot.activity.filter((c) => dayOf(c.at) === 'Today').length
  const line = root.createDiv({ cls: 'llm-wiki-today is-link' })
  line.createSpan({ text: `Today: ${fresh} new · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'} · ${today} saved to history` })
  line.createSpan({ cls: 'llm-wiki-muted', text: ' → Changes' })
  line.addEventListener('click', () => ctx.goTo('changes'))
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
  card.createEl('p', { cls: 'llm-wiki-muted', text: 'A job follows a source on a schedule: a URL, a mailbox, a channel. A skill is how it knows the venue. Describe the source in plain words and the agent sets up both.' })
  const bar = card.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Add a source…', () => ctx.plugin.addJob(), { icon: 'plus', cta: true })
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

const LABEL: Record<Exclude<AttentionItem['action'], undefined>['kind'], string> = { ask: 'Ask the agent', open: 'Open', retry: 'Retry', reindex: 'Review index', credential: 'Set credential', inspect: 'Inspect' }
const ICON: Record<Exclude<AttentionItem['action'], undefined>['kind'], string | undefined> = { ask: 'message-square', open: undefined, retry: 'rotate-ccw', reindex: 'refresh-cw', credential: 'key-round', inspect: 'file-text' }

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
  if (a.kind === 'credential' && a.retry) button(actions, 'Retry', () => ctx.act({ kind: 'retry', ticket: a.retry!, slug: a.job }), { icon: 'rotate-ccw' })
}
