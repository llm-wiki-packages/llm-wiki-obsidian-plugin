// What a page's frontmatter `sources` cites, both ways: a page's sources, and
// the pages citing a source. Pure, so the Sources panel's logic is testable
// without Obsidian.

/** One `sources` entry: the file it names, and where in that file and what words, when given. */
export interface Cite {
  resource: string
  span?: string
  quote?: string
}

/** Every well-formed `sources` entry of a frontmatter, in order; a plain string item counts. */
export function citesOf(frontmatter: unknown): Cite[] {
  if (!frontmatter || typeof frontmatter !== 'object') return []
  const sources = (frontmatter as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return []
  const out: Cite[] = []
  for (const item of sources) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ resource: item.trim() })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const { resource, span, quote } = item as { resource?: unknown; span?: unknown; quote?: unknown }
    if (typeof resource !== 'string' || !resource.trim()) continue
    const cite: Cite = { resource: resource.trim() }
    if (typeof span === 'string' && span.trim()) cite.span = span.trim()
    if (typeof quote === 'string' && quote.trim()) cite.quote = quote.trim()
    out.push(cite)
  }
  return out
}

/** The folder a path sits in under its top one (`sources/slack/…` → `slack`), or empty at the top. */
export function kindOf(path: string): string {
  const parts = path.split('/')
  return parts.length >= 3 ? (parts[1] ?? '') : ''
}

export function kindLabel(kind: string): string {
  if (!kind) return 'Other'
  const words = kind.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A file the panel lists, with the passages cited from or by it. */
export interface Row {
  path: string
  name: string
  exists: boolean
  cites: { span?: string; quote?: string }[]
}

export interface Group {
  label: string
  rows: Row[]
}

/** Rows grouped by kind, groups and rows by name, Other last. */
export function grouped(rows: Row[]): Group[] {
  const by = new Map<string, Row[]>()
  for (const row of rows) {
    const label = kindLabel(kindOf(row.path))
    by.set(label, [...(by.get(label) ?? []), row])
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
    .map(([label, list]) => ({ label, rows: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
}

/** The name a path shows by: its file name without `.md`. */
export function nameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** A page's sources as rows, one per file; entries naming the same file share a row. */
export function sourceRows(cites: Cite[], resolve: (resource: string) => string | null): Row[] {
  const rows = new Map<string, Row>()
  for (const c of cites) {
    const path = resolve(c.resource)
    const key = path ?? c.resource
    const row = rows.get(key) ?? { path: key, name: nameOf(key), exists: path !== null, cites: [] }
    if (c.span || c.quote) row.cites.push({ span: c.span, quote: c.quote })
    rows.set(key, row)
  }
  return [...rows.values()]
}

/** Which pages cite which files: built from every page's frontmatter, read by the file cited. */
export class CiteIndex {
  private by = new Map<string, Map<string, Row>>()

  rebuild(pages: Iterable<{ path: string; title?: unknown; frontmatter: unknown }>, resolve: (resource: string, from: string) => string | null): void {
    this.by = new Map()
    for (const page of pages) {
      for (const c of citesOf(page.frontmatter)) {
        const target = resolve(c.resource, page.path)
        if (!target || target === page.path) continue
        const rows = this.by.get(target) ?? new Map<string, Row>()
        const name = typeof page.title === 'string' && page.title.trim() ? page.title.trim() : nameOf(page.path)
        const row = rows.get(page.path) ?? { path: page.path, name, exists: true, cites: [] }
        if (c.span || c.quote) row.cites.push({ span: c.span, quote: c.quote })
        rows.set(page.path, row)
        this.by.set(target, rows)
      }
    }
  }

  /** The pages citing `target`, one row each. */
  citing(target: string): Row[] {
    return [...(this.by.get(target)?.values() ?? [])]
  }
}

/** Where a passage is in a file's text: the quote's exact range, else the span's heading line. */
export type Spot = { from: number; to: number; line: number } | { line: number }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function locate(text: string, quote?: string, span?: string): Spot | null {
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length - 1
  if (quote) {
    const at = text.indexOf(quote)
    if (at >= 0) return { from: at, to: at + quote.length, line: lineAt(at) }
    // The same words, however the source wraps or spaces them; then just the opening words.
    const words = quote.split(/\s+/).filter(Boolean)
    for (const take of [words.length, Math.min(words.length, 6)]) {
      if (take === 0) break
      const m = new RegExp(words.slice(0, take).map(escape).join('\\s+')).exec(text)
      if (m) return { from: m.index, to: m.index + m[0].length, line: lineAt(m.index) }
    }
  }
  if (span) {
    const lines = text.split('\n')
    const want = span.toLowerCase()
    let i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === want)
    if (i < 0) i = lines.findIndex((l) => l.toLowerCase().includes(want))
    if (i >= 0) return { line: i }
  }
  return null
}

/** Where the panel goes: beside the page, below it, both, or nowhere. */
export type Placement = 'side' | 'bottom' | 'both' | 'off'

export const PLACEMENT_NAMES: Record<Placement, string> = {
  side: 'Beside the page (below it when narrow)',
  bottom: 'Below the page',
  both: 'Beside and below the page',
  off: 'Off',
}

const SIDE_MIN = 200
const SIDE_MAX = 320
const SIDE_GAP = 32

/** The side panel's width for a free right margin, or null when it would not fit. */
export function sideWidth(free: number): number | null {
  const w = Math.min(SIDE_MAX, Math.floor(free - SIDE_GAP))
  return w >= SIDE_MIN ? w : null
}

/** Where each copy of the panel shows, given the setting and the room beside the page. */
export function placeIn(setting: Placement, width: number | null): { side: boolean; bottom: boolean } {
  if (setting === 'off') return { side: false, bottom: false }
  const side = (setting === 'side' || setting === 'both') && width !== null
  const bottom = setting === 'bottom' || setting === 'both' || (setting === 'side' && width === null)
  return { side, bottom }
}
