// Bundle roots and what they lend, read from the metadata cache alone: no CLI
// call, so a Properties row can say where its value comes from as it draws.
//
// Mirrors the CLI's `lib/page/bundles.py` (ADR-0077). A root is a page with
// `ops.root: true`, the first by path in its folder. Only `sources/` and
// `research/` inherit. A root names the keys it lends in `ops.lends`; each child
// holds the values in its own file and records them in `ops.lent`. A root is
// lent by the roots above it, never by itself. The nearest root wins a single
// value; list values union down the chain.

export type Fm = Record<string, unknown>

export interface PageFm {
  path: string
  fm: Fm | undefined
}

/** The trees whose pages inherit from a bundle root (`bundles.TREES`). */
export const LEND_TREES = ['sources', 'research']

export function inherits(path: string): boolean {
  return LEND_TREES.includes(path.split('/')[0] ?? '')
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** The last part of a folder: what a root is called in a sentence, `course-bio` for `sources/course-bio/README.md`. */
export function rootName(rootPath: string): string {
  const dir = parentOf(rootPath)
  return dir.slice(dir.lastIndexOf('/') + 1) || rootPath
}

function opsOf(fm: Fm | undefined): Fm | undefined {
  const ops = fm?.ops
  return ops && typeof ops === 'object' && !Array.isArray(ops) ? (ops as Fm) : undefined
}

export function isRoot(fm: Fm | undefined): boolean {
  const r = opsOf(fm)?.root
  return r === true || r === 'true'
}

/** The keys a root names in `ops.lends`. */
export function lendsOf(fm: Fm | undefined): string[] {
  const l = opsOf(fm)?.lends
  return Array.isArray(l) ? l.filter((k): k is string => typeof k === 'string') : []
}

/** The page's lent record, `ops.lent`: each key with the value its roots lent it at the last write. */
export function lentOf(fm: Fm | undefined): Fm {
  const l = opsOf(fm)?.lent
  return l && typeof l === 'object' && !Array.isArray(l) ? (l as Fm) : {}
}

/** One value as the CLI compares it (`as_text`): a string as it is, anything else as JSON. */
export function text(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** A list as it stands, a single value as a list of one, nothing as none. */
export function items(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

/**
 * What a root itself lends of `key` (`lentrecord.own`): its value less the items roots above lent to it, so a
 * sub-root never lends an upper root's items as its own. Undefined where it lends nothing of that key.
 */
export function ownPart(key: string, fm: Fm | undefined): unknown {
  if (!fm || !lendsOf(fm).includes(key) || !(key in fm)) return undefined
  const value = fm[key]
  const record = lentOf(fm)
  let own: unknown = value
  if (key in record) {
    const held = new Set(items(record[key]).map(text))
    if (Array.isArray(value)) own = value.filter((v) => !held.has(text(v)))
    else if (held.has(text(value))) own = undefined
  }
  return blank(own) ? undefined : own
}

/** Is this path a page a walk reads: Markdown, not `index.md`, not hidden, not a version copy or an attachment. */
export function isPage(path: string): boolean {
  if (!path.endsWith('.md')) return false
  const parts = path.split('/')
  const name = parts[parts.length - 1]!
  if (name === 'index.md' || name.startsWith('.')) return false
  if (parts.includes('_versions')) return false
  return !(path === 'sources/attachments' || path.startsWith('sources/attachments/'))
}

/** Where a value on a page comes from. */
export interface LentCue {
  /** The nearest root that lends the value (for a list, the first lent item's). */
  from: string
  /** A list key: the items its roots lent, by `text`, each drawn as a lent pill. */
  items: Set<string> | null
}

/** What a root lends of one key. */
export interface LendsCue {
  /** The pages under the root that get this root's value. */
  reach: number
  folder: string
}

export interface RowCue {
  lent?: LentCue
  lends?: LendsCue
}

/** One wiki's roots and pages, built from the metadata cache. Rebuilt when any page's frontmatter changes. */
export class LendIndex {
  private readonly roots = new Map<string, PageFm>()
  private readonly pages: string[] = []
  private readonly fms = new Map<string, Fm | undefined>()

  constructor(files: PageFm[]) {
    for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      if (!inherits(f.path) || !isPage(f.path)) continue
      this.pages.push(f.path)
      this.fms.set(f.path, f.fm)
      const dir = parentOf(f.path)
      if (isRoot(f.fm) && !this.roots.has(dir)) this.roots.set(dir, f)
    }
  }

  fm(path: string): Fm | undefined {
    return this.fms.get(path)
  }

  /** The folder's root: of two (a lint error), the first by path. */
  rootOf(dir: string): PageFm | undefined {
    return this.roots.get(dir)
  }

  isRootPage(path: string): boolean {
    return this.roots.get(parentOf(path))?.path === path
  }

  /** The roots above a page, nearest first. A root is lent by the roots above it, never by itself. */
  chain(path: string): PageFm[] {
    if (!inherits(path)) return []
    const out: PageFm[] = []
    let dir = parentOf(path)
    if (this.isRootPage(path)) dir = parentOf(dir)
    while (dir && inherits(dir + '/')) {
      const r = this.roots.get(dir)
      if (r) out.push(r)
      dir = parentOf(dir)
    }
    return out
  }

  /** The nearest root above `path` that lends `item` of `key` itself, or, with no item, any value of it. */
  lenderOf(path: string, key: string, item?: string): string | undefined {
    for (const r of this.chain(path)) {
      const own = ownPart(key, r.fm)
      if (own === undefined) continue
      if (item === undefined || items(own).some((v) => text(v) === item)) return r.path
    }
    return undefined
  }

  /** The pages under a root, at any depth, the root itself left out. */
  under(rootPath: string): string[] {
    const dir = parentOf(rootPath) + '/'
    return this.pages.filter((p) => p.startsWith(dir) && p !== rootPath)
  }

  /**
   * How many pages get this root's value of `key`. A list reaches every page under it; a single value only the pages
   * whose nearest root lending the key is this one, since a nearer root's value wins.
   */
  reach(rootPath: string, key: string): number {
    const fm = this.roots.get(parentOf(rootPath))?.path === rootPath ? this.fms.get(rootPath) : undefined
    const own = ownPart(key, fm)
    if (own === undefined) return 0
    const pages = this.under(rootPath)
    if (Array.isArray(own)) return pages.length
    return pages.filter((p) => this.lenderOf(p, key) === rootPath).length
  }

  /** Each key's cue on a page: what it lends, if it is a root, and what was lent to it. */
  cues(path: string, fm: Fm | undefined): Map<string, RowCue> {
    const out = new Map<string, RowCue>()
    if (!fm || !inherits(path)) return out
    const cue = (key: string): RowCue => {
      let c = out.get(key)
      if (!c) out.set(key, (c = {}))
      return c
    }
    if (this.isRootPage(path)) {
      const folder = parentOf(path)
      for (const key of lendsOf(fm)) {
        if (ownPart(key, fm) !== undefined) cue(key).lends = { reach: this.reach(path, key), folder }
      }
    }
    const record = lentOf(fm)
    for (const [key, held] of Object.entries(record)) {
      if (!(key in fm)) continue
      const value = fm[key]
      if (Array.isArray(held) || Array.isArray(value)) {
        const lent = new Set(items(held).map(text))
        const shown = items(value).map(text).filter((t) => lent.has(t))
        if (!shown.length) continue
        const from = this.lenderOf(path, key, shown[0]) ?? this.lenderOf(path, key)
        if (from) cue(key).lent = { from, items: new Set(shown) }
      } else if (text(value) === text(held)) {
        // A value the page changed is not lent any more; the drift cue (design §3.2) is a later step.
        const from = this.lenderOf(path, key)
        if (from) cue(key).lent = { from, items: null }
      }
    }
    return out
  }

  /** The line under Properties: what a root lends and to how many pages, or what a page holds and from where. */
  summary(path: string, fm: Fm | undefined): BundleLine | null {
    if (!fm || !inherits(path)) return null
    const cues = this.cues(path, fm)
    const lends = [...cues].filter(([, c]) => c.lends).map(([k]) => k)
    const lent = [...cues].filter(([, c]) => c.lent)
    const roots = [...new Set(lent.map(([, c]) => c.lent!.from))]
    if (!lends.length && !lent.length) return null
    return {
      lends,
      reach: lends.length ? this.under(path).length : 0,
      lent: lent.map(([k]) => k),
      from: roots,
    }
  }
}

export interface BundleLine {
  /** A root: the keys it lends, and the pages under it. */
  lends: string[]
  reach: number
  /** A child (or a sub-root): the keys it holds from its roots, and those roots, nearest first. */
  lent: string[]
  from: string[]
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** A lend row's tooltip on a root. */
export function lendsTitle(c: LendsCue): string {
  return c.reach
    ? `Lent to ${plural(c.reach, 'page')} under ${c.folder}. A change here reaches them.`
    : `Lent to the pages under ${c.folder}; none takes this value now.`
}

/** A lent row's tooltip on a child. */
export function lentTitle(c: LentCue): string {
  return `Comes from ${c.from}. Change it there.`
}

/** The bundle line's words, without its links. */
export function lineText(l: BundleLine): { lends: string | null; lent: string | null } {
  return {
    lends: l.lends.length ? `Lends ${l.lends.join(', ')} to ${plural(l.reach, 'page')}` : null,
    lent: l.lent.length ? `${l.lent.join(', ')} from` : null,
  }
}
