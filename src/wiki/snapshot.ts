// CLI answers into the dashboard's Snapshot: the one place that knows the
// answers' field names (docs/cli-shapes.md). Every read is soft, so one
// failing verb leaves a hole and a note, never an empty dashboard.
import type { Args, Verb } from './cli'
import type { AttentionItem, CurationItem, JobView, RecentRun, Snapshot } from './model'

/** What the builder needs of a Cli, so a test can hand it fixtures. */
export interface Reader {
  run<T = unknown>(verb: Verb, args?: Args): Promise<T>
}

// The slices of each answer the dashboard reads. Optional where an older CLI omits them.
export interface DoctorAnswer {
  overall?: 'ok' | 'warn' | 'fail'
  rows?: { check: string; status: 'ok' | 'warn' | 'fail' | 'info'; detail: string; fix: string | null }[]
}
export interface JobRow {
  slug: string
  description?: string
  every?: string | null
  state?: 'active' | 'paused' | 'archived'
  kind?: string
  window?: string | null
  due?: boolean
  blocked?: string | null
  stages?: { stage: string; skipped?: boolean; failing?: string[]; attempts?: number; ok_started?: string | null }[]
  verdict?: {
    due: boolean
    kind: null | 'off' | 'paused' | 'once' | 'failed-cap' | 'period' | 'window' | 'requires' | 'no-work'
    reasons?: string[]
    blocked_by?: string[]
    next_at?: string | null
    last_ok?: string | null
  }
  running?: { id: string; stage: string; since: string | null; step?: { index: number; name: string } | null }[]
}
export interface JobsLsAnswer {
  jobs?: JobRow[]
  unreadable?: { slug: string; reason: string }[]
}
export interface JobsDueAnswer {
  review?: { id: string; job: string; stage: string; reason: string | null }[]
  parked?: { id: string; job: string; stage: string; reason: string | null }[]
  handoffs?: { problems?: string[] }
}
export interface TicketRow {
  id: string
  stage: string
  state: 'pending' | 'active' | 'done' | 'failed' | 'orphan'
  slug: string | null
  not_before?: string | null
  reason?: string | null
}
export interface PageRow {
  path: string
  status: string | null
  change?: 'new' | 'edited' | 'current' | null
}
export interface OpSinceAnswer {
  runs?: { op: string; outcome: string; when: string; summary: string; session?: string }[]
}
export interface SearchStatusAnswer {
  engine_configured?: boolean
  realm_ready?: boolean
  realm_reason?: string
  serving?: string | null
}
export interface RunnerLsAnswer {
  wikis?: { wiki_key: string; installed: object | null }[]
}

export async function takeSnapshot(cli: Reader, wikiKey: string, now = Date.now()): Promise<Snapshot> {
  const errors: Record<string, string> = {}
  const soft = async <T>(verb: Verb, args: Args = {}): Promise<T | null> => {
    try {
      return await cli.run<T>(verb, { wiki: wikiKey, ...args })
    } catch (e) {
      errors[verb] = (e instanceof Error ? e.message : String(e)).replace(/^wiki\.[a-z.]+: /, '')
      return null
    }
  }
  const [doctor, jobsLs, due, tickets, pages, ops, search, conflicts, runnerLs] = await Promise.all([
    soft<DoctorAnswer>('wiki.doctor'),
    soft<JobsLsAnswer>('wiki.jobs.ls'),
    soft<JobsDueAnswer>('wiki.jobs.due'),
    soft<{ tickets?: TicketRow[] }>('wiki.tickets.ls'),
    soft<{ pages?: PageRow[] }>('wiki.page.ls'),
    soft<OpSinceAnswer>('wiki.op.since', { since: '1d' }),
    soft<SearchStatusAnswer>('wiki.search.status'),
    soft<{ pages?: string[] }>('wiki.git.conflicts'),
    soft<RunnerLsAnswer>('machine.runner.ls'),
  ])

  const ticketRows = tickets?.tickets ?? []
  const jobs = (jobsLs?.jobs ?? []).filter((j) => j.state !== 'archived').map((j) => jobView(j, ticketRows, now))
  const attention = attentionItems({ doctor, due, jobsLs, jobs, search, conflicts: conflicts?.pages ?? [], ticketRows })
  const runner = (runnerLs?.wikis ?? []).some((w) => w.wiki_key === wikiKey && w.installed !== null) || (runnerLs === null && !('machine.runner.ls' in errors))
  return {
    takenAt: now,
    wikiKey,
    health: health(attention, jobs, now),
    attention,
    runner,
    jobs,
    curation: (pages?.pages ?? []).filter((p) => p.status === 'draft').map(curationItem),
    recent: (ops?.runs ?? []).map(recentRun),
    errors,
  }
}

