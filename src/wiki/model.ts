// What the dashboard shows. Built from CLI answers by snapshot.ts; the views
// read only this, and format every time at render.

export type Severity = 'error' | 'warn' | 'info'

/** What a row's one button does. The dashboard makes exactly these writes, plus a hand-off to chat. */
export type Action =
  | { kind: 'ask'; prompt: string; label?: string }
  | { kind: 'open'; path: string }
  | { kind: 'retry'; ticket: string }
  | { kind: 'reindex' }

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
export type NextKind = 'due' | 'queued' | 'at' | 'running' | 'paused' | 'held' | 'blocked' | 'manual' | 'unknown'

export interface JobView {
  slug: string
  /** The description when there is one, else the slug. */
  name: string
  kind: string
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
  curation: CurationItem[]
  /** Files under sources/ the wiki has not taken up; null when this CLI cannot tell. */
  unadopted: CurationItem[] | null
  recent: RecentRun[]
  /** Reads that failed, by verb, so a half-empty dashboard says why. */
  errors: Record<string, string>
}
