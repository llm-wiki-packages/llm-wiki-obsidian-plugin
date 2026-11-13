import { Component, MarkdownRenderer, MarkdownView, Notice, TFile, type App } from 'obsidian'
import { slash } from '../../chat/skills'
import { button, empty, relativeTime, section } from '../../ui/dom'
import { setBox, stem } from '../../vault/pages'
import type { Actions, Outcome } from '../../wiki/actions'
import { answerTyped, conflictOf, doneWords, idsOnly, incomingPath, updatesOnly, type ConflictClaim, type InboxReadAnswer } from '../../wiki/inbox'
import { confirm } from '../../ui/modals'
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

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/

/** The note's body as the vault holds it now, or null when the file is not there. */
async function bodyNow(app: App, path: string): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(path)
  return file instanceof TFile ? (await app.vault.read(file)).replace(FRONTMATTER, '') : null
}

export interface DoneOptions {
  /** The body before any answer: as `inboxes read` answered it, else as this view first saw the note; null when unknown. */
  baseline?: string | null
  /** Asked before an older CLI deletes a typed answer; false keeps the message. */
  confirmDelete?: () => Promise<boolean>
}

/**
 * Done, the way the inbox means it: the open editor saved, then `inboxes done`, which closes that one message with
 * the answer the body now holds; `--answered` when the body differs from the baseline, or when there is none to tell,
 * so a typed answer is archived, never deleted (a job ask is ticked and left for its job). An older CLI has no such
 * verb: there the message is ticked `done` as the property editor would and `inboxes sweep` sends it, or, with no
 * `reply_to`, `inboxes remove` deletes it, after asking when an answer may be in it.
 */
export async function closeMessage(app: App, actions: Actions, m: InboxMessage, inboxDone: boolean, opts: DoneOptions = {}): Promise<Outcome> {
  await saveOpen(app, m.path)
  const now = await bodyNow(app, m.path)
  const typed = opts.baseline == null || now === null ? null : answerTyped(now, opts.baseline)
  if (inboxDone) return actions.doneMessage(m, typed !== false)
  if (!m.replyTo) {
    if (typed !== false && opts.confirmDelete && !(await opts.confirmDelete())) return { ok: false, message: `Nothing changed: “${m.subject}” keeps your answer` }
    return actions.removeMessage(m)
  }
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
  await seeBaseline(ctx, m)
  const leaf = app.workspace.getLeaf('tab')
  await leaf.openFile(file, { active: true, state: { mode: 'source' } })
  const view = leaf.view
  if (view instanceof MarkdownView) {
    const editor = view.editor
    const last = editor.lastLine()
    editor.setCursor({ line: last, ch: editor.getLine(last).length })
    editor.focus()
  }
  replied(ctx).add(m.id)
  ctx.redraw()
  new Notice(`Write your answer under the message, then press Done. ${doneWords(m, true, ctx.snapshot.inboxDone)}.`, 6000)
  void markRead(ctx, m)
}

/** The messages Reply opened for an answer in this view: the row says what Done does to an answer. */
function replied(ctx: TabContext): Set<string> {
  return (ctx.memo['inbox.replied'] ??= new Set<string>()) as Set<string>
}

function baselines(ctx: TabContext): Record<string, string> {
  return (ctx.memo['inbox.baselines'] ??= {}) as Record<string, string>
}

/** The body before any answer: what `inboxes read` answered, else the note as this view first saw it. */
function baselineOf(ctx: TabContext, m: InboxMessage): string | null {
  const read = (ctx.memo['inbox.reads'] as Record<string, InboxReadAnswer> | undefined)?.[readKey(m)]
  return read?.body ?? baselines(ctx)[readKey(m)] ?? null
}

/** Note the body of a message this view has not seen yet, before anyone types into it. */
async function seeBaseline(ctx: TabContext, m: InboxMessage): Promise<void> {
  const key = readKey(m)
  if (baselines(ctx)[key] !== undefined) return
  const body = await bodyNow(ctx.plugin.app, m.path)
  if (body !== null) baselines(ctx)[key] ??= body
}

