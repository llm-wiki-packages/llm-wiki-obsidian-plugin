import { button, empty, section } from '../../ui/dom'
import { promptText } from '../../ui/modals'
import type { CurationItem } from '../../wiki/model'
import type { TabContext } from './index'
import { PLUGIN_NAMESPACE, slash } from '../../chat/skills'

/** The intake pipeline, top to bottom: a file under sources/ is adopted as a draft, then accepted or rejected. */
export function renderIngest(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const actions = ctx.plugin.actions
  root.createDiv({ cls: 'llm-wiki-muted llm-wiki-flow', text: 'How a page gets in: a file lands under sources/, is adopted into the wiki as a draft, and waits for you to accept or reject it. Work moves down this page.' })

  const unadopted = snapshot.unadopted ?? []
  const fresh = section(root, 'New under sources/', {
    count: unadopted.length,
    actions: (bar) => {
      if (unadopted.length > 1 && actions)
        button(bar, 'Adopt all', () => ctx.write(() => actions.adopt(unadopted.map((c) => c.path)), true), { icon: 'check-check' })
    },
  })
  if (snapshot.unadopted === null) empty(fresh, 'This CLI cannot tell which files are new.', `Update the ${PLUGIN_NAMESPACE} plugins; a current page listing reports each page’s change state.`)
  else if (!unadopted.length) empty(fresh, 'Everything under sources/ is known to the wiki.', 'A file dropped into sources/ shows here until it is adopted.')
  for (const c of unadopted) pageRow(fresh, c, ctx, false)

  const body = section(root, 'Awaiting curation', {
    count: snapshot.curation.length,
    actions: (bar) => {
      if (snapshot.curation.length)
        button(bar, 'Ask the agent to curate', () => ctx.act({ kind: 'ask', prompt: slash('curate', snapshot.curation.slice(0, 20).map((c) => c.path).join(' ')) }), { icon: 'message-square' })
    },
  })
  if (!snapshot.curation.length) empty(body, 'No drafts are waiting.', 'An adopted file and every page a job captures sit here as drafts until you accept or reject them. Accepted pages are in the wiki.')
  const groups = new Map<string, CurationItem[]>()
  for (const c of snapshot.curation) groups.set(c.job ?? '', [...(groups.get(c.job ?? '') ?? []), c])
  for (const [folder, items] of groups) {
    if (groups.size > 1 || folder) {
      const head = body.createDiv({ cls: 'llm-wiki-group llm-wiki-group-row' })
      head.createSpan({ text: `${folder || 'other'} · ${items.length}` })
      if (items.length > 1 && actions) button(head, `Accept all in ${folder || 'other'}`, () => ctx.write(() => actions.accept(items.map((c) => c.path)), true), { icon: 'check-check', cta: true })
    }
    for (const c of items) pageRow(body, c, ctx, true)
  }
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
    button(bar, 'Adopt', () => ctx.write(() => actions.adopt([c.path]), true), { icon: 'check' })
    return
  }
  // Plain buttons per row; the folder's Accept all is the one accent.
  button(bar, 'Accept', () => ctx.write(() => actions.accept([c.path]), true), { icon: 'check' })
  button(bar, 'Reject…', async () => {
    const reason = await promptText(ctx.plugin.app, { title: `Reject ${c.title}`, placeholder: 'Why? One line; it is stamped on the page.', cta: 'Reject' })
    if (reason) await ctx.write(() => actions.reject(c.path, reason), true)
  }, { icon: 'x' })
}

/** The note's own title, from Obsidian's metadata cache; the row carries none. */
export function titleOf(ctx: TabContext, path: string): string | undefined {
  const fm: Record<string, unknown> | undefined = ctx.plugin.app.metadataCache.getCache(path)?.frontmatter
  const t = fm?.title
  return typeof t === 'string' && t.trim() ? t.trim() : undefined
}
