// What the dashboard shows. Built from CLI answers by snapshot.ts; the views read only this.

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

export type NextKind = 'due' | 'at' | 'running' | 'paused' | 'held' | 'blocked' | 'manual' | 'unknown'

export interface JobView {
  slug: string
  /** The description when there is one, else the slug. */
  name: string
  kind: string
  /** As written: `every 2h`, `daily 06:00`, `manual`. */
  schedule: string
  paused: boolean
  last: { at: string | null; outcome: string | null }
  next: { kind: NextKind; text: string; reason?: string; at?: string | null }
  running: { ticket: string; stage: string; since: string | null } | null
}

export interface CurationItem {
  path: string
  title: string
  /** The job that captured it, when stamped. */
  job?: string
  at?: string | null
}

export interface RecentRun {
  op: string
  outcome: string
  at: string
  summary: string
  session?: string
}

export interface Snapshot {
  takenAt: number
  wikiKey: string
  /** One sentence, one color. */
  health: { tone: 'ok' | 'warn' | 'error'; sentence: string }
  attention: AttentionItem[]
  /** Whether this machine polls the wiki on a schedule; without one, jobs run when a person presses Run. */
  runner: boolean
  jobs: JobView[]
  curation: CurationItem[]
  recent: RecentRun[]
  /** Reads that failed, by verb, so a half-empty dashboard says why. */
  errors: Record<string, string>
}
