// CLI answers into the dashboard's Snapshot: the one place that knows the
// answers' field names (docs/cli-shapes.md). Every read is soft, so one
// failing verb leaves a hole and a note, never an empty dashboard.
import type { Args, Verb } from './cli'
import { hasModes, loadsHere, paletteOf, parseSkill, PLUGIN_PREFIX } from '../chat/skills'
import { slotWords } from './slots'
import type { AttentionItem, Commit, CommitFile, CredentialView, JobView, MachineView, PageItem, PageState, PipelineView, RecentRun, SearchStatus, SkillView, SlotView, Snapshot, SyncState, TicketView, UnsavedFile } from './model'
import { isFeed } from './layout'
import { slash } from '../chat/skills'

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
  /** #3669: a `sources/` page nobody has accepted, held or archived. */
  curate_candidate?: boolean
  /** #3669: the two boxes, read through the CLI's one table. */
  draft?: boolean
  archive?: boolean
  unreadable?: boolean
}
/** `status --peers`: this clone's git counts, and every joined machine. */
export interface StatusAnswer {
  machine?: string | null
  git?: { dirty?: number | null; untracked?: number | null; unpushed?: number | null; behind?: number; upstream?: string | null }
  peers?: { machine: string; state: string; last_seen?: string | null; capabilities?: Record<string, string | Record<string, string>>; detail?: string }[] | null
}
export interface GitLogAnswer {
  commits?: { sha: string; at: string; subject: string; op?: string; actor?: string; files?: CommitFile[] }[]
}
/** `git status` (`OPS/commands/git/status.py`): the paths behind `status`'s counts. */
export interface GitStatusAnswer {
  files?: UnsavedFile[]
}
export interface OpSinceAnswer {
  runs?: { op: string; outcome: string; when: string; summary: string }[]
}
/** `search status`, kept whole on the snapshot for the Search tab. */
export type SearchStatusAnswer = SearchStatus
export interface RunnerLsAnswer {
  wikis?: { wiki_key: string; installed: object | null }[]
}
export interface SkillRow {
  /** A unit's name, or `PLUGIN:<name>` for one of the `brain` plugin's own skills. */
  name: string
  /** Null on a plugin skill that ships no sandbox: the enabled plugin loads it, there is nothing to enable. */
  state: string | null
  /** `plugin` on a plugin skill's row. */
  from?: string | null
  venue?: string | null
  version?: string | null
  next?: string | null
  drifted?: boolean | null
  outdated?: boolean
  warnings?: string[]
  /** `filled/required` credential slots, null when the unit declares none. */
  mapped?: string | null
  stages?: string[]
  /** The manifest's: `pipeline`, `session` or both; null on a copy the author has not filled. No key at all from an older CLI. */
  mode?: string[] | null
  description?: string | null
  argument_hint?: string | null
  /** Only on an exact `skills ls <name>`. */
  manifest?: {
    requires?: { credentials?: Record<string, string> }
    usage?: string
    watch?: { inputs?: Record<string, { prompt?: string; required?: boolean }> }
    mode?: string[] | null
    description?: string | null
    argument_hint?: string | null
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

/**
 * Reads the wiki. With `previous`, a light read: the job, ticket and run state move, the skills, credentials and
 * packages are carried over, so a 10-second poll during a run is a handful of spawns and not thirty.
 */
export async function takeSnapshot(cli: Reader, wikiKey: string, now = Date.now(), files?: Files, previous?: Snapshot): Promise<Snapshot> {
  const errors: Record<string, string> = {}
  // At most four CLI processes at once: a wiki is one git checkout, and a burst beside the person's own click trips locks.
  const gate = semaphore(4)
  const soft = async <T>(verb: Verb, args: Args = {}): Promise<T | null> => {
    const release = await gate()
    try {
      return await cli.run<T>(verb, { wiki: wikiKey, ...args })
    } catch (e) {
      errors[verb] = (e instanceof Error ? e.message : String(e)).replace(/^wiki\.[a-z.]+: /, '')
      return null
    } finally {
      release()
    }
  }
  const light = previous !== undefined
  const skip = <T>(): Promise<T | null> => Promise.resolve(null)
  const [doctor, jobsLs, due, tickets, pages, ops, search, conflicts, status, gitLog, gitStatus, runnerLs, skillsLs, skillsDoctor, packagesLs, credentialsLs, bindings] = await Promise.all([
    soft<DoctorAnswer>('wiki.doctor'),
    soft<JobsLsAnswer>('wiki.jobs.ls'),
    soft<JobsDueAnswer>('wiki.jobs.due'),
    soft<{ tickets?: TicketRow[] }>('wiki.tickets.ls'),
    soft<{ pages?: PageRow[] }>('wiki.page.ls'),
    soft<OpSinceAnswer>('wiki.op.since', { since: '1d' }),
    soft<SearchStatusAnswer>('wiki.search.status'),
    soft<{ pages?: string[] }>('wiki.git.conflicts'),
    soft<StatusAnswer>('wiki.status'),
    soft<GitLogAnswer>('wiki.git.log', { since: '7d' }),
    soft<GitStatusAnswer>('wiki.git.status'),
    light ? skip<RunnerLsAnswer>() : soft<RunnerLsAnswer>('machine.runner.ls'),
    light ? skip<SkillsLsAnswer>() : soft<SkillsLsAnswer>('wiki.skills.ls'),
    light ? skip<SkillsDoctorAnswer>() : soft<SkillsDoctorAnswer>('wiki.skills.doctor'),
    light ? skip<PackagesLsAnswer>() : soft<PackagesLsAnswer>('wiki.packages.ls'),
    light ? skip<CredentialRow[] | { rows?: CredentialRow[] }>() : soft<CredentialRow[] | { rows?: CredentialRow[] }>('wiki.credentials.ls'),
    light ? skip<BindingsAnswer>() : soft<BindingsAnswer>('wiki.credentials.bindings'),
  ])
  // A second round, per unit and per package: the manifest names the slots, the package names what else could be installed.
  // A plugin skill's row is already whole; it has no slots, and the show verb takes only a unit's name.
  const listed = skillsLs?.skills ?? []
  const modes = hasModes(listed)
  const skillRows = listed.filter((r) => !r.name.startsWith(PLUGIN_PREFIX))
  const [shown, packages] = await Promise.all([
    Promise.all(skillRows.map((r) => soft<SkillsLsAnswer>('wiki.skills.show', { name: r.name }).then((a) => ({ ...(a?.skills?.[0] ?? r), ...manifestKeys(r) })))),
    Promise.all((packagesLs?.this_wiki ?? []).map((p) => soft<PackagesShowAnswer>('wiki.packages.show', { name: p.package }).then((a) => ({ name: p.package, answer: a })))),
  ])

  const ticketRows = tickets?.tickets ?? []
  const jobRows = (jobsLs?.jobs ?? []).filter((j) => j.state !== 'archived')
  const bindingRows = [...(bindings?.skills ?? []), ...(bindings?.jobs ?? [])]
  const credentials = previous?.credentials ?? credentialViews(Array.isArray(credentialsLs) ? credentialsLs : (credentialsLs?.rows ?? []), bindingRows)
  const caches = Object.fromEntries((packagesLs?.installed ?? []).map((p) => [p.package, p.cache ?? null]))
  const skills = previous
    ? previous.skills.map((s) => ({ ...s, jobs: jobRows.filter((j) => j.skill === s.name).map((j) => j.slug) }))
    : skillViews(shown, packages, jobRows, bindingRows, credentials, files ? { root: files.root, home: files.home, caches } : undefined)
  if (files && !light)
    await Promise.all(skills.map(async (sk) => {
      if (!sk.dir) return
      const skillMd = async () => {
        try {
          sk.description = parseSkill(sk.name, await files.read(`${sk.dir}/SKILL.md`)).description
        } catch {
          // a unit without a readable SKILL.md keeps an empty description
        }
      }
      // A CLI that reads manifests gave a held unit its description; an older one leaves SKILL.md to say it.
      if (!modes) await skillMd()
      // A package unit's manifest says what it will need before it is installed.
      if (sk.state !== 'available') return
      try {
        const m = JSON.parse(await files.read(`${sk.dir}/manifest.json`)) as NonNullable<SkillRow['manifest']>
        sk.slots = Object.entries(m.requires?.credentials ?? {}).map(([name, need]) => ({ name, required: need === 'required', credential: null }))
        sk.inputs = Object.entries(m.watch?.inputs ?? {}).map(([name, i]) => ({ name, prompt: i.prompt ?? name, required: i.required ?? false }))
        sk.usage = m.usage ?? null
        if (modes) {
          sk.mode = m.mode ?? null
          sk.argumentHint = m.argument_hint ?? null
          sk.description = m.description ?? ''
        }
      } catch {
        // no manifest, no promises
      }
      // A catalog not yet carrying the manifest description still has its SKILL.md's.
      if (modes && !sk.description) await skillMd()
    }))
  const pipeline = previous
    ? previous.pipeline.map((p) => ({ ...p, jobs: jobRows.filter((j) => j.skill === p.name).map((j) => j.slug) }))
    : pipelineViews(listed, modes, skills, jobRows)
  const jobs = jobRows.map((j) => jobView(j, ticketRows, now, skills))
  const attention = attentionItems({ doctor, due, jobsLs, jobs, skills, skillsDoctor, search, conflicts: conflicts?.pages ?? [], ticketRows })
  // The skills doctor was not re-read on a light pass; its findings stand until the next full one, so the count does not flicker.
  if (previous) {
    for (const a of previous.attention) if (a.id.startsWith('skill:') && !attention.some((x) => x.id === a.id)) attention.push(a)
    const rank = { error: 0, warn: 1, info: 2 }
    attention.sort((a, b) => rank[a.severity] - rank[b.severity])
  }
  const runner = previous ? previous.runner : (runnerLs?.wikis ?? []).some((w) => w.wiki_key === wikiKey && w.installed !== null)
  const pageRows = pages?.pages ?? []
  const errors_ = attention.filter((a) => a.severity === 'error').length
  const count = errors_ + attention.filter((a) => a.severity === 'warn').length
  // The reads a light pass skipped keep their last verdict, so a known hole does not look healed.
  if (previous) for (const [k, v] of Object.entries(previous.errors)) if (!(k in errors) && /^(wiki\.skills|wiki\.credentials|wiki\.packages|machine\.runner)/.test(k)) errors[k] = v
  return {
    takenAt: now,
    wikiKey,
    health: { tone: errors_ ? 'error' : count ? 'warn' : 'ok', count },
    attention,
    runner,
    jobs,
    skills,
    pipeline,
    palette: previous ? previous.palette : paletteOf(listed),
    credentials,
    pages: pages === null ? null : pageRows.filter((p) => !p.unreadable).map(pageItem),
    boxes: pageRows.some((p) => 'curate_candidate' in p),
    recent: (ops?.runs ?? []).map((r) => recentRun(r, jobRows)),
    activity: (gitLog?.commits ?? []).map(commitOf),
    machine: status?.machine ?? null,
    fleet: fleetOf(status),
    sync: syncOf(status, gitStatus),
    search,
    errors,
  }
}

/** A tiny gate: `await gate()` returns the release. */
function semaphore(n: number): () => Promise<() => void> {
  let active = 0
  const waiting: (() => void)[] = []
  const release = () => {
    active--
    waiting.shift()?.()
  }
  return () =>
    new Promise<() => void>((resolve) => {
      const go = () => {
        active++
        resolve(release)
      }
      if (active < n) go()
      else waiting.push(go)
    })
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
  // A failing stage dates the failure, never the last success.
  const lastFailed = mine.filter((t) => t.state === 'failed').map(ticketView).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))[0]
  const last: JobView['last'] = failing ? { at: lastFailed?.at ?? null, outcome: 'failed' } : lastOk ? { at: lastOk, outcome: 'ok' } : { at: null, outcome: null }

