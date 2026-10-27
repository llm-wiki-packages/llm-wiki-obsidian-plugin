// `page diff`'s answer (`OPS/commands/page/diff.py`, llm-wiki-plugins #3675
// ask 5) and the words a person reads it in. The CLI does the comparing:
// frontmatter as typed key changes, the body as numbered hunks.

/** One end of the comparison. `at` is `saved`, `working`, or the version asked for. */
export interface DiffVersion {
  at: string
  sha: string | null
  path: string
  revision: number | null
  /** False where the page did not exist: before it was made, after it was deleted. */
  exists: boolean
  /** `ok`, or why the frontmatter could not be read (then it is compared as body text). */
  frontmatter: string
}

export interface FrontmatterChange {
  key: string
  change: 'added' | 'removed' | 'changed'
  old: unknown
  new: unknown
}

export interface DiffLine {
  kind: 'context' | 'removed' | 'added'
  old: number | null
  new: number | null
  text: string
}

export interface DiffHunk {
  old_start: number
  old_count: number
  new_start: number
  new_count: number
  lines: DiffLine[]
}

export interface DiffAnswer {
  path: string
  old: DiffVersion
  new: DiffVersion
  frontmatter: FrontmatterChange[]
  hunks: DiffHunk[]
  identical: boolean
}

/** A frontmatter value on one line: a list joined, a missing one a dash, a nested one as JSON. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length ? v.map(valueText).join(', ') : '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** What happened to the page as a whole, when it was more than an edit. */
export function pageEvent(d: Pick<DiffAnswer, 'old' | 'new'>): string | null {
  if (!d.old.exists && d.new.exists) return d.new.at === 'working' ? 'A new page, not saved to history yet' : 'The page begins here'
  if (d.old.exists && !d.new.exists) return 'The page was deleted'
  if (d.old.path !== d.new.path) return `Renamed from ${d.old.path}`
  return null
}

/** Counted for the header: `3 properties · +12 −4 lines`. */
export function diffSummary(d: Pick<DiffAnswer, 'frontmatter' | 'hunks' | 'identical'>): string {
  if (d.identical) return 'No changes'
  let added = 0
  let removed = 0
  for (const h of d.hunks) for (const l of h.lines) {
    if (l.kind === 'added') added++
    else if (l.kind === 'removed') removed++
  }
  const parts: string[] = []
  if (d.frontmatter.length) parts.push(`${d.frontmatter.length} ${d.frontmatter.length === 1 ? 'property' : 'properties'}`)
  if (added || removed) parts.push(`+${added} −${removed} lines`)
  return parts.join(' · ') || 'No changes'
}

/** `git log`'s A/M/D letter, as a word. */
export function fileChange(status: string): string {
  switch (status[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    default:
      return 'edited'
  }
}
