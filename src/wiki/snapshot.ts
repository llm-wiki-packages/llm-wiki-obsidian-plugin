// CLI answers into the dashboard's Snapshot: the one place that knows the
// answers' field names (docs/cli-shapes.md). Every read is soft, so one
// failing verb leaves a hole and a note, never an empty dashboard.
import type { Args, Verb } from './cli'
import { parseSkill } from '../chat/skills'
import type { AttentionItem, CredentialView, CurationItem, JobView, RecentRun, SkillView, SlotView, Snapshot, TicketView } from './model'

/** What the builder needs of a Cli, so a test can hand it fixtures. */
export interface Reader {
  run<T = unknown>(verb: Verb, args?: Args): Promise<T>
}

/** Where the files are and how to read one: the wiki root for held units, the home for the package cache. Optional; without it no note is read. */
export interface Files {
  root: string
  home: string
  read(path: string): Promise<string>
}

// The slices of each answer the dashboard reads. Optional where an older CLI omits them.
export interface DoctorAnswer {
  rows?: { check: string; status: 'ok' | 'warn' | 'fail' | 'info'; detail: string; fix: string | null }[]
}
export interface JobRow {
  slug: string
  description?: string
  skill?: string | null
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
  queued_at?: string | null
  claimed_at?: string | null
  runtime_s?: number | null
}
export interface PageRow {
  path: string
  status: string | null
  change?: 'new' | 'edited' | 'current' | null
}
export interface OpSinceAnswer {
  runs?: { op: string; outcome: string; when: string; summary: string }[]
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
export interface SkillRow {
  name: string
  state: string
  from?: string | null
  venue?: string | null
  version?: string | null
  next?: string | null
  drifted?: boolean | null
  outdated?: boolean
  warnings?: string[]
  /** `filled/required` credential slots, null when the unit declares none. */
  mapped?: string | null
  /** Only on an exact `skills ls <name>`. */
  manifest?: {
    requires?: { credentials?: Record<string, string> }
    usage?: string
    watch?: { inputs?: Record<string, { prompt?: string; required?: boolean }> }
  }
  path?: string
  enable_notes?: string | null
  usage_notes?: string | null
}
export interface SkillsLsAnswer {
  skills?: SkillRow[]
}
export interface SkillsDoctorAnswer {
  findings?: { name: string; level: 'fail' | 'warn' | 'info'; what: string; fix: string | null }[]
}
export interface PackagesLsAnswer {
  this_wiki?: { package: string; current?: string | null }[]
  installed?: { package: string; cache?: string | null }[]
}
export interface PackagesShowAnswer {
  shown?: string | null
  shown_ref?: string | null
  manifest?: { artifacts?: { type: string; name: string }[] }
}
export interface CredentialRow {
  name: string
  kind: string
  state: string
  verified?: string | null
}
export interface BindingRow {
  skill?: string
  job?: string
  name: string
  credential: string
  state: string
}
export interface BindingsAnswer {
  skills?: BindingRow[]
  jobs?: BindingRow[]
}

export async function takeSnapshot(cli: Reader, wikiKey: string, now = Date.now(), files?: Files): Promise<Snapshot> {
  const errors: Record<string, string> = {}
  const soft = async <T>(verb: Verb, args: Args = {}): Promise<T | null> => {
    try {
      return await cli.run<T>(verb, { wiki: wikiKey, ...args })
    } catch (e) {
      errors[verb] = (e instanceof Error ? e.message : String(e)).replace(/^wiki\.[a-z.]+: /, '')
      return null
    }
  }
  const [doctor, jobsLs, due, tickets, pages, ops, search, conflicts, runnerLs, skillsLs, skillsDoctor, packagesLs, credentialsLs, bindings] = await Promise.all([
    soft<DoctorAnswer>('wiki.doctor'),
    soft<JobsLsAnswer>('wiki.jobs.ls'),
    soft<JobsDueAnswer>('wiki.jobs.due'),
    soft<{ tickets?: TicketRow[] }>('wiki.tickets.ls'),
    soft<{ pages?: PageRow[] }>('wiki.page.ls'),
    soft<OpSinceAnswer>('wiki.op.since', { since: '1d' }),
    soft<SearchStatusAnswer>('wiki.search.status'),
    soft<{ pages?: string[] }>('wiki.git.conflicts'),
    soft<RunnerLsAnswer>('machine.runner.ls'),
    soft<SkillsLsAnswer>('wiki.skills.ls'),
    soft<SkillsDoctorAnswer>('wiki.skills.doctor'),
    soft<PackagesLsAnswer>('wiki.packages.ls'),
    soft<CredentialRow[] | { rows?: CredentialRow[] }>('wiki.credentials.ls'),
    soft<BindingsAnswer>('wiki.credentials.bindings'),
  ])
  // A second round, per unit and per package: the manifest names the slots, the package names what else could be installed.
  const skillRows = skillsLs?.skills ?? []
  const [shown, packages] = await Promise.all([
    Promise.all(skillRows.map((r) => soft<SkillsLsAnswer>('wiki.skills.show', { name: r.name }).then((a) => a?.skills?.[0] ?? r))),
    Promise.all((packagesLs?.this_wiki ?? []).map((p) => soft<PackagesShowAnswer>('wiki.packages.show', { name: p.package }).then((a) => ({ name: p.package, answer: a })))),
  ])

  const ticketRows = tickets?.tickets ?? []
  const jobRows = (jobsLs?.jobs ?? []).filter((j) => j.state !== 'archived')
  const bindingRows = [...(bindings?.skills ?? []), ...(bindings?.jobs ?? [])]
  const credentials = credentialViews(Array.isArray(credentialsLs) ? credentialsLs : (credentialsLs?.rows ?? []), bindingRows)
  const caches = Object.fromEntries((packagesLs?.installed ?? []).map((p) => [p.package, p.cache ?? null]))
  const skills = skillViews(shown, packages, jobRows, bindingRows, credentials, files ? { root: files.root, home: files.home, caches } : undefined)
  if (files)
    await Promise.all(skills.map(async (sk) => {
      if (!sk.dir) return
      try {
        sk.description = parseSkill(sk.name, await files.read(`${sk.dir}/SKILL.md`)).description
      } catch {
        // a unit without a readable SKILL.md keeps an empty description
      }
    }))
  const jobs = jobRows.map((j) => jobView(j, ticketRows, now, skills))
  const attention = attentionItems({ doctor, due, jobsLs, jobs, skills, skillsDoctor, search, conflicts: conflicts?.pages ?? [], ticketRows })
  const runner = (runnerLs?.wikis ?? []).some((w) => w.wiki_key === wikiKey && w.installed !== null)
  const pageRows = pages?.pages ?? []
  // An older CLI lists no change state; then the queue is unknowable rather than empty.
  const tellsChange = pageRows.some((p) => 'change' in p)
  const errors_ = attention.filter((a) => a.severity === 'error').length
  const count = errors_ + attention.filter((a) => a.severity === 'warn').length
  return {
    takenAt: now,
    wikiKey,
    health: { tone: errors_ ? 'error' : count ? 'warn' : 'ok', count },
    attention,
    runner,
    jobs,
    skills,
    credentials,
    curation: pageRows.filter((p) => p.status === 'draft').map(curationItem),
    unadopted: tellsChange ? pageRows.filter((p) => p.change === 'new' && p.path.startsWith('sources/')).map(curationItem) : null,
    recent: (ops?.runs ?? []).map(recentRun),
    errors,
  }
}

const STAGE_DONE: Record<string, string> = { harvest: 'harvesting', transcribe: 'transcribing', enrich: 'enriching', process: 'processing', routine: 'running' }

/** The slot that keeps a unit from running here: a bound credential gone stale, missing or failed, else a required slot left empty. */
export function unboundSlot(skill: SkillView | undefined): SlotView | undefined {
  return skill?.slots.find((s) => s.credential !== null && s.problem) ?? skill?.slots.find((s) => s.required && s.credential === null)
}

export function jobView(j: JobRow, tickets: TicketRow[], now: number, skills: SkillView[] = []): JobView {
  const paused = j.state === 'paused'
  const unit = j.skill ? skills.find((s) => s.name === j.skill) : undefined
  const unbound = unboundSlot(unit)
  const v = j.verdict
  const active = j.running?.[0]
  const mine = tickets.filter((t) => t.slug === j.slug)
  const failing = (j.stages ?? []).some((s) => !s.skipped && (s.failing?.length ?? 0) > 0)
  const lastOk = v?.last_ok ?? (j.stages ?? []).map((s) => s.ok_started).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
  const last: JobView['last'] = lastOk ? { at: lastOk, outcome: failing ? 'failed' : 'ok' } : failing ? { at: null, outcome: 'failed' } : { at: null, outcome: null }

  let next: JobView['next']
  const pending = mine.find((t) => t.state === 'pending')
  const held = pending?.not_before && Date.parse(pending.not_before) > now ? pending.not_before : null
  const detail = v?.reasons?.length ? v.reasons.join('; ') : undefined
  if (active) next = { kind: 'running', detail }
  else if (paused) next = { kind: 'paused' }
  else if (held) next = { kind: 'held', at: held, detail: pending?.reason ?? detail }
  else if (pending) next = { kind: 'queued', detail }
  else if (unbound && unit) next = { kind: 'unbound', detail: unbound.credential ? `${unbound.credential} is ${unbound.problem ?? 'broken'}` : `${unit.name} needs a credential` }
  else if (j.blocked) next = { kind: 'blocked', detail: j.blocked }
  else if (v?.due ?? j.due) next = { kind: 'due', detail }
  else if (!v) next = { kind: 'unknown' }
  else
    switch (v.kind) {
      case 'period':
      case 'window':
        next = { kind: 'at', at: v.next_at ?? null, detail: v.next_at ? detail : (j.window ? `next window ${j.window}` : detail) }
        break
      case 'requires':
        next = { kind: 'blocked', detail: (v.blocked_by ?? []).join(', ') || 'a requirement is unmet' }
        break
      case 'failed-cap':
        next = { kind: 'blocked', detail: 'failed too often' }
        break
      case 'once':
      case 'no-work':
      case 'off':
        next = { kind: 'manual', detail }
        break
      default:
        next = { kind: 'unknown', detail }
    }

  return {
    slug: j.slug,
    name: j.description?.trim() || j.slug,
    kind: j.kind ?? '',
    skill: j.skill ?? null,
    schedule: j.every ? (j.every === 'once' ? 'once' : `every ${j.every}`) + (j.window ? ` · ${j.window}` : '') : 'manual',
    paused,
    last,
    next,
    running: active ? { ticket: active.id, stage: active.step?.name ?? STAGE_DONE[active.stage] ?? active.stage, since: active.since } : null,
    credential: unbound ? { slot: unbound.name, name: unbound.credential, problem: unbound.credential ? (unbound.problem ?? 'broken') : 'missing' } : null,
    reasons: v?.reasons ?? [],
    tickets: mine.map(ticketView).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
  }
}

function ticketView(t: TicketRow): TicketView {
  return { id: t.id, stage: t.stage, state: t.state, at: t.claimed_at ?? t.queued_at ?? null, reason: t.reason ?? null, runtimeS: t.runtime_s ?? null }
}

/** One view per unit the wiki holds or this machine loads, then the package's units not yet installed. */
function skillViews(
  rows: SkillRow[],
  packages: { name: string; answer: PackagesShowAnswer | null }[],
  jobs: JobRow[],
  bindings: BindingRow[],
  credentials: CredentialView[],
  where?: { root: string; home: string; caches: Record<string, string | null> },
): SkillView[] {
  const held = rows.map((r): SkillView => {
    const declared = r.manifest?.requires?.credentials ?? {}
    const bound = bindings.filter((b) => b.skill === r.name)
    const names = [...new Set([...Object.keys(declared), ...bound.map((b) => b.name)])]
    const slots = names.map((name): SlotView => {
      const b = bound.find((x) => x.name === name)
      // A binding the CLI calls bound can still point at a credential whose own check failed.
      const failed = b && credentials.find((c) => c.name === b.credential)?.state === 'failed'
      const problem = b && b.state !== 'bound' ? b.state : failed ? 'failed' : undefined
      return { name, required: declared[name] === 'required', credential: b?.credential ?? null, ...(problem ? { problem } : {}) }
    })
    // Without the manifest, the CLI's own count still says whether something is missing.
    const m = /^(\d+)\/(\d+)$/.exec(r.mapped ?? '')
    if (!r.manifest && m && Number(m[1]) < Number(m[2]) && !slots.some((s) => s.required && !s.credential))
      slots.push({ name: 'credential', required: true, credential: null })
    const enabled = r.state === 'enabled' || r.state === 'drifted' || r.state === 'linked'
    const inputs = Object.entries(r.manifest?.watch?.inputs ?? {}).map(([name, i]) => ({ name, prompt: i.prompt ?? name, required: i.required ?? false }))
    const rel = r.path ?? `.llm-wiki/skills/${r.name}`
    const dir = where ? `${where.root}/${rel}` : rel
    return {
      name: r.name,
      state: enabled ? 'enabled' : 'installed',
      description: '',
      venue: r.venue ?? null,
      version: r.version ?? null,
      from: r.from ?? null,
      usage: r.manifest?.usage ?? (enabled ? (r.next ?? null) : null),
      drifted: r.drifted === true,
      outdated: r.outdated === true,
      warnings: r.warnings ?? [],
      slots,
      jobs: jobs.filter((j) => j.skill === r.name).map((j) => j.slug),
      inputs,
      notes: { skill: 'SKILL.md', ...(r.enable_notes ? { enable: r.enable_notes } : {}), ...(r.usage_notes ? { usage: r.usage_notes } : {}) },
      dir,
    }
  })
  const known = new Set(held.map((s) => s.name))
  const available: SkillView[] = []
  for (const p of packages)
    for (const a of p.answer?.manifest?.artifacts ?? [])
      if (a.type === 'skill' && !known.has(a.name)) {
        known.add(a.name)
        const cache = where?.caches[p.name]?.replace(/^~/, where.home)
        const dir = cache && p.answer?.shown_ref ? `${cache}/@${p.answer.shown_ref}/skills/${a.name}` : null
        available.push({
          name: a.name, state: 'available', description: '', venue: null, version: null, from: p.answer?.shown ? `${p.name}@${p.answer.shown}` : p.name,
          usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir,
        })
      }
  const rank = { enabled: 0, installed: 1, available: 2 }
  return [...held, ...available].sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name))
}