const STAGE_DONE: Record<string, string> = { harvest: 'harvesting', transcribe: 'transcribing', enrich: 'enriching', process: 'processing', routine: 'running' }

export function jobView(j: JobRow, tickets: TicketRow[], now: number): JobView {
  const paused = j.state === 'paused'
  const v = j.verdict
  const active = j.running?.[0]
  const mine = tickets.filter((t) => t.slug === j.slug)
  const failing = (j.stages ?? []).some((s) => !s.skipped && (s.failing?.length ?? 0) > 0)
  const lastOk = v?.last_ok ?? (j.stages ?? []).map((s) => s.ok_started).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
  const last: JobView['last'] = lastOk ? { at: lastOk, outcome: failing ? 'failed' : 'ok' } : failing ? { at: null, outcome: 'failed' } : { at: null, outcome: null }

  let next: JobView['next']
  const pending = mine.find((t) => t.state === 'pending')
  const held = pending?.not_before && Date.parse(pending.not_before) > now ? pending.not_before : null
  const reason = v?.reasons?.length ? v.reasons.join('; ') : undefined
  if (active) next = { kind: 'running', text: 'Running', reason }
  else if (paused) next = { kind: 'paused', text: 'Paused' }
  else if (held) next = { kind: 'held', text: `Held until ${clock(held)}`, reason: pending?.reason ?? reason, at: held }
  else if (pending) next = { kind: 'due', text: 'Queued', reason }
  else if (j.blocked) next = { kind: 'blocked', text: `Blocked — ${j.blocked}`, reason: j.blocked }
  else if (v?.due ?? j.due) next = { kind: 'due', text: 'Due now', reason }
  else if (!v) next = { kind: 'unknown', text: '' }
  else
    switch (v.kind) {
      case 'period':
      case 'window':
        next = v.next_at ? { kind: 'at', text: `in ${ago(v.next_at, now)}`, reason, at: v.next_at } : { kind: 'at', text: j.window ? `next window ${j.window}` : 'Scheduled', reason }
        break
      case 'requires':
        next = { kind: 'blocked', text: `Blocked — ${(v.blocked_by ?? []).join(', ') || 'a requirement is unmet'}`, reason }
        break
      case 'failed-cap':
        next = { kind: 'blocked', text: 'Blocked — failed too often', reason }
        break
      case 'once':
        next = { kind: 'manual', text: lastOk ? 'Ran once' : 'Once, when run', reason }
        break
      case 'no-work':
        next = { kind: 'manual', text: 'Nothing to do', reason }
        break
      case 'off':
        next = { kind: 'manual', text: 'Manual', reason }
        break
      default:
        next = { kind: 'unknown', text: reason ?? '', reason }
    }

  return {
    slug: j.slug,
    name: j.description?.trim() || j.slug,
    kind: j.kind ?? '',
    schedule: j.every ? (j.every === 'once' ? 'once' : `every ${j.every}`) + (j.window ? ` · ${j.window}` : '') : 'manual',
    paused,
    last,
    next,
    running: active ? { ticket: active.id, stage: active.step?.name ?? STAGE_DONE[active.stage] ?? active.stage, since: active.since } : null,
  }
}

