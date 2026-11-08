// What the dashboard shows. Built from CLI answers by snapshot.ts; the views
// read only this, and format every time at render.
import type { SkillEntry } from '../chat/skills'

export type Severity = 'error' | 'warn' | 'info'

/** What a row's one button does. The dashboard makes exactly these writes, plus a hand-off to chat. */
export type Action =
  | { kind: 'ask'; prompt: string; label?: string }
  | { kind: 'open'; path: string }
  /** Put a parked ticket back; with the slug, run the pass too where no runner would. */
  | { kind: 'retry'; ticket: string; slug?: string }
  | { kind: 'reindex' }
  /** Open the credential dialog: for an empty slot (bind on save), or to replace `name`; `retry` is a parked ticket to retry after. */
  | { kind: 'credential'; skill: string; slot: string; name?: string; retry?: string; job?: string }
  | { kind: 'inspect'; skill: string }
  /** Open a dashboard tab: the Overview's way into the inbox. */
  | { kind: 'goto'; tab: 'inbox'; label?: string }
  /** Re-point a job's dest at the folder its pages now sit under (`jobs edit <slug> dest=<dest>`), asked first. */
  | { kind: 'repoint'; slug: string; from: string; dest: string }

export interface AttentionItem {
  id: string
  severity: Severity
  title: string
  detail?: string
  /** The command that fixes it, when the CLI named one; shown, never run. */
  fix?: string
  action?: Action
}

/** What a job is waiting on, as the ticket store and the due verdict say it. */
export type NextKind = 'due' | 'queued' | 'at' | 'running' | 'paused' | 'held' | 'blocked' | 'unbound' | 'manual' | 'unknown'

export interface JobView {
  slug: string
  /** The description when there is one, else the slug. */
  name: string
  kind: string
  /** The skill unit that runs its harvest, when it is a pipeline job. */
  skill: string | null
  /** As written: `every 2h`, `once`, `manual`. */
  schedule: string
  paused: boolean
  last: { at: string | null; outcome: string | null }
  next: {
    kind: NextKind
    /** When: the next run for `at`, the release for `held`. */
    at?: string | null
    /** The CLI's own sentence for `blocked`; the verdict's reasons otherwise. */
    detail?: string
  }
  running: { ticket: string; stage: string; since: string | null } | null
  /** The credential problem keeping it from running here: an empty slot, or a bound credential that is stale, missing or failed. */
  credential: { slot: string; name: string | null; problem: string } | null
  /** The verdict's own reasons, for the detail view. */
  reasons: string[]
  /** Its tickets, newest first: what ran, what failed and why. */
  tickets: TicketView[]
}

export interface TicketView {
  id: string
  stage: string
  state: 'pending' | 'active' | 'done' | 'failed' | 'orphan'
  at: string | null
  reason: string | null
  runtimeS: number | null
}

/** One credential slot a skill declares (`file`, `dir`) or its sandbox routes, and what fills it on this machine. */
export interface SlotView {
  name: string
  required: boolean
  /** The credential bound here, or null when the slot is empty. */
  credential: string | null
  /** The binding's state when one exists and is not simply `bound`: `stale`, `payload missing`… */
  problem?: string
}

export type SkillState = 'enabled' | 'installed' | 'available'

/** A skill unit as the wiki holds it, as this machine loads it, or as the package offers it. */
export interface SkillView {
  name: string
  state: SkillState
  /** The manifest's description from `skills ls`; from an older CLI, the first sentence of its SKILL.md's, when readable. */
  description: string
  /** `pipeline` (a job can name it), `session` (a person runs it), or both; null on a copy the author has not filled; absent from an older CLI. */
  mode?: string[] | null
  /** What to type after `/<name>`, from the manifest; null when it says none. */
  argumentHint: string | null
  /** The stages it declares (`harvest`, `process`…); a unit with one is what a job can run. */
  stages: string[]
  venue: string | null
  version: string | null
  /** The package and version it came from. */
  from: string | null
  /** The usage line once enabled (`/channel-gmail ticket=<id>`); the CLI's next step otherwise. */
  usage: string | null
  /** Enabled copy differs from the wiki's. */
  drifted: boolean
  /** A newer version is in the declared package. */
  outdated: boolean
  warnings: string[]
  slots: SlotView[]
  /** The slugs of the jobs whose harvest this unit runs. */
  jobs: string[]
  /** What a job add must answer, from the manifest. */
  inputs: { name: string; prompt: string; required: boolean }[]
  /** Reference notes the unit ships, by role, as paths under its directory. */
  notes: { skill: string; enable?: string; usage?: string }
  /** Where the unit's files are: under the wiki for a held unit, in the package cache for an available one; null when unknown. */
  dir: string | null
}

