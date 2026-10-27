// Who made a commit, in a person's words, from its trailers: `Actor:
// user@<machine>` is a hand edit the sweep carried, `agent@<machine>` a
// session, and `Op:` names the job or skill that ran.
import type { Commit } from './model'

export type WhoKind = 'you' | 'agent' | 'job'

export interface Who {
  kind: WhoKind
  /** `You`, `You · mac-mini`, `Dream`, `Joe's mailbox`. */
  label: string
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `jobName` turns a job slug into its name when the op is one. */
export function whoOf(c: Pick<Commit, 'op' | 'actor'>, machine: string | null, jobName: (slug: string) => string | undefined = () => undefined): Who {
  const [role, where] = c.actor.split('@')
  const elsewhere = where && machine && where !== machine ? ` · ${where}` : ''
  if (c.op && c.op !== 'none') {
    const job = jobName(c.op)
    if (job) return { kind: 'job', label: job }
    if (c.op === 'pass') return { kind: 'job', label: `Scheduled pass${elsewhere}` }
    return { kind: 'agent', label: `${capital(c.op)}${elsewhere}` }
  }
  if (role === 'agent') return { kind: 'agent', label: `Agent${elsewhere}` }
  return { kind: 'you', label: `You${elsewhere}` }
}

/** The calendar day a timestamp falls on, in local time: `Today`, `Yesterday`, or the date. */
export function dayOf(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const start = (t: number) => new Date(new Date(t).toDateString()).getTime()
  const days = Math.round((start(now) - start(d.getTime())) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}