  let next: JobView['next']
  const pending = mine.find((t) => t.state === 'pending')
  const held = pending?.not_before && Date.parse(pending.not_before) > now ? pending.not_before : null
  const detail = v?.reasons?.length ? v.reasons.join('; ') : undefined
  if (active) next = { kind: 'running', detail }
  else if (paused) next = { kind: 'paused' }
  else if (held) next = { kind: 'held', at: held, detail: pending?.reason ?? detail }
  else if (pending) next = { kind: 'queued', detail }
  else if (unbound && unit) next = { kind: 'unbound', detail: unbound.credential ? `${unbound.credential} is ${unbound.problem ?? 'broken'}` : `${unit.name} needs ${slotWords(unbound.name).what}` }
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
    // Without the manifest the slot's key is unknown, so no dialog is offered; the doctor's own bindings row still names the gap.
    const enabled = loadsHere(r.state)
    const inputs = Object.entries(r.manifest?.watch?.inputs ?? {}).map(([name, i]) => ({ name, prompt: i.prompt ?? name, required: i.required ?? false }))
    const rel = r.path ?? `.llm-wiki/skills/${r.name}`
    const dir = where ? `${where.root}/${rel}` : rel
    return {
      name: r.name,
      state: enabled ? 'enabled' : 'installed',
      description: r.description ?? '',
      ...('mode' in r ? { mode: r.mode ?? null } : {}),
      argumentHint: r.argument_hint ?? null,
      stages: r.stages ?? [],
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
          name: a.name, state: 'available', description: '', argumentHint: null, stages: [], venue: null, version: null, from: p.answer?.shown ? `${p.name}@${p.answer.shown}` : p.name,
          usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir,
        })
      }
  const rank = { enabled: 0, installed: 1, available: 2 }
  return [...held, ...available].sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name))
}