function credentialViews(rows: CredentialRow[], bindings: BindingRow[]): CredentialView[] {
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind,
    state: r.state,
    verified: r.verified ?? null,
    uses: bindings.filter((b) => b.credential === r.name).map((b) => ({ ...(b.skill ? { skill: b.skill } : {}), ...(b.job ? { job: b.job } : {}), slot: b.name, ...(b.state !== 'bound' ? { problem: b.state } : {}) })),
  }))
}

function attentionItems(input: {
  doctor: DoctorAnswer | null
  due: JobsDueAnswer | null
  jobsLs: JobsLsAnswer | null
  jobs: JobView[]
  skills: SkillView[]
  skillsDoctor: SkillsDoctorAnswer | null
  search: SearchStatusAnswer | null
  conflicts: string[]
  ticketRows: TicketRow[]
}): AttentionItem[] {
  const out: AttentionItem[] = []
  // A job whose unit has an empty slot here: one row with the fix as a button, in place of the doctor's two sentences about it.
  const unbound = input.jobs.filter((j) => j.next.kind === 'unbound')
  const unboundRows: AttentionItem[] = []
  for (const j of unbound) {
    const c = j.credential
    if (!c || !j.skill) continue
    unboundRows.push({ id: `unbound:${j.slug}`, severity: 'warn', title: `${j.name} cannot run on this machine`, detail: j.next.detail, action: { kind: 'credential', skill: j.skill, slot: c.slot, ...(c.name ? { name: c.name } : {}) } })
  }
  const covered = new Set(unbound.length ? ['bindings', 'jobs-skipped'] : [])
  for (const r of input.doctor?.rows ?? []) {
    if (r.status !== 'fail' && r.status !== 'warn') continue
    if (covered.has(r.check)) continue
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
  for (const t of parked) {
    const job = input.jobs.find((j) => j.slug === t.job)
    const name = job?.name ?? t.job
    // A stopped job whose credential is the problem: fixing the credential is the button, and the retry rides along.
    if (job?.credential && job.skill) {
      const c = job.credential
      out.push({ id: `parked:${t.id}`, severity: 'warn', title: `${name} stopped: ${c.name ? `${c.name} is ${c.problem}` : `${job.skill} needs a credential`}`, detail: t.reason ?? undefined, action: { kind: 'credential', skill: job.skill, slot: c.slot, ...(c.name ? { name: c.name } : {}), retry: t.id } })
      continue
    }
    out.push({ id: `parked:${t.id}`, severity: 'warn', title: `${name} ${t.stage} stopped${t.reason ? `: ${t.reason}` : ''}`, detail: `ticket ${t.id}`, action: { kind: 'retry', ticket: t.id } })
  }
  const stopped = new Set(parked.map((t) => t.job))
  for (const r of unboundRows) if (!stopped.has(r.id.slice('unbound:'.length))) out.push(r)
  for (const t of input.due?.review ?? [])
    out.push({ id: `review:${t.id}`, severity: 'info', title: `${t.job} ${t.stage} asks for review${t.reason ? `: ${t.reason}` : ''}`, detail: `ticket ${t.id}`, action: { kind: 'ask', prompt: `Ticket ${t.id} of job ${t.job} is in review${t.reason ? ` (${t.reason})` : ''}. Show me what it needs and help me judge it.` } })
  for (const j of input.jobs)
    if (j.next.kind === 'blocked' && !j.paused)
      out.push({ id: `blocked:${j.slug}`, severity: 'warn', title: `${j.name}: ${j.next.detail ?? 'blocked'}`, detail: j.slug, action: { kind: 'ask', prompt: `Job ${j.slug} is blocked: ${j.next.detail ?? 'blocked'}. What does it need, and can you fix it?` } })
  for (const s of input.skills) {
    if (s.drifted) out.push({ id: `drifted:${s.name}`, severity: 'warn', title: `${s.name} differs from the wiki's copy on this machine`, detail: s.warnings[0], action: { kind: 'inspect', skill: s.name } })
    else if (s.outdated) out.push({ id: `outdated:${s.name}`, severity: 'info', title: `A newer ${s.name} is in its package`, action: { kind: 'ask', prompt: `/llm-wiki:enable ${s.name}`, label: 'Update' } })
    const enabledUnbound = s.state === 'enabled' && !s.jobs.length ? unboundSlot(s) : undefined
    if (enabledUnbound) out.push({ id: `slot:${s.name}`, severity: 'info', title: `${s.name} needs a credential for ${enabledUnbound.name}`, action: { kind: 'credential', skill: s.name, slot: enabledUnbound.name } })
  }
  for (const f of input.skillsDoctor?.findings ?? []) {
    if (f.level === 'info') continue
    const unit = input.skills.find((s) => s.name === f.name)
    out.push({ id: `skill:${f.name}`, severity: f.level === 'fail' ? 'error' : 'warn', title: f.what, detail: f.name, fix: f.fix ?? undefined, action: unit ? { kind: 'inspect', skill: unit.name } : { kind: 'ask', prompt: `The skills doctor reports for ${f.name}: ${f.what}${f.fix ? ` It suggests: ${f.fix}` : ''} Please check and fix it if that is safe.`, label: 'Fix with the agent' } })
  }
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

function curationItem(p: PageRow): CurationItem {
  const base = p.path.split('/').pop() ?? p.path
  return { path: p.path, title: base.replace(/\.md$/, ''), job: p.path.split('/').slice(1, -1).join('/') || undefined }
}

function recentRun(r: NonNullable<OpSinceAnswer['runs']>[number]): RecentRun {
  return { op: r.op, outcome: r.outcome, at: r.when, summary: r.summary === `${r.op} ${r.outcome}` ? '' : r.summary }
}
