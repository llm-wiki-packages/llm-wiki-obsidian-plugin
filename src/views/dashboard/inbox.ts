import { Component, MarkdownRenderer, MarkdownView, Notice, TFile, type App } from 'obsidian'
import { slash } from '../../chat/skills'
import { button, empty, relativeTime, section } from '../../ui/dom'
import { setBox } from '../../vault/pages'
import type { Actions, Outcome } from '../../wiki/actions'
import { doneWords, type InboxReadAnswer } from '../../wiki/inbox'
import type { BlockedJob, HeldGroup, InboxMessage, NeedsYouParts } from '../../wiki/model'
import type { TabContext } from './index'

/** The `done` box a person ticks on a message; the sweep reads it. */
const DONE = 'done'

/** Save any editor open on the note, so an answer still being typed is in the file the CLI reads. */
async function saveOpen(app: App, path: string): Promise<void> {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view
    if (view instanceof MarkdownView && view.file?.path === path) await view.save()
  }
}

/**
 * Done, the way the inbox means it: the open editor saved, then `inboxes done`, which closes that one message with
 * the answer the body now holds (a job ask is ticked and left for its job). An older CLI has no such verb: there the
 * message is ticked `done` as the property editor would and `inboxes sweep` sends it, or, with no `reply_to`,
 * `inboxes rm` removes it, answer and all.
 */
export async function closeMessage(app: App, actions: Actions, m: InboxMessage, inboxDone: boolean): Promise<Outcome> {
  await saveOpen(app, m.path)
  if (inboxDone) return actions.doneMessage(m)
  if (!m.replyTo) return actions.removeMessage(m)
  if (!m.done) {
    const ticked = await setBox(app, m.path, DONE, true)
    if (!ticked.ok) return ticked
  }
  return actions.sweepInbox(m)
}

