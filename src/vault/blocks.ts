// The blocks other writers keep on a page, read the way the CLI reads them (`OPS/lib/page/blocks.py`): a marker is a
// whole line, `<!-- ops <writer>:<id> [k=v ...] -->` opens and `<!-- /ops <writer>:<id> -->` closes, blocks nest but
// never cross, a marker inside a code fence is an example. A malformed marker stays text: only well-formed blocks are
// returned, as the CLI's `page block list` would list them. Nothing here touches Obsidian; the editor extension does.

const WRITER = '[a-z0-9][a-z0-9._/:-]*'
const ID = '[a-z0-9-]+'
const ADDRESS = `(?<writer>${WRITER}):(?<id>${ID})`
const KEY = '[a-z][a-z0-9_.-]*'
const VALUE = '[A-Za-z0-9._-]+'
const OPEN = new RegExp(`^[ \\t]*<!--[ \\t]+ops[ \\t]+${ADDRESS}(?<attrs>(?:[ \\t]+${KEY}=${VALUE})*)[ \\t]+-->[ \\t]*$`)
const CLOSE = new RegExp(`^[ \\t]*<!--[ \\t]+/ops[ \\t]+${ADDRESS}[ \\t]+-->[ \\t]*$`)
const ATTR = new RegExp(`(${KEY})=(${VALUE})`, 'g')
// The CLI's fence (`OPS/lib/fences.py`): a run of three or more backticks or tildes behind any indent, quote or list
// marker, no backtick in a backtick fence's info, closed by a bare run of its own character at least as long, in the
// same quote state. A fence opened in a quote ends with the quote.
const FENCE_OPEN = /^[ \t]*(>)?[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*((`|~)\3{2,})(.*)$/
const FENCE_CLOSE = /^[ \t>]*((`|~)\2{2,})[ \t]*$/
const QUOTED = /^[ \t]*>/

export interface Block {
  writer: string
  id: string
  /** `<writer>:<id>`, the CLI's address. */
  address: string
  attrs: Record<string, string>
  /** The opening and closing markers' line indexes (0-based) in the text parsed. */
  first: number
  last: number
  parent: string | null
  /** `edits=discard`: fully generated text a person's edit is simply dropped from, so the editor keeps it read-only. */
  discard: boolean
}

/** The lines inside a fenced code block, fences included, by index: markers there are examples, not blocks. */
function fenced(lines: string[], from = 0): Set<number> {
  const inside = new Set<number>()
  let i = from
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i]!.replace(/\r$/, ''))
    if (!open || (open[3] === '`' && open[4]!.includes('`'))) {
      i++
      continue
    }
    const quoted = open[1] !== undefined
    let end = i + 1
    while (end < lines.length) {
      const line = lines[end]!.replace(/\r$/, '')
      if (quoted && !QUOTED.test(line)) break
      end++
      const close = quoted === QUOTED.test(line) ? FENCE_CLOSE.exec(line) : null
      if (close && close[2] === open[3] && close[1]!.length >= open[2]!.length) break
    }
    for (let k = i; k < end; k++) inside.add(k)
    i = end
  }
  return inside
}

/**
 * The index of the line closing a leading `---` block, or -1 where there is none: the CLI's `frontmatter.fence_end`. A
 * first line that trims to `---` (after a byte-order mark) opens it, the next line that trims to `---` closes it, and
 * one that never closes is no block.
 */
export function frontmatterEnd(lines: string[]): number {
  if (!lines.length || lines[0]!.replace(/^\ufeff/, '').trim() !== '---') return -1
  for (let i = 1; i < lines.length; i++) if (lines[i]!.trim() === '---') return i
  return -1
}

/** Every well-formed block in `text`; a block whose markers cross, repeat or never close is left out. */
export function parseBlocks(text: string): Block[] {
  if (!text.includes('<!--')) return []
  const lines = text.split('\n')
  // The CLI reads the body: frontmatter lines are never markers, and never open a fence.
  const skip = frontmatterEnd(lines) + 1
  const inside = fenced(lines, skip)
  for (let k = 0; k < skip; k++) inside.add(k)
  const stack: { writer: string; id: string; attrs: Record<string, string>; first: number }[] = []
  const seen = new Set<string>()
  const bad = new Set<string>()
  const found: Block[] = []
  lines.forEach((raw, i) => {
    if (inside.has(i) || !raw.includes('<!--')) return
    const line = raw.replace(/\r$/, '')
    const open = OPEN.exec(line)
    if (open) {
      const address = `${open.groups!.writer}:${open.groups!.id}`
      if (seen.has(address)) {
        bad.add(address)
        return
      }
      seen.add(address)
      const attrs: Record<string, string> = {}
      for (const m of (open.groups!.attrs ?? '').matchAll(ATTR)) attrs[m[1]!] = m[2]!
      stack.push({ writer: open.groups!.writer!, id: open.groups!.id!, attrs, first: i })
      return
    }
    const close = CLOSE.exec(line)
    if (!close) return
    const address = `${close.groups!.writer}:${close.groups!.id}`
    const at = stack.map((s) => `${s.writer}:${s.id}`).lastIndexOf(address)
    if (at < 0) return // closes what is not open: stays text
    // Anything opened after it and not closed crosses it: it and they are malformed, as the CLI judges.
    const cut = stack.splice(at)
    if (cut.length > 1) for (const crossed of cut) bad.add(`${crossed.writer}:${crossed.id}`)
    const top = cut[0]!
    found.push({ writer: top.writer, id: top.id, address, attrs: top.attrs, first: top.first, last: i, parent: null, discard: top.attrs.edits === 'discard' })
  })
  for (const open of stack) bad.add(`${open.writer}:${open.id}`)
  const kept = found.filter((b) => !bad.has(b.address)).sort((a, b) => a.first - b.first)
  // A block's parent is the nearest kept block around it.
  return kept.map((b) => ({ ...b, parent: [...kept].reverse().find((o) => o.first < b.first && b.last < o.last)?.address ?? null }))
}

