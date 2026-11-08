// Where each job's pages sit against its dest, the pages a job's update waits on, and the job pages dispatch leaves
// alone: the one place that knows `jobs check`, `page ls filter=prop:ops.updates_waiting` and `status`'s `held`
// (docs/cli-shapes.md 1.27–1.29).
import type { AttentionItem, DestCheck, DestState, HeldCounts, JobView } from './model'

/** One row of `jobs check --json` (`OPS/commands/jobs/check.py`). */
export interface JobsCheckRow {
  slug: string
  dest?: string | null
  state?: string
  why?: string
  inside?: number
  outside?: number
  folders?: string[]
  next?: string | null
  overlaps?: string[]
}

export interface JobsCheckAnswer {
  jobs?: JobsCheckRow[]
}

const STATES: readonly DestState[] = ['ok', 'fresh', 'renamed', 'scattered', 'moved-out']

export function destChecks(a: JobsCheckAnswer): DestCheck[] {
  return (a.jobs ?? []).filter((r) => typeof r.slug === 'string').map((r) => ({
    slug: r.slug,
    // A dest may be written with a trailing slash; a folder path never has one.
    dest: (r.dest ?? '').replace(/\/+$/, ''),
    state: (STATES as readonly string[]).includes(r.state ?? '') ? (r.state as DestState) : 'ok',
    why: r.why ?? '',
    inside: r.inside ?? 0,
    outside: r.outside ?? 0,
    folders: r.folders ?? [],
    next: r.next ?? null,
    overlaps: r.overlaps ?? [],
  }))
}

/**
 * The folder a click may re-point the job at: only for `renamed`, where every page left the dest for one folder, so
 * the record-only edit moves nothing and leaves nothing behind. A scattered job's pages sit in several folders; the
 * CLI's command for it is shown, and the person picks.
 */
export function repointTo(c: DestCheck): string | null {
  return c.state === 'renamed' && c.folders.length === 1 ? c.folders[0]! : null
}

/** The claim gate skips every stage of a renamed or scattered job: nothing runs until the dest is fixed. */
export function destStuck(c: DestCheck): boolean {
  return c.state === 'renamed' || c.state === 'scattered'
}

/** The Jobs tab's line under a job whose pages are not where its record says; null when they are. */
export function destWords(c: DestCheck): string | null {
  switch (c.state) {
    case 'renamed':
      return `Its folder moved to ${c.folders[0] ?? '?'}; it will not run until it is re-pointed`
    case 'scattered':
      return `Its pages left ${c.dest} for ${c.folders.length} folders; it will not run until it is re-pointed`
    case 'moved-out':
      return `${c.outside} of its pages sit outside ${c.dest}`
    default:
      return null
  }
}

/** Needs-you rows: a job the claim gate skips gets one with the re-point as its button, or the CLI's command. */
export function destAttention(checks: DestCheck[] | null, jobs: JobView[]): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const c of checks ?? []) {
    const name = jobs.find((j) => j.slug === c.slug)?.name ?? c.slug
    const to = repointTo(c)
    if (destStuck(c))
      out.push({
        id: `dest:${c.slug}`,
        severity: 'warn',
        title: to ? `${name}: its folder moved to ${to}` : `${name}: its pages left ${c.dest}`,
        detail: `${c.why}. The job does not run until its dest is re-pointed.`,
        ...(c.next ? { fix: c.next } : {}),
        action: to
          ? { kind: 'repoint', slug: c.slug, from: c.dest, dest: to }
          : { kind: 'ask', prompt: `Job ${c.slug}'s pages left its dest ${c.dest}: ${c.why}. The CLI suggests \`${c.next ?? `llm-wiki-ops jobs check ${c.slug}`}\`. Help me decide where the job should land, then fix it.`, label: 'Ask the agent' },
      })
    else if (c.state === 'moved-out')
      out.push({ id: `dest:${c.slug}`, severity: 'info', title: `${name}: ${c.why}`, action: { kind: 'ask', prompt: `Job ${c.slug}: ${c.why}. Should those pages move back under ${c.dest}, or is that fine?`, label: 'Ask the agent' } })
  }
  return out
}

/** `path` with the folder `oldPath` (or one above it) renamed to `newPath`; null when it is not under `oldPath`. */
function moved(path: string, oldPath: string, newPath: string): string | null {
  if (!path || !oldPath) return null
  if (path === oldPath) return newPath
  return path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : null
}

/**
 * A folder Obsidian renamed or moved, against the jobs: each job whose dest was it or sat under it, and each renamed job
 * whose pages had moved there already (moved twice before a re-point), with the dest it has now.
 */
export function renamedDests(oldPath: string, newPath: string, checks: DestCheck[] | null): { slug: string; from: string; dest: string }[] {
  const out: { slug: string; from: string; dest: string }[] = []
  for (const c of checks ?? []) {
    const dest = moved(c.dest, oldPath, newPath) ?? moved(repointTo(c) ?? '', oldPath, newPath)
    if (dest) out.push({ slug: c.slug, from: c.dest, dest })
  }
  return out
}

/** The job's line from `jobs check`, if it was read. */
export function destOf(checks: DestCheck[] | null, slug: string): DestCheck | undefined {
  return checks?.find((d) => d.slug === slug)
}

/** The pages of one `page ls` answer. */
export function pathsOf(a: { pages?: { path: string; unreadable?: boolean }[] } | null): string[] | null {
  return a === null ? null : (a.pages ?? []).filter((p) => !p.unreadable).map((p) => p.path)
}

/** The statuses a person did not choose, in the order the CLI counts them, each in words. */
const HELD_WORDS: [keyof HeldCounts, string][] = [
  ['conflict', 'in conflict'],
  ['unstamped', 'unstamped'],
  ['edited', 'edited by you'],
  ['settling', 'still being edited'],
]

/** `status`'s `held`, read softly: a number per status, nothing else. */
export function heldCountsOf(v: unknown): HeldCounts | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: HeldCounts = {}
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) if (typeof n === 'number' && n > 0) out[k as keyof HeldCounts] = n
  return out
}

/** One sentence: how many job pages the jobs leave alone and why; null when none is held for a reason a person did not pick. */
export function heldSentence(h: HeldCounts | null): string | null {
  const parts = HELD_WORDS.filter(([k]) => (h?.[k] ?? 0) > 0).map(([k, w]) => `${h![k]} ${w}`)
  if (!parts.length) return null
  const n = HELD_WORDS.reduce((sum, [k]) => sum + (h?.[k] ?? 0), 0)
  return `Jobs leave ${n} of their ${n === 1 ? 'page' : 'pages'} alone: ${parts.join(', ')}`
}

/** The command that stamps unstamped job pages, so the jobs refresh them again. */
export const STAMP_FIX = 'llm-wiki-ops doctor --fix'

/** An info row on the Overview; unstamped pages name the repair, which the agent runs (it asks a confirm question). */
export function heldAttention(h: HeldCounts | null): AttentionItem[] {
  const said = heldSentence(h)
  if (!said) return []
  const unstamped = h?.unstamped ?? 0
  return [{
    id: 'held-pages',
    severity: 'info',
    title: said,
    detail: unstamped ? `Unstamped pages are never refreshed until doctor stamps them.` : 'A job refreshes them again once you are done with them.',
    ...(unstamped ? { fix: STAMP_FIX, action: { kind: 'ask' as const, prompt: `${unstamped} job ${unstamped === 1 ? 'page carries' : 'pages carry'} no rendered stamp, so the jobs leave them alone. Run \`${STAMP_FIX}\` to stamp them, and tell me what it did.`, label: 'Stamp them' } } : {}),
  }]
}