/** The keys a listing row reads off the manifest, kept over the show verb's answer; none from an older CLI. */
function manifestKeys(r: SkillRow): Partial<SkillRow> {
  const keys = ['stages', 'mode', 'description', 'argument_hint'] as const
  return Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]))
}

/**
 * What a job can name: every row whose mode includes `pipeline`, the plugin's routines first. From an older CLI, whose
 * rows say no mode, the units with a stage, and no routines. A row whose mode is null is in neither list.
 */
export function pipelineViews(rows: SkillRow[], modes: boolean, skills: SkillView[], jobs: JobRow[]): PipelineView[] {
  const plugin = (r: SkillRow) => r.name.startsWith(PLUGIN_PREFIX)
  const picked = modes ? rows.filter((r) => r.mode?.includes('pipeline')) : rows.filter((r) => !plugin(r) && (r.stages?.length ?? 0) > 0)
  const views = picked.map((r): PipelineView => {
    const unit = skills.find((s) => s.name === r.name)
    const ready = plugin(r) ? r.state === null || r.state === 'accepted' : unit?.state === 'enabled'
    return {
      name: r.name,
      plugin: plugin(r),
      description: unit?.description || (r.description ?? ''),
      stages: r.stages ?? [],
      ready,
      stale: plugin(r) && r.state === 'stale',
      next: ready ? null : (r.next ?? null),
      jobs: jobs.filter((j) => j.skill === r.name).map((j) => j.slug),
    }
  })
  return views.sort((a, b) => Number(b.plugin) - Number(a.plugin) || a.name.localeCompare(b.name))
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
  const credentialRows = new Set<string>()
  for (const t of parked) {
    const job = input.jobs.find((j) => j.slug === t.job)
    const name = job?.name ?? t.job
    // A stopped job whose credential is the problem: fixing the credential is the button, and the retry rides along. One row per job.
    if (job?.credential && job.skill) {
      if (credentialRows.has(job.slug)) continue
      credentialRows.add(job.slug)
      const c = job.credential
      out.push({ id: `parked:${t.id}`, severity: 'warn', title: `${name} stopped: ${c.name ? `${c.name} is ${c.problem}` : `${job.skill} needs ${slotWords(c.slot).what}`}`, detail: t.reason ?? undefined, action: { kind: 'credential', skill: job.skill, slot: c.slot, ...(c.name ? { name: c.name } : {}), retry: t.id, job: t.job } })
      continue
    }
    out.push({ id: `parked:${t.id}`, severity: 'warn', title: `${name} ${t.stage} stopped${t.reason ? `: ${t.reason}` : ''}`, detail: `run ${t.id}`, action: { kind: 'retry', ticket: t.id, slug: t.job } })
  }
  const stopped = new Set(parked.map((t) => t.job))
  for (const r of unboundRows) if (!stopped.has(r.id.slice('unbound:'.length))) out.push(r)
  for (const t of input.due?.review ?? [])
    out.push({ id: `review:${t.id}`, severity: 'info', title: `${t.job} ${t.stage} asks for review${t.reason ? `: ${t.reason}` : ''}`, detail: `run ${t.id}`, action: { kind: 'ask', prompt: `Ticket ${t.id} of job ${t.job} is in review${t.reason ? ` (${t.reason})` : ''}. Show me what it needs and help me judge it.` } })
  for (const j of input.jobs)
    if (j.next.kind === 'blocked' && !j.paused)
      out.push({ id: `blocked:${j.slug}`, severity: 'warn', title: `${j.name}: ${j.next.detail ?? 'blocked'}`, detail: j.slug, action: { kind: 'ask', prompt: `Job ${j.slug} is blocked: ${j.next.detail ?? 'blocked'}. What does it need, and can you fix it?` } })
  for (const s of input.skills) {
    if (s.drifted) out.push({ id: `drifted:${s.name}`, severity: 'warn', title: `${s.name} differs from the wiki's copy on this machine`, detail: s.warnings[0], action: { kind: 'inspect', skill: s.name } })
    else if (s.outdated) out.push({ id: `outdated:${s.name}`, severity: 'info', title: `A newer ${s.name} is in its package`, action: { kind: 'ask', prompt: slash('enable', s.name), label: 'Update' } })
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

/**
 * A row's state in a person's words. With #3669's fields the CLI decided; an
 * older CLI's stored `status` is read the old way, where `draft` meant unjudged.
 */
export function pageState(p: PageRow): PageState {
  if ('curate_candidate' in p) {
    if (p.archive || p.status === 'deprecated') return 'archived'
    if (p.draft) return 'draft'
    if (p.status === 'stable') return 'accepted'
    if (p.curate_candidate || (p.change === 'new' && isFeed(p.path))) return 'new'
    return 'none'
  }
  if (p.status === 'deprecated') return 'archived'
  if (p.status === 'stable') return 'accepted'
  if (p.status === 'draft' || (p.change === 'new' && isFeed(p.path))) return 'new'
  return 'none'
}

function pageItem(p: PageRow): PageItem {
  return { path: p.path, state: pageState(p), change: p.change ?? null }
}

function commitOf(c: NonNullable<GitLogAnswer['commits']>[number]): Commit {
  return { sha: c.sha, at: c.at, subject: c.subject, op: c.op ?? 'none', actor: c.actor ?? '', ...(c.files ? { files: c.files } : {}) }
}

/** The stages a machine says it takes: every stage word `ready`, and the plugin engines by name. */
export function rolesOf(capabilities: Record<string, string | Record<string, string>> | undefined): string[] {
  const roles = new Set<string>()
  for (const [unit, value] of Object.entries(capabilities ?? {})) {
    if (typeof value !== 'object') continue
    const ready = Object.entries(value).filter(([, w]) => w === 'ready').map(([stage]) => stage)
    if (!ready.length) continue
    if (unit.startsWith('PLUGIN:')) roles.add(unit.slice('PLUGIN:'.length))
    else for (const stage of ready) roles.add(stage)
  }
  return [...roles].sort()
}

function fleetOf(s: StatusAnswer | null): MachineView[] {
  return (s?.peers ?? []).map((p) => ({ name: p.machine, state: p.state, lastSeen: p.last_seen ?? null, roles: rolesOf(p.capabilities), me: p.machine === s?.machine, ...(p.detail ? { detail: p.detail } : {}) }))
}

function syncOf(s: StatusAnswer | null, files: GitStatusAnswer | null): SyncState | null {
  const g = s?.git
  if (!g) return null
  return { dirty: g.dirty ?? null, untracked: g.untracked ?? null, unpushed: g.unpushed ?? null, behind: g.behind ?? 0, upstream: g.upstream ?? null, files: files?.files ?? null }
}

function recentRun(r: NonNullable<OpSinceAnswer['runs']>[number], jobs: JobRow[]): RecentRun {
  const words = new Set(`${r.op} ${r.summary}`.split(/[\s:,;()]+/))
  const job = jobs.find((j) => words.has(j.slug))
  return { op: r.op, ...(job ? { job: job.slug } : {}), outcome: r.outcome, at: r.when, summary: r.summary === `${r.op} ${r.outcome}` ? '' : r.summary }
}