/** The note itself, in a new tab with the cursor under the message: the answer is typed into the body. */
async function reply(ctx: TabContext, m: InboxMessage): Promise<void> {
  const app = ctx.plugin.app
  const file = app.vault.getFileByPath(m.path)
  if (!file) {
    new Notice(`${m.path} is not in the vault yet; refresh and try again`)
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
  new Notice(`Write your answer under the message, then press Done. ${doneWords(m)}.`, 6000)
  void markRead(ctx, m)
}

function readKey(m: InboxMessage): string {
  return `${m.id}@${m.at ?? ''}`
}

/**
 * `inboxes read`, once per message per view: it answers the body and the row stops reading as new. A failed read is
 * not kept, so the next open asks again.
 */
async function markRead(ctx: TabContext, m: InboxMessage): Promise<{ read: InboxReadAnswer | null; why?: string }> {
  const reads = (ctx.memo['inbox.reads'] ??= {}) as Record<string, InboxReadAnswer>
  // A second write to the same subject merges into the message and moves its time: read it again then.
  const key = readKey(m)
  if (reads[key]) return { read: reads[key] }
  const actions = ctx.plugin.actions
  if (!actions) return { read: null, why: 'the wiki has not been read yet' }
  const out = await actions.readMessage(m)
  if (!out.read) return { read: null, why: out.message }
  reads[key] = out.read
  m.seen = true
  return { read: out.read }
}

function chatAbout(ctx: TabContext, m: Pick<InboxMessage, 'subject' | 'inbox' | 'path'>): Promise<void> {
  return ctx.act({ kind: 'ask', prompt: `About the message “${m.subject}” in the ${m.inbox} inbox, [[${m.path}]]: ` })
}

/** What a person is asked, and what waits on their judgment. Every row is the CLI's; Done is one verb. */
export function renderInbox(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const all = snapshot.inbox ?? []
  const open = all.filter((m) => !m.done)
  const answered = all.filter((m) => m.done)
  const messages = section(root, 'Messages', { count: open.length })
  if (snapshot.inbox === null) empty(messages, 'The inbox could not be read.', 'The notice above says why.')
  else if (!all.length) empty(messages, 'No messages.', 'When a skill or an agent asks you something, it lands here.')
  for (const m of open) messageRow(messages, m, ctx)
  answeredRows(messages, answered, ctx)
  judgment(root, ctx)
  heldElsewhere(root, ctx)
}

/** Ticked done but still here: a job's answer waits for its next run; any other waits to be sent. */
function answeredRows(parent: HTMLElement, answered: InboxMessage[], ctx: TabContext): void {
  const forJobs = answered.filter((m) => m.job)
  const unsent = answered.filter((m) => !m.job)
  for (const m of forJobs) {
    const row = parent.createDiv({ cls: 'llm-wiki-also' })
    row.createSpan({ cls: 'llm-wiki-also-label', text: 'Answered' })
    row.createSpan({ cls: 'llm-wiki-muted', text: `“${m.subject}”: job ${m.job} picks it up next run` })
  }
  if (!unsent.length) return
  const row = parent.createDiv({ cls: 'llm-wiki-also' })
  row.createSpan({ cls: 'llm-wiki-also-label', text: 'Answered' })
  row.createSpan({ cls: 'llm-wiki-muted', text: `${unsent.map((m) => `“${m.subject}”`).join(', ')}: ticked done, not sent yet` })
  const actions = ctx.plugin.actions
  if (actions) button(row, 'Send now', () => ctx.write(() => actions.sweepInbox(unsent[0]!)), { icon: 'send', title: 'Run the sweep: each one goes to whoever asked' }).addClass('llm-wiki-small')
}

function messageRow(parent: HTMLElement, m: InboxMessage, ctx: TabContext): void {
  const expanded = ctx.memo['inbox.open'] === m.id
  const wrap = parent.createDiv({ cls: `llm-wiki-message${expanded ? ' is-open' : ''}${m.seen ? '' : ' is-new'}` })
  const row = wrap.createDiv({ cls: 'llm-wiki-row is-link' })
  row.createSpan({ cls: `llm-wiki-dot is-${m.seen ? 'muted' : 'new'}`, attr: { title: m.seen ? 'Read on this machine' : 'New' } })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: m.subject })
  const where = doneWords(m)
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [relativeTime(m.at), m.readable ? where : 'Unreadable: open the note to see why'].filter(Boolean).join(' · ') })
  row.addEventListener('click', () => {
    ctx.memo['inbox.open'] = expanded ? undefined : m.id
    ctx.redraw()
  })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Reply', () => reply(ctx, m), { icon: 'reply', title: 'Open the message and write your answer under it' })
  const actions = ctx.plugin.actions
  if (actions) button(bar, 'Done', () => ctx.write(() => closeMessage(ctx.plugin.app, actions, m, ctx.snapshot.inboxDone)), { icon: 'check', cta: true, title: where })
  button(bar, '', () => chatAbout(ctx, m), { icon: 'message-square', title: 'Chat about this' })
  if (expanded) void body(wrap.createDiv({ cls: 'llm-wiki-message-body' }), m, ctx)
}

