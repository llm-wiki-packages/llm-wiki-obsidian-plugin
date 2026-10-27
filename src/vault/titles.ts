// One title per page. Obsidian shows the filename as the inline title, and the
// wiki reads `title:`; renaming a page in Obsidian sets `title:` to the new
// name so the two never disagree. Safe now that a page's identity is its
// `document_id`, not its filename (llm-wiki-plugins #3675 asks 1–2): a job's
// re-pull finds a renamed page by id rather than writing a second one.
import { TFile, type TAbstractFile } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { isContent } from '../wiki/layout'
import { stem } from './pages'
import { UNTITLED } from './templates'

/** The title a rename should leave, or null when it should leave the page alone. */
export function titleAfterRename(oldPath: string, newPath: string, title: unknown): string | null {
  const name = stem(newPath)
  // A move keeps the name; a first name for an untitled note is the template's business.
  if (stem(oldPath) === name || UNTITLED.test(stem(oldPath)) || UNTITLED.test(name)) return null
  // Only a page that has a title: one that never set it already reads its name.
  if (typeof title !== 'string' || title === name) return null
  return name
}

export class TitleFollowsName {
  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.app.workspace.onLayoutReady(() => p.registerEvent(p.app.vault.on('rename', (f, old) => void this.renamed(f, old))))
  }

  private async renamed(f: TAbstractFile, old: string): Promise<void> {
    if (!(f instanceof TFile) || !isContent(f.path)) return
    const title = this.plugin.app.metadataCache.getFileCache(f)?.frontmatter?.title as unknown
    const next = titleAfterRename(old, f.path, title)
    if (next === null) return
    await this.plugin.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      if (typeof fm.title === 'string') fm.title = next
    })
  }
}
