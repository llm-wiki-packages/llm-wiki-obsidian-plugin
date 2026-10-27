// "Make a copy" (or a duplicate made any other way in the vault) copies the
// page's `document_id` too, and two pages with one id are one document to the
// index, the jobs and every citation. When a fresh file turns out to share its
// id with a committed page, the copy gets its own: `page fix --force`
// (llm-wiki-plugins #3675 ask 1), the one write the CLI asks a person to stand
// behind, which watching the copy appear is.
import { Notice, TFile, type TAbstractFile } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { isContent } from '../wiki/layout'

/** A file this new is one the vault just made, not one a pull brought in. */
const FRESH_MS = 10_000

const ID_LINE = /^document_id:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*$/m

/** The `document_id` in a page's frontmatter, read off the text: the metadata cache may not have the new file yet. */
export function documentIdOf(text: string): string | null {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  return fm ? (ID_LINE.exec(fm[1]!)?.[1] ?? null) : null
}

/** `page ls id=`'s rows: `duplicate_of` names the other pages carrying the id. */
export interface CarrierRow {
  path: string
  duplicate_of?: string[] | null
}

/** `git status`'s rows; `status` is `added`, `modified`, `deleted` or `untracked`. */
export interface StatusFile {
  path: string
  status: string
}

const uncommitted = (path: string, files: StatusFile[]) => files.some((f) => f.path === path && (f.status === 'untracked' || f.status === 'added'))

/** A copy: never in history, sharing its id with a page that is. Two new files sharing one are left to lint. */
export function isFreshCopy(path: string, carriers: CarrierRow[], files: StatusFile[]): boolean {
  const others = carriers.find((r) => r.path === path)?.duplicate_of ?? []
  return others.length > 0 && uncommitted(path, files) && others.some((o) => !uncommitted(o, files))
}

export class CopyWatch {
  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.app.workspace.onLayoutReady(() => p.registerEvent(p.app.vault.on('create', (f) => void this.created(f))))
  }

  private async created(f: TAbstractFile): Promise<void> {
    const { cli, wiki, actions, app } = this.plugin
    if (!cli || !wiki || !actions || !(f instanceof TFile) || !isContent(f.path)) return
    if (Date.now() - f.stat.ctime > FRESH_MS) return
    const id = documentIdOf(await app.vault.read(f))
    if (!id) return
    try {
      const [found, status] = await Promise.all([
        cli.run<{ pages?: CarrierRow[] }>('wiki.page.find', { wiki: wiki.key, id }),
        cli.run<{ files?: StatusFile[] }>('wiki.git.status', { wiki: wiki.key }),
      ])
      if (!isFreshCopy(f.path, found.pages ?? [], status.files ?? [])) return
    } catch {
      // A CLI without `page ls id=` or `git status`: the doctor names the duplicate instead.
      return
    }
    const out = await actions.fixCopy(f.path)
    if (!out.ok || out.reminted) new Notice(out.message, out.ok ? 5000 : 8000)
  }
}