/** The message as `inboxes read` answers it: who sent it and why, then the body. If the CLI cannot read it, the note as the vault holds it. */
async function body(el: HTMLElement, m: InboxMessage, ctx: TabContext): Promise<void> {
  el.createDiv({ cls: 'llm-wiki-muted', text: 'Reading…' })
  const { read, why } = await markRead(ctx, m)
  el.empty()
  const app = ctx.plugin.app
  let text = read?.body
  if (!read) {
    const file = app.vault.getAbstractFileByPath(m.path)
    if (!(file instanceof TFile)) {
      el.createDiv({ cls: 'llm-wiki-muted', text: `Could not read the message: ${why ?? 'no answer'}` })
      return
    }
    el.createDiv({ cls: 'llm-wiki-muted', text: `Shown from the note; the CLI could not read it (${why ?? 'no answer'}), so it is not marked read.` })
    text = (await app.vault.cachedRead(file)).replace(/^---\n[\s\S]*?\n---\n?/, '')
  } else {
    const fm = read.frontmatter ?? {}
    const from = fm.from as { actor?: string; unit?: string } | undefined
    const said = [
      from?.actor ? `From ${from.actor}` : '',
      typeof fm.claimed_unit === 'string' && fm.claimed_unit ? `about ${fm.claimed_unit}` : from?.unit ? `about ${from.unit}` : '',
      typeof fm.evidence === 'string' && fm.evidence ? `saw: ${fm.evidence}` : '',
    ].filter(Boolean)
    if (said.length) el.createDiv({ cls: 'llm-wiki-row-detail', text: said.join(' · ') })
  }
  ;(ctx.memo['inbox.renderer'] as Component | undefined)?.unload()
  const renderer = new Component()
  renderer.load()
  ctx.memo['inbox.renderer'] = renderer
  await MarkdownRenderer.render(app, text ?? '', el.createDiv({ cls: 'markdown-rendered' }), m.path, renderer)
}

/**
 * `whereami`'s count, and each thing it counts. With the breakdown, every row here is counted; without it (an older
 * CLI) the count stands alone over the conflicts, and the held sources go below as held, not as waiting.
 */
