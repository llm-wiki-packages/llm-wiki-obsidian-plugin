// A note made in Obsidian starts from the wiki's template for its folder, as a
// page the agent makes with `page create` does. The CLI resolves and expands
// the template (`page template`, a read); Obsidian writes it, so the editor
// buffer stays the only writer and no settle window comes up.
import { Notice, TFile, type TAbstractFile } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { CliError } from '../wiki/cli'
import { isContent, layout } from '../wiki/layout'
import { stem } from './pages'

/** `page template`'s answer (`OPS/commands/page/template.py`). */
export interface TemplateAnswer {
  template?: string | null
  key?: string | null
  /** Keys the page lacks, values expanded; dates as `YYYY-MM-DD`. */
  add?: Record<string, unknown>
  body?: string | null
  unexpanded?: string[]
}

/** A file this new is one Obsidian just made, not one a pull or sync brought in. */
const FRESH_MS = 10_000

/** Obsidian's names for a note nobody has named yet. */
export const UNTITLED = /^Untitled( \d+)?$/

/** What to write: the template's keys, with a placeholder title left empty when the file has no name yet. */
export function fillFor(answer: TemplateAnswer, path: string): { add: Record<string, unknown>; body: string | null; waitsForName: boolean } {
  const add = { ...(answer.add ?? {}) }
  const waitsForName = UNTITLED.test(stem(path)) && add.title === stem(path)
  if (waitsForName) add.title = ''
  return { add, body: answer.body ?? null, waitsForName }
}

export class NewNoteTemplates {
  /** Notes whose title waits for their first real name. */
  private readonly unnamed = new Set<string>()

  constructor(private readonly plugin: LlmWikiPlugin) {}

  register(): void {
    const p = this.plugin
    p.app.workspace.onLayoutReady(() => {
      p.registerEvent(p.app.vault.on('create', (f) => void this.created(f)))
      p.registerEvent(p.app.vault.on('rename', (f, old) => void this.renamed(f, old)))
    })
    p.addCommand({ id: 'apply-template', name: 'Apply the wiki’s template to this page', checkCallback: (checking) => {
      const file = p.app.workspace.getActiveFile()
      if (!file || !isContent(file.path) || !p.cli || !p.wiki) return false
      if (!checking) void this.apply(file, true)
      return true
    } })
  }

  private async created(f: TAbstractFile): Promise<void> {
    if (!this.plugin.settings.applyTemplates || !(f instanceof TFile)) return
    if (!isContent(f.path) || f.path.startsWith(`${layout().templates}/`)) return
    if (Date.now() - f.stat.ctime > FRESH_MS) return
    // Only a blank note: a clip, a copy or a capture arrives with its own content.
    if ((await this.plugin.app.vault.read(f)).trim()) return
    await this.apply(f, false)
  }

  /** Fill the gaps the template names. `announce` says so even when there was nothing to fill. */
  async apply(file: TFile, announce: boolean): Promise<void> {
    const { cli, wiki, app } = this.plugin
    if (!cli || !wiki) return
    let answer: TemplateAnswer
    try {
      answer = await cli.run<TemplateAnswer>('wiki.page.template', { wiki: wiki.key, path: file.path })
    } catch (e) {
      if (announce) new Notice(`No template applied: ${e instanceof CliError ? e.short : String(e)}`, 8000)
      return
    }
    if (!answer.template) {
      if (announce) new Notice('No template is set for this folder.', 4000)
      return
    }
    const { add, body, waitsForName } = fillFor(answer, file.path)
    if (Object.keys(add).length)
      await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(add)) if (!(k in fm)) fm[k] = v
      })
    if (body) await app.vault.process(file, (text) => (/^\s*(---\n[\s\S]*?\n---\s*)?$/.test(text) ? `${text.replace(/\s*$/, '')}\n${body}` : text))
    if (waitsForName) this.unnamed.add(file.path)
    if (announce) new Notice(Object.keys(add).length || body ? `Applied ${answer.template}` : `${answer.template} adds nothing this page lacks`, 4000)
  }

  /** The first real name a new note gets becomes its title. */
  private async renamed(f: TAbstractFile, old: string): Promise<void> {
    if (!this.unnamed.delete(old) || !(f instanceof TFile)) return
    if (UNTITLED.test(stem(f.path))) {
      this.unnamed.add(f.path)
      return
    }
    await this.plugin.app.fileManager.processFrontMatter(f, (fm: Record<string, unknown>) => {
      if (!fm.title) fm.title = stem(f.path)
    })
  }
}
