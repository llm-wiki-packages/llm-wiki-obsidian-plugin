// `page explain`, in words: why a page holds what its bundle roots lend it, and
// what the next write would change. The CLI's JSON is the interface
// (`lib/page/explain.py`); this turns each key into the lines the Why? panel shows.
import { items, rootName, text } from '../vault/lends'

export interface ExplainAnswer {
  path: string
  /** The roots above the page, nearest first, each with the values it lends itself. */
  chain: { root: string; lends: string[]; values: Record<string, unknown> }[]
  keys: Record<string, ExplainKey>
  /** Seconds since the page was saved, inside the settle window; null outside it. */
  settling: number | null
  fill: string | null
  /** `ok`, `none` (no `ops.lent`), or `bad` (it does not read). */
  record: string
}

export interface ExplainKey {
  value: unknown
  own: unknown[]
  lent: { item: unknown; from: string }[]
  /** What a write now would do: a list's added and removed items, or a single key's new value. */
  stale: { value?: unknown; added?: unknown[]; removed?: unknown[]; from?: Record<string, string>; own?: boolean } | null
}

export interface KeyLines {
  key: string
  value: string
  /** Each source of the value: a root's items, or the page's own. */
  from: { what: string; root: string | null }[]
  /** What the next write does to this key, or null for nothing. */
  next: string | null
  /** The next write replaces a value the page set itself. */
  replaces: boolean
}

function list(v: unknown[]): string {
  return v.map(text).join(', ')
}

/** One key of the answer, in words. */
export function keyLines(key: string, k: ExplainKey): KeyLines {
  const from: KeyLines['from'] = []
  const byRoot = new Map<string, unknown[]>()
  for (const l of k.lent) byRoot.set(l.from, [...(byRoot.get(l.from) ?? []), l.item])
  for (const [root, got] of byRoot) from.push({ what: list(got), root: root || null })
  if (k.own.length) from.push({ what: list(k.own), root: null })
  const s = k.stale
  let next: string | null = null
  let replaces = false
  if (s) {
    if (s.added !== undefined && !('value' in s)) {
      const parts = []
      if (s.added.length) parts.push(`puts back ${list(s.added)}`)
      if (s.removed?.length) parts.push(`removes ${list(s.removed)}`)
      next = parts.length ? parts.join('; ') : null
    } else {
      const was = s.removed?.length ? list(s.removed) : null
      replaces = s.own === true && was !== null
      next = s.value === undefined || s.value === null ? `removes ${was ?? 'it'}` : `sets ${text(s.value)}${replaces ? `, replacing ${was}` : ''}`
    }
  }
  return { key, value: items(k.value).length ? list(items(k.value)) : '—', from, next, replaces }
}

/** The whole answer's keys, and the notes under them. */
export function explainLines(a: ExplainAnswer): { keys: KeyLines[]; notes: string[] } {
  const keys = Object.entries(a.keys ?? {}).map(([k, v]) => keyLines(k, v))
  const notes: string[] = []
  if (keys.some((k) => k.next)) notes.push('The next write to this page makes these changes: a job, a CLI command, or the runner.')
  if (a.settling !== null && a.settling !== undefined) notes.push('This page was saved just now. A lend passes it over until it settles, about 10 minutes after the last save.')
  if (a.record === 'bad') notes.push('This page’s record of its lent values (ops.lent) does not read. The next write sorts its values again and removes nothing.')
  const nearest = a.chain?.[0]?.root
  if (nearest) {
    notes.push(`A page can add its own items to a lent list, but it cannot drop a lent item or keep a different single value. To give it a different value, put it in a subfolder whose own root lends that value, or move it out of ${rootName(nearest)}.`)
  }
  return { keys, notes }
}
