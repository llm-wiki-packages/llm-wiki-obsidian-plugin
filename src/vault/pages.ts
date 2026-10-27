// What Obsidian already knows about a page, read from its metadata cache, and
// the two boxes a person ticks. The CLI decides a page's state; this supplies
// what a row shows (title, source, when) and writes the boxes the way a person
// would, through Obsidian's own frontmatter API, so the sweep mirrors them.
import { TFile, type App } from 'obsidian'
import { isContent, layout } from '../wiki/layout'

export interface PageFacts {
  path: string
  title: string
  /** The job that captured it, when one did. */
  job: string | null
  /** One line to show under the title: the page's summary or description. */
  blurb: string
  /** The host it came from, for a captured page. */
  host: string | null
  /** Last modified, ms since epoch; 0 when Obsidian does not hold the file. */
  mtime: number
  draft: boolean
  archive: boolean
}

type Fm = Record<string, unknown> | undefined

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** A checkbox set the way #3669 reads it: YAML `true`, or the text `true`. */
export function boxSet(fm: Fm, key: string): boolean {
  const v = fm?.[key]
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true')
}

export function hostOf(resource: unknown): string | null {
  const r = text(resource)
  if (!/^https?:\/\//i.test(r)) return null
  try {
    return new URL(r).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** The file stem, which is what Obsidian shows when there is no title. */
export function stem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

export function factsOf(app: App, path: string): PageFacts {
  const file = app.vault.getAbstractFileByPath(path)
  const fm: Fm = file instanceof TFile ? app.metadataCache.getFileCache(file)?.frontmatter : undefined
  const { draftKey, archiveKey } = layout()
  return {
    path,
    title: text(fm?.title) || stem(path),
    job: text(fm?.job) || null,
    blurb: text(fm?.summary) || text(fm?.description),
    host: hostOf(fm?.resource),
    mtime: file instanceof TFile ? file.stat.mtime : 0,
    draft: boxSet(fm, draftKey),
    archive: boxSet(fm, archiveKey),
  }
}

/** Every content page Obsidian holds with the Draft box ticked, newest edit first. */
export function draftsIn(app: App): PageFacts[] {
  const { draftKey } = layout()
  return app.vault
    .getMarkdownFiles()
    .filter((f) => isContent(f.path) && boxSet(app.metadataCache.getFileCache(f)?.frontmatter, draftKey))
    .map((f) => factsOf(app, f.path))
    .sort((a, b) => b.mtime - a.mtime)
}

/** Tick or untick a box as a person would: one Obsidian save of a key the person owns. */
export async function setBox(app: App, path: string, key: string, on: boolean): Promise<{ ok: boolean; message: string }> {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return { ok: false, message: `${path} is not in the vault` }
  try {
    await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm[key] = on
    })
    return { ok: true, message: `${stem(path)}: ${key} ${on ? 'ticked' : 'unticked'}` }
  } catch (e) {
    return { ok: false, message: `could not change ${key} on ${path}: ${e instanceof Error ? e.message : String(e)}` }
  }
}
