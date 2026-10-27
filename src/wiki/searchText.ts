// What a search hit says, read against the page it names: the winning passage, whether
// the file still holds it, and the stretch of it worth two lines on screen.
import type { SearchHit } from './cli'
import { neverIndexed } from './layout'

// Enough of the passage to land on one place in a file, short enough to survive the
// whitespace the chunker and the file disagree about. The CLI's own renderer probes the same.
const PROBE_CHARS = 60
// Shorter than this, a passage matches anywhere and proves nothing.
const MIN_PROBE = 12

const CALLOUT_TAG = /^\[!\w[\w-]*\][-+]?\s*/
const STOP = new Set(['the', 'and', 'for', 'are', 'was', 'with', 'what', 'which', 'who', 'how', 'why', 'does', 'did', 'this', 'that', 'from', 'about', 'into', 'there', 'their', 'have', 'has', 'not', 'but', 'you', 'can'])

/** The text of the window that won the hit, or the whole snippet from a backend with no window. */
export function passageOf(hit: SearchHit): string {
  const snippet = hit.snippet ?? ''
  const { passage_start: start, passage_end: end } = hit
  if (Number.isInteger(start) && Number.isInteger(end) && end! > start!) return snippet.slice(start, end)
  return snippet
}

/** A callout's `>` prefixes and tag gone, whitespace folded: the page as a reader sees it. */
export function readable(text: string): string {
  const lines = text.split('\n').map((l) => (l.startsWith('>') ? l.slice(1).replace(/^ /, '') : l))
  return lines.join('\n').trimStart().replace(CALLOUT_TAG, '').replace(/\s+/g, ' ').trim()
}

/** Every line's `>` gone and whitespace folded, so a probe compares words, not layout. */
function folded(text: string): string {
  return text.replace(/^[ \t]*(>[ \t]?)+/gm, '').replace(/\s+/g, ' ')
}

/**
 * Whether the file still says what the index answered with. Null where the passage is too
 * short to tell. A miss is the hit's staleness: the index is older than the file.
 */
export function holdsPassage(fileText: string, passage: string): boolean | null {
  const probe = folded(passage).trim().replace(CALLOUT_TAG, '').slice(0, PROBE_CHARS).trim()
  if (probe.length < MIN_PROBE) return null
  return folded(fileText).includes(probe)
}

/** The 1-based line the passage starts on, where the file still holds it. */
export function lineOf(fileText: string, passage: string): number | null {
  const words = folded(passage).trim().replace(CALLOUT_TAG, '').split(' ').slice(0, 4).filter(Boolean)
  if (!words.length) return null
  const lines = fileText.split('\n')
  const probe = words.join(' ')
  for (let i = 0; i < lines.length; i++) {
    const here = folded(lines[i] ?? '')
    // The probe's words may wrap onto the next lines, but the passage starts on a line that has some.
    if (here.trim() && (here.includes(probe) || folded(lines.slice(i, i + 4).join('\n')).trim().startsWith(probe))) return i + 1
  }
  return null
}

/** The words of a question worth marking: three letters or more, not filler. */
export function queryTerms(q: string): string[] {
  const seen = new Set<string>()
  for (const raw of q.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const w = raw.replace(/^[-_]+|[-_]+$/g, '')
    if (w.length >= 3 && !STOP.has(w)) seen.add(w)
  }
  // Longest first, so `models` marks before `model` claims half of it.
  return [...seen].sort((a, b) => b.length - a.length)
}

export interface Segment {
  text: string
  mark: boolean
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The passage cut to start just before its first marked word, split into marked and plain
 * runs. Two clamped lines show ~200 characters; a match past them would never be seen.
 */
export function excerpt(passage: string, terms: string[], lead = 60): Segment[] {
  let text = readable(passage)
  const re = terms.length ? new RegExp(`(${terms.map(escape).join('|')})`, 'giu') : null
  const first = re ? text.search(re) : -1
  if (first > lead) {
    const from = text.lastIndexOf(' ', first - lead / 2)
    text = `…${text.slice(from > 0 ? from + 1 : first - lead / 2)}`
  }
  if (!re) return text ? [{ text, mark: false }] : []
  const out: Segment[] = []
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), mark: false })
    out.push({ text: m[0], mark: true })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: false })
  return out
}

/** Whether a path is one the index owes: markdown under a `[search] paths` prefix and none of `not_indexed`, per the CLI's corpus walk. */
export function inCorpus(path: string, include: string[], exclude: string[] = []): boolean {
  if (!path.endsWith('.md') || neverIndexed(path)) return false
  if (path.split('/').some((part) => part.startsWith('.') || part === '_versions')) return false
  return include.some((p) => path.startsWith(p)) && !exclude.some((p) => path.startsWith(p))
}

/** The top-level trees the patterns name, for `git changed`. */
export function corpusTrees(include: string[]): string[] {
  return [...new Set(include.map((p) => p.split('/')[0] ?? '').filter((t) => /^[a-z][a-z0-9_-]{0,63}$/.test(t)))]
}
