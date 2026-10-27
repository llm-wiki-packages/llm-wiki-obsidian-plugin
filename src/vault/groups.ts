// How the Changes tab groups what came in: by the job that brought it, by the
// folder it landed in, or not at all. Pure, so the rule is tested apart from
// the view.
import type { PageFacts } from './pages'

export type GroupBy = 'source' | 'folder' | 'none'

export interface PageGroup {
  key: string
  /** The job's name, or the folder. */
  label: string
  /** The folder the group's pages share, when they share one. */
  folder: string | null
  /** Newest first. */
  pages: PageFacts[]
  newest: number
}

export const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/')

/** Newest group first; inside a group, newest page first. */
export function groupPages(pages: PageFacts[], by: GroupBy, jobName: (slug: string) => string | undefined = () => undefined): PageGroup[] {
  if (by === 'none') {
    const all = [...pages].sort((a, b) => b.mtime - a.mtime)
    return all.length ? [{ key: '', label: '', folder: null, pages: all, newest: all[0]?.mtime ?? 0 }] : []
  }
  const groups = new Map<string, PageGroup>()
  for (const p of pages) {
    const folder = folderOf(p.path)
    const key = by === 'source' && p.job ? `job:${p.job}` : `dir:${folder}`
    const label = by === 'source' && p.job ? (jobName(p.job) ?? p.job) : folder
    const g = groups.get(key) ?? { key, label, folder, pages: [], newest: 0 }
    if (g.folder !== folder) g.folder = null
    g.pages.push(p)
    g.newest = Math.max(g.newest, p.mtime)
    groups.set(key, g)
  }
  const out = [...groups.values()]
  for (const g of out) g.pages.sort((a, b) => b.mtime - a.mtime)
  return out.sort((a, b) => b.newest - a.newest || a.label.localeCompare(b.label))
}

/** A group past the threshold shows as one row until it is opened. */
export const collapses = (g: PageGroup, over: number, open: boolean): boolean => !open && over > 0 && g.pages.length > over
