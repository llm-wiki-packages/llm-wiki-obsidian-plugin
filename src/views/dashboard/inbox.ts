import { Component, MarkdownRenderer, MarkdownView, Notice, type App } from 'obsidian'
import { slash } from '../../chat/skills'
import { button, empty, relativeTime, section } from '../../ui/dom'
import { setBox } from '../../vault/pages'
import type { Actions, Outcome } from '../../wiki/actions'
import { messagePath, type InboxReadAnswer } from '../../wiki/inbox'
import type { HeldGroup, InboxMessage } from '../../wiki/model'
import type { TabContext } from './index'

/** The `done` box a person ticks on a message; the sweep reads it. */
const DONE = 'done'

/**
 * Done, the way the inbox means it. With a `reply_to`, the message is ticked `done` as a person ticks it in the note's
 * properties (no CLI verb sets it) and `inboxes sweep` sends the answer on; with none, `inboxes rm` does what the sweep
 * would. Any open editor on the note is saved first, so an answer still being typed goes with it.
 */
export async function closeMessage(app: App, actions: Actions, m: InboxMessage): Promise<Outcome> {
  if (!m.replyTo) return actions.removeMessage(m)
  const path = messagePath(m)
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view
    if (view instanceof MarkdownView && view.file?.path === path) await view.save()
  }
  if (!m.done) {
    const ticked = await setBox(app, path, DONE, true)
    if (!ticked.ok) return ticked
  }
  return actions.sweepInbox(m)
}

/** The note itself, in a new tab with the cursor under the message: the answer is typed into the body. */
async function reply(ctx: TabContext, m: InboxMessage): Promise<void> {
  const app = ctx.plugin.app
  const file = app.vault.getFileByPath(messagePath(m))
  if (!file) {
    new Notice(`${messagePath(m)} is not in the vault yet; refresh and try again`)
    return
  }
  const leaf = app.workspace.getLeaf('tab')
  await leaf.openFile(file, { active: true, state: { mode: 'source' } })
  const view = leaf.view
  if (view instanceof MarkdownView) {
    const editor = view.editor
    const last = editor.lastLine()
    editor.setCursor({ line: last, ch: editor.getLine(last).length })
    editor.focus()
  }
  new Notice(m.replyTo ? `Write your answer under the message, then press Done: it goes to ${m.replyTo}.` : 'Write under the message, then press Done.', 6000)
  void markRead(ctx, m)
}

function readKey(m: InboxMessage): string {
  return `${m.id}@${m.at ?? ''}`
}

/** `inboxes read`, once per message per view: it answers the body, and the row stops reading as new. */
async function markRead(ctx: TabContext, m: InboxMessage): Promise<InboxReadAnswer | null> {
  const reads = (ctx.memo['inbox.reads'] ??= {}) as Record<string, InboxReadAnswer | string>
  // A second write to the same subject merges into the message and moves its time: read it again then.
  const key = readKey(m)
  const had = reads[key]
  if (had !== undefined) return typeof had === 'string' ? null : had
  const actions = ctx.plugin.actions
  if (!actions) return null
  const out = await actions.readMessage(m)
  reads[key] = out.read ?? out.message
  if (out.read) m.seen = true
  return out.read ?? null
}

function chatAbout(ctx: TabContext, m: InboxMessage): Promise<void> {
  return ctx.act({ kind: 'ask', prompt: `About the message “${m.subject}” in my ${m.inbox} inbox, [[${messagePath(m)}]]: ` })
}

/** What a person is asked, and what waits on their judgment. Every row is the CLI's; Done is one verb (and a tick). */
export function renderInbox(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const all = snapshot.inbox ?? []
  const open = all.filter((m) => !m.done)
  const answered = all.filter((m) => m.done)
  const messages = section(root, 'Messages', { count: open.length })
  if (snapshot.inbox === null) empty(messages, 'The inbox could not be read.', 'The notice above says why.')
  else if (!all.length) empty(messages, 'No messages.', 'When a skill or an agent asks you something, it lands here.')
  for (const m of open) messageRow(messages, m, ctx)
  if (answered.length) {
    const sent = messages.createDiv({ cls: 'llm-wiki-also' })
    sent.createSpan({ cls: 'llm-wiki-also-label', text: 'Answered' })
    sent.createSpan({ cls: 'llm-wiki-muted', text: `${answered.map((m) => `“${m.subject}”`).join(', ')}: ticked done, not sent yet` })
    const actions = ctx.plugin.actions
    if (actions) button(sent, 'Send now', () => ctx.write(() => actions.sweepInbox(answered[0]!)), { icon: 'send' }).addClass('llm-wiki-small')
  }
  judgment(root, ctx)
}