/** Done from the dashboard: the baseline this view holds, and a confirmation before an older CLI deletes an answer. */
export function doneFromView(ctx: TabContext, actions: Actions, m: InboxMessage): Promise<Outcome> {
  return closeMessage(ctx.plugin.app, actions, m, ctx.snapshot.inboxDone, {
    baseline: baselineOf(ctx, m),
    confirmDelete: () => confirm(ctx.plugin.app, { title: `Delete “${m.subject}”?`, body: 'This CLI cannot archive a message: Done deletes it, and anything you typed in it. Update llm-wiki to keep answers.', cta: 'Delete' }),
  })
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
  // Messages lead only when there are some; an empty inbox is one quiet line below what does wait.
  if (snapshot.inbox === null || all.length) {
    const messages = section(root, 'Messages', { count: open.length })
    if (snapshot.inbox === null) empty(messages, 'The inbox could not be read.', 'The notice above says why.')
    for (const m of open) {
      void seeBaseline(ctx, m)
      messageRow(messages, m, ctx)
    }
    answeredRows(messages, answered, ctx)
  }
  const judged = judgment(root, ctx)
  const held = heldElsewhere(root, ctx)
  if (snapshot.inbox !== null && !all.length) {
    if (!judged && !held) empty(root, 'Nothing waits on you.', 'When a skill or an agent asks you something, or a new source disagrees with the wiki, it lands here.')
    else root.createDiv({ cls: 'llm-wiki-muted llm-wiki-inbox-quiet', text: 'No messages. When a skill or an agent asks you something, it lands here.' })
  }
}

/** Ticked done but still here: a job's answer waits for its next run; any other waits to be sent. */
function answeredRows(parent: HTMLElement, answered: InboxMessage[], ctx: TabContext): void {
  const forJobs = answered.filter((m) => m.jobAsk)
  const unsent = answered.filter((m) => !m.jobAsk)
  for (const m of forJobs) {
    const row = parent.createDiv({ cls: 'llm-wiki-also' })
    row.createSpan({ cls: 'llm-wiki-also-label', text: 'Answered' })
    row.createSpan({ cls: 'llm-wiki-muted', text: `“${m.subject}”: ${m.job ? `job ${m.job}` : 'the job'} picks it up next run` })
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
  const typed = replied(ctx).has(m.id)
  const where = doneWords(m, typed, ctx.snapshot.inboxDone)
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [relativeTime(m.at), m.readable ? where : 'Unreadable: open the note to see why'].filter(Boolean).join(' · ') })
  row.addEventListener('click', () => {
    ctx.memo['inbox.open'] = expanded ? undefined : m.id
    ctx.redraw()
  })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Reply', () => reply(ctx, m), { icon: 'reply', title: 'Open the message and write your answer under it' })
  const actions = ctx.plugin.actions
  if (actions) button(bar, 'Done', () => ctx.write(() => doneFromView(ctx, actions, m)), { icon: 'check', cta: true, title: where })
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
function judgment(root: HTMLElement, ctx: TabContext): boolean {
  const { needsYou, parts, blocked, held, conflicts, updatesWaiting } = ctx.snapshot
  const pageConflicts = parts?.page_conflicts ?? []
  // A wiki without the conflicts inbox marks the page and files no record, so `whereami` counts none of these.
  const updates = updatesOnly(updatesWaiting, parts)
  if (!needsYou && !blocked.length && !pageConflicts.length && !updates.length) return false
  const ingest = slash('ingest')
  const body = section(root, 'Waiting on your judgment', {
    count: Math.max(needsYou ?? 0, blocked.length, pageConflicts.length) + updates.length,
    actions: (bar) => button(bar, 'Answer in chat', () => ctx.act({ kind: 'ask', prompt: ingest }), { icon: 'message-square', cta: true, title: `Starts ${ingest} in chat` }),
  })
  body.createDiv({ cls: 'llm-wiki-muted', text: 'The wiki will not decide these without you. Open each one, read both sides, and pick which is right.' })
  for (const b of blocked) blockedRow(body, b, ctx)
  for (const g of waitingGroups(held, parts)) heldRow(body, g, ctx, true)
  for (const c of conflicts ?? []) conflictRow(body, c, ctx)
  for (const p of pageConflicts) pageConflictRow(body, p.page, ctx)
  for (const page of updates) pageConflictRow(body, page, ctx)
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
  return true
}

/**
 * A new source that disagrees with a wiki page. The listing names it by ids; the record's own frontmatter says which
 * page and what each side claims, so the row reads as the disagreement and opens to both claims side by side.
 */