/** A skill a job can name: a unit with a stage, or one of the `brain` plugin's routines. */
export interface PipelineView {
  /** As `skills ls` names it: `channel-gmail`, or `PLUGIN:curate` for a plugin routine. */
  name: string
  plugin: boolean
  description: string
  stages: string[]
  /** Whether it runs on this machine: a unit enabled here, a routine whose sandbox is accepted (or that ships none). */
  ready: boolean
  /** A routine the operator accepted whose reach has grown since, so it waits on a fresh yes. */
  stale: boolean
  /** The CLI's next step when it is not ready; shown, never run. */
  next: string | null
  /** The slugs of the jobs naming it as their skill. */
  jobs: string[]
}

export interface CredentialView {
  name: string
  /** `value`, `dir`, or `harness`. */
  kind: string
  /** `none`, `unverified`, `verified`, `ok`, `failed`. */
  state: string
  verified: string | null
  /** Who uses it, with the binding's state when it is not simply `bound`. */
  uses: { skill?: string; job?: string; slot: string; problem?: string }[]
}

/** Where a page stands in the wiki, in a person's words (#3669's three facts). */
export type PageState = 'new' | 'draft' | 'accepted' | 'archived' | 'none'

/** One lifecycle page as `page ls` reports it. Title, job and times are Obsidian's to read at render. */
export interface PageItem {
  path: string
  state: PageState
  /** Moved since the pipeline last folded it in (`change`), when the CLI says. */
  change: 'new' | 'edited' | 'current' | null
}

/** One machine joined to the wiki, as `status --peers` reads it from here. */
export interface MachineView {
  name: string
  /** `healthy`, `quiet`, `stuck`, `no-cadence`, `unreadable`. */
  state: string
  lastSeen: string | null
  /** The stages it runs, from its capabilities map: `harvest`, `index`… */
  roles: string[]
  me: boolean
  detail?: string
}

/** How this clone stands against its remote. Null counts are unknown, not zero. */
export interface SyncState {
  dirty: number | null
  untracked: number | null
  unpushed: number | null
  behind: number
  upstream: string | null
  /** Each uncommitted path under the swept trees, from `git status`; null on a CLI without it. */
  files: UnsavedFile[] | null
}

/** One uncommitted path, `git status`'s row. */
export interface UnsavedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'untracked'
}

/** One path a commit touched: added, modified, deleted (and `R`, `C`, `T` as git spells them). */
export interface CommitFile {
  path: string
  status: string
}

/** One commit, read off its trailers. */
export interface Commit {
  sha: string
  at: string
  subject: string
  op: string
  /** `user@<machine>`, `agent@<machine>`, or a producer. */
  actor: string
  /** What it touched, when the CLI lists files (`git log`, llm-wiki-plugins #3675 ask 6). */
  files?: CommitFile[]
  /** `page history`: the page's path and `document_revision` at this commit. */
  path?: string
  revision?: number | null
}

/** One message in an inbox, as `inboxes ls <inbox> --all` lists it. */
export interface InboxMessage {
  inbox: string
  id: string
  /** The message's file, as the CLI names it: its stem follows the subject, so it is never built from the id but on an older CLI. */
  path: string
  /** A job ask: filed from a landing ticket (`from.ticket`) with no `reply_to`; Done leaves it for the job's next run. */
  jobAsk: boolean
  /** The asking job's slug, when the CLI names it (the ask loop, llm-wiki-plugins #3929). */
  job: string | null
  subject: string
  at: string | null
  /** This machine has read it: the CLI's `state` reads `seen <when>` rather than `new`. */
  seen: boolean
  /** Ticked `done`, waiting for `inboxes sweep` to close it out. */
  done: boolean
  /** The inbox the sweep forwards the answered message to; null means Done simply removes it. */
  replyTo: string | null
  /** The message this one answers, when it is a forwarded reply. */
  inReplyTo: string | null
  readable: boolean
}

/** The held `sources/` pages under one bundle root, or the ones no root holds (`root` null). */
export interface HeldGroup {
  root: string | null
  /** Each held page; `waiting` when `whereami` counts it (an open record waits on a person), never on an older CLI. */
  pages: { path: string; waiting: boolean }[]
}

/** `whereami`'s `needs_you_parts`: exactly what its count counts, besides the blocked jobs it lists apart. */
export interface NeedsYouParts {
  held: { path: string; id: string }[]
  curate: { reason: string; directory: string }[]
  conflicts: { id: string; subject: string }[]
  /** Pages whose refresh a landing could not merge with a person's edits (`page-conflicts`, llm-wiki-plugins #4098); absent before 0.15. */
  page_conflicts?: { id: string; page: string }[]
}

/** Where a job's pages sit against its dest, as `jobs check` judges it (`OPS/lib/jobs/destcheck.py`). */
export type DestState = 'ok' | 'fresh' | 'renamed' | 'scattered' | 'moved-out'

export interface DestCheck {
  slug: string
  dest: string
  state: DestState
  /** The CLI's own sentence for the state. */
  why: string
  inside: number
  outside: number
  /** The folders its outside pages sit in; for `renamed`, the one folder they all share. */
  folders: string[]
  /** The exact command that fixes it, as the CLI prints it; null when nothing needs fixing. */
  next: string | null
  /** The other jobs whose dest overlaps this one's, in the CLI's words. */
  overlaps: string[]
}