function messageRow(parent: HTMLElement, m: InboxMessage, ctx: TabContext): void {
  const openId = ctx.memo['inbox.open'] as string | undefined
  const expanded = openId === m.id
  const wrap = parent.createDiv({ cls: `llm-wiki-message${expanded ? ' is-open' : ''}${m.seen ? '' : ' is-new'}` })
  const row = wrap.createDiv({ cls: 'llm-wiki-row is-link' })
  row.createSpan({ cls: `llm-wiki-dot is-${m.seen ? 'muted' : 'new'}`, attr: { title: m.seen ? 'Read on this machine' : 'New' } })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: m.subject })
  const where = m.replyTo ? `Done sends your answer to ${m.replyTo}` : 'Done files it away'
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [relativeTime(m.at), m.readable ? where : 'unreadable: open the note to see why'].filter(Boolean).join(' · ') })
  row.addEventListener('click', () => {
    ctx.memo['inbox.open'] = expanded ? undefined : m.id
    ctx.redraw()
  })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Reply', () => reply(ctx, m), { icon: 'reply', title: 'Open the message to write an answer under it' })
  const actions = ctx.plugin.actions
  if (actions) button(bar, 'Done', () => ctx.write(() => closeMessage(ctx.plugin.app, actions, m)), { icon: 'check', cta: true, title: where })
  button(bar, '', () => chatAbout(ctx, m), { icon: 'message-square', title: 'Chat about this' })
  if (expanded) void body(wrap.createDiv({ cls: 'llm-wiki-message-body' }), m, ctx)
}

/** The message as `inboxes read` answers it: who sent it and why, then the body rendered. */
async function body(el: HTMLElement, m: InboxMessage, ctx: TabContext): Promise<void> {
  el.createDiv({ cls: 'llm-wiki-muted', text: 'Reading…' })
  const read = await markRead(ctx, m)
  el.empty()
  if (!read) {
    const reads = ctx.memo['inbox.reads'] as Record<string, InboxReadAnswer | string> | undefined
    const why = reads?.[readKey(m)]
    el.createDiv({ cls: 'llm-wiki-muted', text: typeof why === 'string' ? why : 'Could not read the message.' })
    return
  }
  const fm = read.frontmatter ?? {}
  const from = fm.from as { actor?: string; unit?: string } | undefined
  const said = [
    from?.actor ? `from ${from.actor}` : '',
    typeof fm.claimed_unit === 'string' && fm.claimed_unit ? `about ${fm.claimed_unit}` : from?.unit ? `about ${from.unit}` : '',
    typeof fm.evidence === 'string' && fm.evidence ? `saw: ${fm.evidence}` : '',
  ].filter(Boolean)
  if (said.length) el.createDiv({ cls: 'llm-wiki-row-detail', text: said.join(' · ') })
  ;(ctx.memo['inbox.renderer'] as Component | undefined)?.unload()
  const renderer = new Component()
  renderer.load()
  ctx.memo['inbox.renderer'] = renderer
  await MarkdownRenderer.render(ctx.plugin.app, read.body ?? '', el.createDiv({ cls: 'markdown-rendered' }), messagePath(m), renderer)
}

/** `whereami`'s count, and the lists wiki-report reads for it. All of it is answered in chat with `/ingest`. */
function judgment(root: HTMLElement, ctx: TabContext): void {
  const { needsYou, held, conflicts } = ctx.snapshot
  if (!needsYou) return
  const ingest = slash('ingest')
  const body = section(root, 'Waiting on your judgment', {
    count: needsYou,
    actions: (bar) => button(bar, `Answer with ${ingest}`, () => ctx.act({ kind: 'ask', prompt: ingest }), { icon: 'message-square', cta: true }),
  })
  body.createDiv({ cls: 'llm-wiki-muted', text: 'Sources held from ingest, groups of new pages curate left to you, and conflicts between what came in and what the wiki says. The agent walks through them with you.' })
  for (const g of held ?? []) heldRow(body, g, ctx)
  for (const c of conflicts ?? []) {
    const row = body.createDiv({ cls: 'llm-wiki-row is-link' })
    row.addEventListener('click', () => void ctx.act({ kind: 'open', path: messagePath(c) }))
    row.createSpan({ cls: 'llm-wiki-dot is-warn' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: c.subject })
    main.createDiv({ cls: 'llm-wiki-row-detail', text: ['Conflict', relativeTime(c.at)].filter(Boolean).join(' · ') })
    button(row.createDiv({ cls: 'llm-wiki-row-actions' }), '', () => chatAbout(ctx, c), { icon: 'message-square', title: 'Chat about this' })
  }
  const changes = body.createDiv({ cls: 'llm-wiki-today is-link' })
  changes.createSpan({ cls: 'llm-wiki-muted', text: 'Groups of new pages are judged on Changes →' })
  changes.addEventListener('click', () => ctx.goTo('changes'))
}

function stem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** A bundle is named by its folder: its root is `README.md` by convention. */
function bundleName(root: string): string {
  const parts = root.split('/')
  return parts.length > 1 && /^readme\.md$/i.test(parts.at(-1)!) ? parts.at(-2)! : stem(root)
}

function heldRow(parent: HTMLElement, g: HeldGroup, ctx: TabContext): void {
  const row = parent.createDiv({ cls: `llm-wiki-row${g.root ? ' is-link' : ''}` })
  if (g.root) row.addEventListener('click', () => void ctx.act({ kind: 'open', path: g.root! }))
  row.createSpan({ cls: 'llm-wiki-dot is-warn' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const n = g.pages.length
  main.createDiv({ cls: 'llm-wiki-row-title', text: g.root ? bundleName(g.root) : 'Held on their own' })
  const names = g.pages.slice(0, 3).map(stem).join(', ')
  main.createDiv({ cls: 'llm-wiki-row-detail', text: `${g.root ? 'Bundle held from ingest' : 'Held from ingest'} · ${n} ${n === 1 ? 'page' : 'pages'}${n ? `: ${names}${n > 3 ? ` and ${n - 3} more` : ''}` : ''}` })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!g.root && n) button(bar, 'Open', () => ctx.act({ kind: 'open', path: g.pages[0]! }))
}
