import { button, empty, section } from '../../ui/dom'
import { promptText } from '../../ui/modals'
import type { CurationItem } from '../../wiki/model'
import type { TabContext } from './index'

/** Pages waiting on a judgment, grouped by where they landed. Open the note beside this view, then Accept or Reject here. */
export function renderPages(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const actions = ctx.plugin.actions
  const body = section(root, 'Awaiting curation', {
    count: snapshot.curation.length,
    actions: (bar) => {
      if (snapshot.curation.length)
        button(bar, 'Ask the agent to curate', () => ctx.act({ kind: 'ask', prompt: `/llm-wiki:curate ${snapshot.curation.slice(0, 20).map((c) => c.path).join(' ')}` }), { icon: 'message-square' })
    },
  })
  if (!snapshot.curation.length) empty(body, 'No pages are waiting for curation.', 'Captured pages land here as drafts until you accept or reject them.')
  const groups = new Map<string, CurationItem[]>()
  for (const c of snapshot.curation) groups.set(c.job ?? '', [...(groups.get(c.job ?? '') ?? []), c])
  for (const [folder, items] of groups) {
    if (groups.size > 1 || folder) {
      const head = body.createDiv({ cls: 'llm-wiki-group llm-wiki-group-row' })
      head.createSpan({ text: `${folder || 'other'} · ${items.length}` })
      if (items.length > 1 && actions) button(head, `Accept all in ${folder || 'other'}`, () => ctx.write(async () => {
        const outs = await Promise.all(items.map((c) => actions.accept(c.path)))
        const ok = outs.filter((o) => o.ok).length
        return { ok: ok === outs.length, message: ok === outs.length ? `accepted ${ok} pages` : `accepted ${ok} of ${outs.length}: ${outs.find((o) => !o.ok)?.message ?? ''}` }
      }), { icon: 'check-check' })
    }
    for (const c of items) pageRow(body, c, ctx, true)
  }

  const unadopted = snapshot.unadopted ?? []
  const fresh = section(root, 'Not yet in the wiki', {
    count: unadopted.length,
    actions: (bar) => {
      if (unadopted.length > 1 && actions)
        button(bar, 'Adopt all', () => ctx.write(() => actions.adopt(unadopted.map((c) => c.path))), { icon: 'check-check' })
    },
  })
  if (snapshot.unadopted === null) empty(fresh, 'This CLI cannot tell which files are new.', 'Update the llm-wiki plugins; a current `page ls` reports each page’s change state.')
  else if (!unadopted.length) empty(fresh, 'Everything under sources/ is known to the wiki.', 'A file dropped into sources/ shows here until it is adopted.')
  for (const c of unadopted) pageRow(fresh, c, ctx, false)
}

function pageRow(parent: HTMLElement, c: CurationItem, ctx: TabContext, curating: boolean): void {
  const actions = ctx.plugin.actions
  const row = parent.createDiv({ cls: 'llm-wiki-row is-link' })
  row.tabIndex = 0
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: titleOf(ctx, c.path) ?? c.title })
  main.createDiv({ cls: 'llm-wiki-row-detail', text: c.path })
  const open = () => void ctx.act({ kind: 'open', path: c.path })
  row.addEventListener('click', open)
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') open()
  })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!actions) return
  if (!curating) {
    button(bar, 'Adopt', () => ctx.write(() => actions.adopt([c.path])), { icon: 'check' })
    return
  }
  button(bar, 'Accept', () => ctx.write(() => actions.accept(c.path)), { icon: 'check', cta: true })
  button(bar, 'Reject…', async () => {
    const reason = await promptText(ctx.plugin.app, { title: `Reject ${c.title}`, placeholder: 'Why? One line; it is stamped on the page.', cta: 'Reject' })
    if (reason) await ctx.write(() => actions.reject(c.path, reason))
  }, { icon: 'x' })
}

/** The note's own title, from Obsidian's metadata cache; the row carries none. */
export function titleOf(ctx: TabContext, path: string): string | undefined {
  const fm: Record<string, unknown> | undefined = ctx.plugin.app.metadataCache.getCache(path)?.frontmatter
  const t = fm?.title
  return typeof t === 'string' && t.trim() ? t.trim() : undefined
}