function conflictRow(parent: HTMLElement, c: InboxMessage, ctx: TabContext): void {
  const app = ctx.plugin.app
  const claim = conflictOf(app.metadataCache.getCache(c.path)?.frontmatter)
  const key = `conflict:${c.id}`
  const expanded = ctx.memo['inbox.open'] === key
  const wrap = parent.createDiv({ cls: `llm-wiki-message${expanded ? ' is-open' : ''}` })
  const row = wrap.createDiv({ cls: 'llm-wiki-row is-link' })
  row.addEventListener('click', () => {
    ctx.memo['inbox.open'] = expanded ? undefined : key
    ctx.redraw()
  })
  row.createSpan({ cls: 'llm-wiki-dot is-warn' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const name = claim?.title ?? (claim?.page ? stem(claim.page) : idsOnly(c.subject) ? 'A new source disagrees with the wiki' : c.subject)
  main.createDiv({ cls: 'llm-wiki-row-title', text: name })
  const from = claim?.source ? `${stem(claim.source)} disagrees with the wiki` : 'A new source disagrees with the wiki'
  const hint = expanded ? '' : 'click to decide'
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [from, relativeTime(c.at), hint].filter(Boolean).join(' · ') })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (claim?.page) button(bar, 'Open page', () => ctx.act({ kind: 'open', path: claim.page! }), { icon: 'file-text', title: claim.page })
  button(bar, '', () => ctx.act({ kind: 'ask', prompt: conflictPrompt(c, claim) }), { icon: 'message-square', title: 'Talk it through in chat' })
  if (!expanded) return
  const body = wrap.createDiv({ cls: 'llm-wiki-message-body' })
  if (!claim) {
    body.createDiv({ cls: 'llm-wiki-muted', text: 'The record does not say what disagrees.' })
  } else {
    const sides = body.createDiv({ cls: 'llm-wiki-conflict' })
    side(sides, 'The wiki says', claim.held, claim.heldSources.map((h) => ({ path: h.resource, quote: h.quote })), ctx)
    side(sides, claim.source ? `${stem(claim.source)} says` : 'The new source says', claim.says, [{ path: claim.source, quote: claim.quote }], ctx)
  }
  // The ruling: the wiki stands (closed here, the record archived with the ruling), or the page changes, which is the
  // agent's to write with the right citation, so those two open chat with everything it needs.
  const decide = body.createDiv({ cls: 'llm-wiki-conflict-decide' })
  decide.createSpan({ cls: 'llm-wiki-conflict-ask', text: 'Which is right?' })
  const actions = ctx.plugin.actions
  if (actions) button(decide, 'Keep the wiki', () => ctx.write(() => actions.keepWiki(c, claim?.page ?? null)), { icon: 'check', title: 'The page stays as it is. The conflict closes, and the ruling is archived with it.' })
  if (claim) {
    button(decide, 'Use the new source', () => ctx.act({ kind: 'ask', prompt: rulingPrompt(c, claim, 'source') }), { icon: 'file-input', title: 'The agent rewrites the page from the new source, then closes the conflict' })
    button(decide, 'Both are true', () => ctx.act({ kind: 'ask', prompt: rulingPrompt(c, claim, 'both') }), { icon: 'git-merge', title: 'They apply at different times or in different cases: the agent writes both into the page, then closes the conflict' })
  }
  button(decide, 'Open the record', () => ctx.act({ kind: 'open', path: c.path }), { icon: 'inbox', title: c.path }).addClass('llm-wiki-conflict-record')
}

function rulingPrompt(c: InboxMessage, claim: ConflictClaim, how: 'source' | 'both'): string {
  const page = claim.page ? `[[${claim.page}]]` : 'the wiki page'
  const source = claim.source ? `[[${claim.source}]]` : 'the new source'
  const facts = `\n- ${page} says: “${claim.held ?? '?'}”\n- ${source} says: “${claim.says ?? '?'}”${claim.quote ? ` (quote: “${claim.quote}”)` : ''}\n\n`
  const close = `Then close the conflict record [[${c.path}]] with \`llm-wiki-ops inboxes done conflicts ${c.id} --answered --stdin\`, giving a one-line ruling on stdin.`
  return how === 'source'
    ? `I rule this conflict for the new source.${facts}Update ${page} so it says what ${source} says and cites it. If the old claim was true once, keep it as a dated history line. ${close}`
    : `Both claims in this conflict are true, at different times or in different cases.${facts}Update ${page} so it states both, says when or where each applies, and cites both sources. Ask me if you cannot tell which applies when. ${close}`
}

