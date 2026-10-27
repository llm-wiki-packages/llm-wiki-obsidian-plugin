// Where things live in a wiki, and the names of the two boxes. The one place
// the plugin spells a tree: every other module asks here. The defaults are the
// seeded layout; `whereami`'s resolved one (llm-wiki-plugins #3675 ask 7)
// replaces them through `layoutFrom` once the wiki is found.

export interface Layout {
  /** Trees whose pages feed the wiki: a person accepts them in. */
  feeds: string[]
  /** Trees of the wiki's own pages, which the agent writes and acknowledges. */
  wiki: string[]
  /** Trees of research notes: drafts by nature, outside acceptance. */
  research: string[]
  /** Machine-local captures; never content. */
  raw: string
  /** Where page templates live; swept, never content. */
  templates: string
  /** Basenames that are structure, never pages. */
  reserved: string[]
  /** The checkbox that holds a page, and the one that takes it out (#3669's SYNC table). */
  draftKey: string
  archiveKey: string
}

export const DEFAULT_LAYOUT: Layout = {
  feeds: ['sources'],
  wiki: ['wiki'],
  research: ['research'],
  raw: '_raw',
  templates: 'templates',
  reserved: ['index.md', 'log.md'],
  draftKey: 'Draft',
  archiveKey: 'Archive',
}

let current: Layout = DEFAULT_LAYOUT

export function layout(): Layout {
  return current
}

export function setLayout(next: Partial<Layout>): void {
  current = { ...DEFAULT_LAYOUT, ...next }
}

/** `whereami`'s `wiki.layout` (`OPS/lib/wiki/layout.py`): each a directory with a trailing slash. */
export interface LayoutAnswer {
  /** Every tree the index reads, the wiki's own pages among them. */
  feeds?: string[]
  pages?: string
  raw?: string
  templates?: string
}

const dir = (d: string) => d.replace(/\/+$/, '')

/** The CLI's layout in the plugin's terms: a feed is a tree a person accepts in, so the wiki's own pages are not one. */
export function layoutFrom(a: LayoutAnswer | null | undefined): Partial<Layout> {
  if (!a) return {}
  const out: Partial<Layout> = {}
  const pages = a.pages ? dir(a.pages) : null
  if (pages) out.wiki = [pages]
  if (a.feeds) out.feeds = a.feeds.map(dir).filter((d) => d && d !== pages)
  if (a.raw) out.raw = dir(a.raw)
  if (a.templates) out.templates = dir(a.templates)
  return out
}

/** A tree contains a path when the path is the tree or sits below it; a tree may be nested (`notes/sources`). */
const under = (path: string, trees: string[]) => trees.some((t) => path === t || path.startsWith(`${t}/`))

export const isFeed = (path: string): boolean => under(path, current.feeds)
export const isWikiPage = (path: string): boolean => under(path, current.wiki)
export const isResearch = (path: string): boolean => under(path, current.research)

/** A markdown page whose state the pipeline tracks: a feed or wiki page, not a reserved file, not inside a dot or version folder. */
export function isLifecycle(path: string): boolean {
  if (!path.endsWith('.md')) return false
  if (!under(path, [...current.feeds, ...current.wiki])) return false
  const parts = path.split('/')
  if (current.reserved.includes(parts.at(-1) ?? '')) return false
  return !parts.some((p) => p.startsWith('.') || p === '_versions')
}

/** A markdown page a person may be writing: lifecycle or research. */
export function isContent(path: string): boolean {
  return isLifecycle(path) || (path.endsWith('.md') && isResearch(path))
}

/** Files the sweep commits: every content tree and the templates. */
export function isSwept(path: string): boolean {
  return under(path, [...current.feeds, ...current.wiki, ...current.research, current.templates])
}

/** Never in the search index whatever the paths say: the wiki's reserved files. */
export function neverIndexed(path: string): boolean {
  return current.wiki.some((w) => current.reserved.some((r) => path === `${w}/${r}`))
}