/** The job pages dispatch leaves alone, per status, as `status` counts them (`held`); the boxes and `off` are a person's choice. */
export type HeldCounts = Partial<Record<'edited' | 'settling' | 'unstamped' | 'conflict' | 'draft' | 'deprecated' | 'off', number>>

/** A job this machine blocked, as `whereami` lists it: why, and the one command that clears it. */
export interface BlockedJob {
  job: string
  reason: string
  next: string
}

export interface RecentRun {
  op: string
  /** The job the run was about, when the summary names one. */
  job?: string
  outcome: string
  at: string
  summary: string
}

export interface Snapshot {
  takenAt: number
  wikiKey: string
  /** The verdict: how many things need a person, and how loud. */
  health: { tone: 'ok' | 'warn' | 'error'; count: number }
  attention: AttentionItem[]
  /** Whether this machine polls the wiki on a schedule; without one, jobs run when a person presses Run. */
  runner: boolean
  jobs: JobView[]
  skills: SkillView[]
  /** What a job can run, from each row's mode; from an older CLI, the units with a stage and no plugin routines. */
  pipeline: PipelineView[]
  /** The chat `/` list, from the same `skills ls` read; null from an older CLI, whose rows say no mode, or when the read failed. */
  palette: SkillEntry[] | null
  credentials: CredentialView[]
  /** Every lifecycle page; null when the page list could not be read. */
  pages: PageItem[] | null
  /** Whether the CLI reports #3669's boxes; an older one reads drafts off Obsidian alone. */
  boxes: boolean
  recent: RecentRun[]
  /** The last week's commits, newest first. */
  activity: Commit[]
  /** This machine's name, and every machine joined to the wiki. */
  machine: string | null
  fleet: MachineView[]
  sync: SyncState | null
  /** How the search index stands; null when it could not be read. */
  search: SearchStatus | null
  /** The `user` inbox: what a skill or an agent asked a person, oldest first; null when it could not be read. */
  inbox: InboxMessage[] | null
  /**
   * `whereami`'s `needs_you`: held sources with an open record, the groups curate leaves to a person, and open
   * conflicts, all answered with `/ingest`. Null when the CLI could not count, or predates the count.
   */
  needsYou: number | null
  /** What the count is made of, listed; null from a CLI before the breakdown (llm-wiki-plugins #3940). */
  parts: NeedsYouParts | null
  /** The jobs this machine blocked, counted in `needsYou`; empty from a CLI that does not list them. */
  blocked: BlockedJob[]
  /** Every held source by bundle root, the ones the count waits on marked; read on a full pass, or while the count is above zero. */
  held: HeldGroup[] | null
  /** The open `conflicts` records; read only while the count is above zero. */
  conflicts: InboxMessage[] | null
  /** Each job's pages against its dest, from `jobs check`; null when it could not be read, or from a CLI without it. */
  dests: DestCheck[] | null
  /** Pages carrying `ops.updates_waiting`: a job's update waits in `_versions/` for `page resolve`; null when unread. */
  updatesWaiting: string[] | null
  /** `status`'s `held`: the job pages dispatch leaves alone, per status; null from a CLI without it. */
  heldPages: HeldCounts | null
  /** Whether this CLI closes one message with `inboxes done`; an older one is closed by a tick and a sweep. */
  inboxDone: boolean
  /** Reads that failed, by verb, so a half-empty dashboard says why. */
  errors: Record<string, string>
}

/** What `search status --json` answers (`OPS/search/status.py`). */
export interface SearchStatus {
  engine_configured?: boolean
  realm_ready?: boolean
  realm_reason?: string
  serving?: string | null
  collection?: string | null
  /** The commit the engine's index was last built at. */
  index_as_of?: { source_commit?: string } | null
  /** Files the index owes; `dirty` of them it does not hold at their current bytes, null on a grep-only wiki. */
  corpus_files?: number
  dirty?: number | null
  /** The `dirty` files themselves, the ones a pass would offer. No key at all from an older CLI. */
  dirty_paths?: string[] | null
  /** False: the index names no commit this clone has, so every file is a candidate. */
  marker_known?: boolean | null
  /** `[search] paths` moved since the last full reindex: pages may sit in the index that no longer belong. */
  reindex_required?: boolean
  paths?: { pattern: string; origin?: string }[]
  not_indexed?: { pattern: string; origin?: string }[]
  /** The chain, in order, and whether each can answer on this machine. */
  backends?: { name: string; configured?: boolean; available?: boolean; reason?: string }[]
  /** `[search.properties]`: frontmatter the engine stores, typed with Obsidian's names. */
  properties?: { key: string; type: string; match?: string }[]
  _cmd_?: { head?: string | null }
}