function side(parent: HTMLElement, label: string, text: string | null, cites: { path: string | null; quote: string | null }[], ctx: TabContext): void {
  const el = parent.createDiv({ cls: 'llm-wiki-conflict-side' })
  el.createDiv({ cls: 'llm-wiki-conflict-label', text: label })
  el.createDiv({ cls: 'llm-wiki-conflict-claim', text: text ?? '(no claim given)' })
  for (const cite of cites) {
    if (!cite.path && !cite.quote) continue
    const q = el.createDiv({ cls: 'llm-wiki-conflict-cite' })
    if (cite.quote) q.createEl('q', { text: cite.quote })
    if (cite.path) {
      const a = q.createEl('a', { cls: 'llm-wiki-conflict-source', text: stem(cite.path), attr: { href: '#', title: cite.path } })
      a.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        void ctx.act({ kind: 'open', path: cite.path! })
      })
    }
  }
}

function conflictPrompt(c: InboxMessage, claim: ConflictClaim | null): string {
  if (!claim) return `Help me settle the conflict in [[${c.path}]]: `
  const page = claim.page ? `[[${claim.page}]]` : 'a wiki page'
  return `A new source disagrees with ${page}. The wiki says: “${claim.held ?? '?'}”. ${claim.source ? `[[${claim.source}]]` : 'The source'} says: “${claim.says ?? '?'}”. The record is [[${c.path}]]. Help me decide which holds, then settle it.`
}

/**
 * A page a job refreshed while you had edited it (`ops.updates_waiting`, and a page-conflicts record where the wiki
 * keeps that inbox): the body did not merge, or a key the job sets you had changed too. The job's version waits beside
 * it in `_versions/`. Keep mine clears it; Take theirs writes the update over the page and sets yours aside.
 */
function pageConflictRow(parent: HTMLElement, page: string, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row is-link' })
  row.addEventListener('click', () => void ctx.act({ kind: 'open', path: page }))
  row.createSpan({ cls: 'llm-wiki-dot is-warn' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: stem(page) })
  main.createDiv({ cls: 'llm-wiki-row-detail', text: 'A job’s update waits: you had changed this page too' })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  const actions = ctx.plugin.actions
  // Opened only when it is there: a link that resolves to nothing would make an empty note of that name.
  const incoming = incomingPath(page)
  button(bar, 'Compare', () => {
    if (ctx.plugin.app.vault.getAbstractFileByPath(incoming) instanceof TFile) return ctx.act({ kind: 'open', path: incoming })
    new Notice(`The job’s version is not in the vault yet (${incoming}); sync, then try again.`, 6000)
  }, { icon: 'git-compare', title: 'Opens the job’s version' })
  if (!actions) return
  button(bar, 'Keep mine', () => ctx.write(() => actions.resolvePage(page, 'mine')), { title: 'Keeps the page as you have it; the next update merges against it' })
  button(bar, 'Take theirs', async () => {
    const ok = await confirm(ctx.plugin.app, { title: `Take the update for ${stem(page)}?`, body: 'The job’s version replaces the page. Your version is set aside in _versions/.', cta: 'Take theirs' })
    if (ok) await ctx.write(() => actions.resolvePage(page, 'theirs'))
  }, { title: 'Writes the job’s version over the page' })
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
function heldElsewhere(root: HTMLElement, ctx: TabContext): boolean {
  const { held, parts } = ctx.snapshot
  const groups = (held ?? []).map((g) => ({ ...g, pages: g.pages.filter((p) => !parts || !p.waiting) })).filter((g) => g.pages.length)
  if (!groups.length) return false
  const n = groups.reduce((sum, g) => sum + g.pages.length, 0)
  const body = section(root, 'Held sources', { count: n })
  body.createDiv({ cls: 'llm-wiki-muted', text: parts
    ? 'Held from ingest. Nothing waits on them until mine files a record; then they move up.'
    : 'Held from ingest: the agent asks before folding them in.' })
  for (const g of groups) heldRow(body, g, ctx, false)
  return true
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