function attentionItems(input: {
  doctor: DoctorAnswer | null
  due: JobsDueAnswer | null
  jobsLs: JobsLsAnswer | null
  jobs: JobView[]
  search: SearchStatusAnswer | null
  conflicts: string[]
  ticketRows: TicketRow[]
}): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const r of input.doctor?.rows ?? []) {
    if (r.status !== 'fail' && r.status !== 'warn') continue
    out.push({
      id: `doctor:${r.check}`,
      severity: r.status === 'fail' ? 'error' : 'warn',
      title: r.detail,
      detail: r.check,
      fix: r.fix ?? undefined,
      action: { kind: 'ask', prompt: `The wiki doctor reports "${r.check}": ${r.detail}${r.fix ? ` It suggests: ${r.fix}` : ''} Please check it and fix it if that is safe.`, label: 'Fix with the agent' },
    })
  }
  const parked = input.due?.parked ?? input.ticketRows.filter((t) => t.state === 'failed').map((t) => ({ id: t.id, job: t.slug ?? '', stage: t.stage, reason: t.reason }))
  for (const t of parked)
    out.push({ id: `parked:${t.id}`, severity: 'warn', title: `${t.job} ${t.stage} stopped${t.reason ? `: ${t.reason}` : ''}`, detail: `ticket ${t.id}`, action: { kind: 'retry', ticket: t.id } })
  for (const t of input.due?.review ?? [])
    out.push({ id: `review:${t.id}`, severity: 'info', title: `${t.job} ${t.stage} asks for review${t.reason ? `: ${t.reason}` : ''}`, detail: `ticket ${t.id}`, action: { kind: 'ask', prompt: `Ticket ${t.id} of job ${t.job} is in review${t.reason ? ` (${t.reason})` : ''}. Show me what it needs and help me judge it.` } })
  for (const j of input.jobs)
    if (j.next.kind === 'blocked' && !j.paused)
      out.push({ id: `blocked:${j.slug}`, severity: 'warn', title: `${j.name}: ${j.next.text.replace(/^Blocked — /, '')}`, detail: j.slug, action: { kind: 'ask', prompt: `Job ${j.slug} is blocked: ${j.next.reason ?? j.next.text}. What does it need, and can you fix it?` } })
  for (const u of input.jobsLs?.unreadable ?? [])
    out.push({ id: `unreadable:${u.slug}`, severity: 'warn', title: `${u.slug}: ${u.reason}`, action: { kind: 'ask', prompt: `Job ${u.slug} cannot be read: ${u.reason}. Please repair its record.` } })
  for (const p of input.due?.handoffs?.problems ?? []) out.push({ id: `handoff:${p}`, severity: 'warn', title: p, action: { kind: 'ask', prompt: `A job handoff reports: ${p}. What is wrong?` } })
  for (const p of input.conflicts) out.push({ id: `conflict:${p}`, severity: 'warn', title: `${p} has two versions`, detail: 'resolve the conflict in the note', action: { kind: 'open', path: p } })
  const s = input.search
  if (s?.engine_configured && s.realm_ready === false)
    out.push({ id: 'search', severity: 'warn', title: `Search engine not ready${s.realm_reason ? `: ${s.realm_reason}` : ''}`, detail: s.serving ? `answering from ${s.serving}` : undefined, action: { kind: 'reindex' } })
  const rank = { error: 0, warn: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

function health(attention: AttentionItem[], jobs: JobView[], now: number): Snapshot['health'] {
  const errors = attention.filter((a) => a.severity === 'error').length
  const warns = attention.filter((a) => a.severity === 'warn').length
  const running = jobs.filter((j) => j.running)
  const due = jobs.filter((j) => !j.running && j.next.kind === 'due')
  const parts: string[] = []
  if (running.length) parts.push(`Running ${running.map((j) => j.name).join(', ')}.`)
  if (due.length) parts.push(`${due.length} ${due.length === 1 ? 'job is' : 'jobs are'} due now.`)
  const lastRun = jobs.map((j) => j.last.at).filter((x): x is string => Boolean(x)).sort().at(-1)
  if (lastRun && !running.length) parts.push(`Last run ${ago(lastRun, now)} ago.`)
  const nextJob = jobs.filter((j) => j.next.kind === 'at' && j.next.at).sort((a, b) => Date.parse(a.next.at!) - Date.parse(b.next.at!))[0]
  if (nextJob && !due.length) parts.push(`Next up ${nextJob.name} in ${ago(nextJob.next.at!, now)}.`)
  if (errors || warns) {
    const n = errors + warns
    return { tone: errors ? 'error' : 'warn', sentence: [`${n} ${n === 1 ? 'thing needs' : 'things need'} you.`, ...parts].join(' ') }
  }
  return { tone: 'ok', sentence: ['All clear.', ...parts].join(' ') }
}

function curationItem(p: PageRow): CurationItem {
  const base = p.path.split('/').pop() ?? p.path
  return { path: p.path, title: base.replace(/\.md$/, ''), job: p.path.split('/').slice(1, -1).join('/') || undefined }
}

function recentRun(r: NonNullable<OpSinceAnswer['runs']>[number]): RecentRun {
  return { op: r.op, outcome: r.outcome, at: r.when, summary: r.summary === `${r.op} ${r.outcome}` ? '' : r.summary, session: r.session }
}

/** `3m`, `2h`, `3d`: the magnitude only; callers add `in` or `ago`. */
function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round(Math.abs(now - Date.parse(iso)) / 60_000))
  if (m < 1) return 'moments'
  if (m < 60) return `${m}m`
  if (m < 36 * 60) return `${Math.round(m / 60)}h`
  return `${Math.round(m / (24 * 60))}d`
}

function clock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
