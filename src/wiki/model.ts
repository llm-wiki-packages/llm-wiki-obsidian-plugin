// What the dashboard shows. Built from CLI answers by snapshot.ts; the views
// read only this, and format every time at render.

export type Severity = 'error' | 'warn' | 'info'

/** What a row's one button does. The dashboard makes exactly these writes, plus a hand-off to chat. */
export type Action =
  | { kind: 'ask'; prompt: string; label?: string }
  | { kind: 'open'; path: string }
  | { kind: 'retry'; ticket: string }
  | { kind: 'reindex' }
  /** Open the credential modal for one empty slot; the skill and its jobs are bound on save. */
  | { kind: 'credential'; skill: string; slot: string }
  | { kind: 'inspect'; skill: string }

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
  /** Where the unit's files are, relative to the wiki root; null for an available unit. */
  dir: string | null
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

export interface CurationItem {
  path: string
  title: string
  /** The folder under sources/ it landed in, a stand-in for the job that captured it. */
  job?: string
}

export interface RecentRun {
  op: string
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
  credentials: CredentialView[]
  curation: CurationItem[]
  /** Files under sources/ the wiki has not taken up; null when this CLI cannot tell. */
  unadopted: CurationItem[] | null
  recent: RecentRun[]
  /** Reads that failed, by verb, so a half-empty dashboard says why. */
  errors: Record<string, string>
}
