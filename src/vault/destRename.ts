// A person renames or moves a job's dest folder in Obsidian: the job's record still names the old one, and the next
// run would make it again beside the moved one (the claim gate skips the job until it is re-pointed). Offer the
// re-point right there, once per job and folder.
import { Notice, TFolder } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { button } from '../ui/dom'
import { renamedDests } from '../wiki/dest'

export class DestRename {
  /** `slug→dest` pairs offered this session: a parent's rename also renames each folder under it. */
  private readonly offered = new Set<string>()

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.app.workspace.onLayoutReady(() => p.registerEvent(p.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFolder) this.renamed(oldPath, file.path)
    })))
  }

  renamed(oldPath: string, newPath: string): void {
    const p = this.plugin
    if (!p.actions) return
    for (const r of renamedDests(oldPath, newPath, p.snapshot?.dests ?? null)) {
      const key = `${r.slug}→${r.dest}`
      if (this.offered.has(key)) continue
      this.offered.add(key)
      const name = p.snapshot?.jobs.find((j) => j.slug === r.slug)?.name ?? r.slug
      let notice: Notice | null = null
      const frag = createFragment((f) => {
        f.createDiv({ text: `${name} lands in ${r.from}, which you moved to ${r.dest}. Re-point the job, so its next run lands there and does not make ${r.from} again?` })
        const bar = f.createDiv({ cls: 'llm-wiki-row-actions' })
        button(bar, 'Re-point', () => {
          notice?.hide()
          void p.repoint(r, false)
        }, { cta: true, title: `llm-wiki-ops jobs edit ${r.slug} dest=${r.dest}` })
        button(bar, 'Not now', () => notice?.hide(), { title: 'The Overview offers it again while the job’s pages sit outside its dest' })
      })
      notice = new Notice(frag, 0)
    }
  }
}