function judgment(root: HTMLElement, ctx: TabContext): void {
  const { needsYou, parts, blocked, held, conflicts } = ctx.snapshot
  if (!needsYou && !blocked.length) return
  const ingest = slash('ingest')
  const body = section(root, 'Waiting on your judgment', {
    count: needsYou ?? blocked.length,
    actions: (bar) => button(bar, 'Answer in chat', () => ctx.act({ kind: 'ask', prompt: ingest }), { icon: 'message-square', cta: true, title: `Starts ${ingest} in chat` }),
  })
  body.createDiv({ cls: 'llm-wiki-muted', text: 'What the wiki will not decide without you. The agent walks through the held sources and conflicts with you; a blocked job names the command that clears it.' })
  for (const b of blocked) blockedRow(body, b, ctx)
  for (const g of waitingGroups(held, parts)) heldRow(body, g, ctx, true)
  for (const c of conflicts ?? []) {
    const row = body.createDiv({ cls: 'llm-wiki-row is-link' })
    row.addEventListener('click', () => void ctx.act({ kind: 'open', path: c.path }))
    row.createSpan({ cls: 'llm-wiki-dot is-warn' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: c.subject })
    main.createDiv({ cls: 'llm-wiki-row-detail', text: ['Conflict between a new source and the wiki', relativeTime(c.at)].filter(Boolean).join(' · ') })
    button(row.createDiv({ cls: 'llm-wiki-row-actions' }), '', () => chatAbout(ctx, c), { icon: 'message-square', title: 'Chat about this' })
  }
  if (parts?.curate.length) {
    const row = body.createDiv({ cls: 'llm-wiki-row is-link' })
    row.addEventListener('click', () => ctx.goTo('changes'))
    row.createSpan({ cls: 'llm-wiki-dot is-warn' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    const n = parts.curate.length
    main.createDiv({ cls: 'llm-wiki-row-title', text: `${n} ${n === 1 ? 'group' : 'groups'} of new pages to judge` })
    main.createDiv({ cls: 'llm-wiki-row-detail', text: parts.curate.slice(0, 3).map((g) => `${g.directory} (${g.reason})`).join(', ') + (n > 3 ? ` and ${n - 3} more` : '') })
    button(row.createDiv({ cls: 'llm-wiki-row-actions' }), 'Changes', () => ctx.goTo('changes'), { icon: 'arrow-right' })
  } else if (!parts) {
    const changes = body.createDiv({ cls: 'llm-wiki-today is-link' })
    changes.createSpan({ cls: 'llm-wiki-muted', text: 'Groups of new pages are judged on Changes →' })
    changes.addEventListener('click', () => ctx.goTo('changes'))
  }
}

/** The held groups narrowed to the pages the count waits on. */
function waitingGroups(held: HeldGroup[] | null, parts: NeedsYouParts | null): HeldGroup[] {
  if (!parts) return []
  const fromList = (held ?? []).map((g) => ({ ...g, pages: g.pages.filter((p) => p.waiting) })).filter((g) => g.pages.length)
  // A counted page the held list did not carry (it moved between the two reads) still shows, on its own.
  const listed = new Set(fromList.flatMap((g) => g.pages.map((p) => p.path)))
  const stray = parts.held.filter((h) => !listed.has(h.path)).map((h) => ({ path: h.path, waiting: true }))
  return stray.length ? [...fromList, { root: null, pages: stray }] : fromList
}

/** Held sources nothing waits on yet (no record is open for them), or every held source from a CLI without the breakdown. */
function heldElsewhere(root: HTMLElement, ctx: TabContext): void {
  const { held, parts } = ctx.snapshot
  const groups = (held ?? []).map((g) => ({ ...g, pages: g.pages.filter((p) => !parts || !p.waiting) })).filter((g) => g.pages.length)
  if (!groups.length) return
  const n = groups.reduce((sum, g) => sum + g.pages.length, 0)
  const body = section(root, 'Held sources', { count: n })
  body.createDiv({ cls: 'llm-wiki-muted', text: parts
    ? 'Held from ingest. Nothing waits on them until mine files a record; then they move up.'
    : 'Held from ingest: the agent asks before folding them in.' })
  for (const g of groups) heldRow(body, g, ctx, false)
}

function stem(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** A bundle is named by its folder: its root is `README.md` by convention. */
function bundleName(root: string): string {
  const parts = root.split('/')
  return parts.length > 1 && /^readme\.md$/i.test(parts.at(-1)!) ? parts.at(-2)! : stem(root)
}

function heldRow(parent: HTMLElement, g: HeldGroup, ctx: TabContext, waiting: boolean): void {
  const row = parent.createDiv({ cls: `llm-wiki-row${g.root ? ' is-link' : ''}` })
  if (g.root) row.addEventListener('click', () => void ctx.act({ kind: 'open', path: g.root! }))
  row.createSpan({ cls: `llm-wiki-dot is-${waiting ? 'warn' : 'muted'}` })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const n = g.pages.length
  main.createDiv({ cls: 'llm-wiki-row-title', text: g.root ? bundleName(g.root) : 'Not in a bundle' })
  const names = g.pages.slice(0, 3).map((p) => stem(p.path)).join(', ')
  const what = waiting ? `${n} held ${n === 1 ? 'source waits' : 'sources wait'} on you` : `${n} held ${n === 1 ? 'source' : 'sources'}`
  main.createDiv({ cls: 'llm-wiki-row-detail', text: `${what}: ${names}${n > 3 ? ` and ${n - 3} more` : ''}` })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!g.root) button(bar, 'Open', () => ctx.act({ kind: 'open', path: g.pages[0]!.path }), { title: g.pages[0]!.path })
}

function blockedRow(parent: HTMLElement, b: BlockedJob, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row' })
  row.createSpan({ cls: 'llm-wiki-dot is-warn' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: `${b.job} is blocked on this machine` })
  main.createDiv({ cls: 'llm-wiki-row-detail', text: b.reason })
  main.createDiv({ cls: 'llm-wiki-row-fix', text: b.next })
  button(row.createDiv({ cls: 'llm-wiki-row-actions' }), 'Ask the agent', () => ctx.act({ kind: 'ask', prompt: `Job ${b.job} is blocked on this machine: ${b.reason}. The CLI says \`${b.next}\` clears it. Check the cause, then clear it.` }), { icon: 'message-square' })
}