/**
 * The block's own text, as the CLI files it when it sets a person's edit aside (`blocks.own_text`): the lines between
 * its markers with its children cut out (one blank line dropped where a cut leaves two), CRLF folded, blank lines at
 * the edges and trailing space dropped.
 */
export function blockText(text: string, b: Pick<Block, 'first' | 'last' | 'address'>, blocks: Block[] = parseBlocks(text)): string {
  const lines = text.split('\n')
  const inner = lines.slice(b.first + 1, b.last)
  const base = b.first + 1
  const kids = blocks.filter((k) => k.parent === b.address).map((k) => [k.first - base, k.last - base] as const).sort((x, y) => x[0] - y[0])
  const out: string[] = []
  let cursor = 0
  for (const [first, last] of kids) {
    out.push(...inner.slice(cursor, first))
    cursor = last + 1
    if (cursor < inner.length && !inner[cursor]!.trim() && (!out.length || !out.at(-1)!.trim())) cursor++
  }
  out.push(...inner.slice(cursor))
  return normalize(out.join('\n'))
}

/** A block's text as its hash reads it (`blocks.normalize`). */
export function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/\s+$/, '')
}

/** One `ops.set_aside` entry: a person's text a writer replaced, filed under `_versions/` (`OPS/lib/jobs/refresh.py`). */
export interface SetAside {
  path: string
  at: string | null
  /** The block's address (`<writer>:<id>`), or the page's own path when the whole page was set aside. */
  from: string
}

/** The entries a page's frontmatter lists, read softly: a nested `ops` object (page shape 3) or a dotted key. */
export function setAsideOf(fm: Record<string, unknown> | null | undefined): SetAside[] {
  const ops = fm?.ops
  const raw = (ops && typeof ops === 'object' && !Array.isArray(ops) ? (ops as Record<string, unknown>).set_aside : undefined) ?? fm?.['ops.set_aside']
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e): SetAside[] => {
    if (!e || typeof e !== 'object') return []
    const o = e as Record<string, unknown>
    if (typeof o.path !== 'string' || typeof o.from !== 'string') return []
    return [{ path: o.path, from: o.from, at: typeof o.at === 'string' ? o.at : o.at instanceof Date ? o.at.toISOString() : null }]
  })
}

/** The latest entry for each block on the page: the CLI appends (`refresh.with_entry`), so the last listed is the newest. */
export function setAsideByBlock(entries: SetAside[], blocks: Block[]): Map<string, SetAside> {
  const out = new Map<string, SetAside>()
  const addresses = new Set(blocks.map((b) => b.address))
  for (const e of entries) if (addresses.has(e.from)) out.set(e.from, e)
  return out
}

/** A `_versions/` copy is a page: its text is what follows the frontmatter. */
export function bodyOf(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

/**
 * The innermost block a line sits in, markers included; null outside every block. An edit inside a child is the
 * child's: the child is what its writer rewrites.
 */
export function blockAtLine(blocks: Block[], line: number): Block | null {
  let best: Block | null = null
  for (const b of blocks) if (line >= b.first && line <= b.last && (!best || b.first >= best.first)) best = b
  return best
}

/** The blocks a change from line `a` to line `b` (inclusive) touches, outermost included. */
export function blocksTouched(blocks: Block[], a: number, b: number): Block[] {
  return blocks.filter((x) => a <= x.last && b >= x.first)
}

export type DiffLine = { kind: 'same' | 'mine' | 'theirs'; text: string }

/** A line diff of the person's text against the writer's, by longest common subsequence: blocks are short. */
export function lineDiff(mine: string, theirs: string): DiffLine[] {
  const a = mine.replace(/\n+$/, '').split('\n')
  const b = theirs.replace(/\n+$/, '').split('\n')
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: 'mine', text: a[i++]! })
    else out.push({ kind: 'theirs', text: b[j++]! })
  }
  while (i < n) out.push({ kind: 'mine', text: a[i++]! })
  while (j < m) out.push({ kind: 'theirs', text: b[j++]! })
  return out
}
