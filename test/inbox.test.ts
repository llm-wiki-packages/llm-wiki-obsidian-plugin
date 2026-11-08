import { MarkdownView, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { closeMessage } from '../src/views/dashboard/inbox'
import type { Actions } from '../src/wiki/actions'
import { childEnv, CliError, VERBS, type Args, type Verb } from '../src/wiki/cli'
import { closedSentence, doneWords, heldGroups, inboxAttention, inboxCount, incomingPath, messageAt, messageOf, messagePath, sweptSentence, type SweptRow } from '../src/wiki/inbox'
import type { InboxMessage } from '../src/wiki/model'
import { takeSnapshot, type Reader } from '../src/wiki/snapshot'

const NOW = Date.parse('2026-11-02T08:00:00Z')

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  inbox: 'user', id: '20261102-073405-pull-the-promotions-tab', path: 'inboxes/user/20261102-073405-pull-the-promotions-tab.md', jobAsk: false, job: null,
  subject: 'Pull the Promotions tab?', at: '2026-11-02T07:34:05Z', seen: false, done: false, replyTo: 'improve', inReplyTo: null, readable: true, ...over,
})

describe('the inbox verbs', () => {
  it('lists one inbox, every machine’s, under the read floor', () => {
    expect(VERBS['wiki.inboxes.ls']({ wiki: 'kb', name: 'user' })).toEqual(['wiki', '--read-only', 'kb', 'inboxes', 'ls', 'user', '--all', '--json'])
    expect(VERBS['wiki.page.held']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'filter=under:sources', 'filter=lever:ingest=hold', '--json'])
    expect(VERBS['wiki.page.heldRoots']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'filter=under:sources', 'filter=prop:ops.root', 'filter=lever:ingest=hold', '--json'])
    expect(VERBS['wiki.inboxes.conflicts']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'inboxes', 'ls', 'conflicts', '--all', '--json'])
    expect(childEnv({ LLM_WIKI_PERMISSIONS: 'write' }, 'wiki.inboxes.ls').LLM_WIKI_PERMISSIONS).toBe('read')
  })
  it('reads, removes and sweeps as writes, and refuses a name that is not one', () => {
    expect(VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: 'a-1' })).toEqual(['wiki', 'kb', 'inboxes', 'read', 'user', 'a-1', '--json'])
    expect(VERBS['wiki.inboxes.rm']({ wiki: 'kb', name: 'user', id: 'a-1' })).toEqual(['wiki', 'kb', 'inboxes', 'rm', 'user', 'a-1', '--json'])
    expect(VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: 'user' })).toEqual(['wiki', 'kb', 'inboxes', 'sweep', 'user', '--json'])
    expect(VERBS['wiki.inboxes.done']({ wiki: 'kb', name: 'user', id: 'a-1' })).toEqual(['wiki', 'kb', 'inboxes', 'done', 'user', 'a-1', '--json'])
    expect(VERBS['wiki.inboxes.done']({ wiki: 'kb', name: 'user', id: 'a-1', answered: true })).toEqual(['wiki', 'kb', 'inboxes', 'done', 'user', 'a-1', '--answered', '--json'])
    for (const v of ['wiki.inboxes.read', 'wiki.inboxes.rm', 'wiki.inboxes.done', 'wiki.inboxes.sweep'] as const) expect(childEnv({ LLM_WIKI_PERMISSIONS: 'read' }, v).LLM_WIKI_PERMISSIONS).toBeUndefined()
    expect(() => VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: '../x' })).toThrow(CliError)
    expect(() => VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: '-rf' })).toThrow(CliError)
    expect(() => VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: 'User/..' })).toThrow(CliError)
    // The CLI's own name rule: a leading digit is a name, an underscore is not.
    expect(VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: '2fa-codes' })).toContain('2fa-codes')
    expect(() => VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: 'calendar_event' })).toThrow(CliError)
  })
})

describe('inbox answers into the model', () => {
  it('reads seen, done, reply_to, the job and the CLI\'s path off an `inboxes ls` row', () => {
    const row = { id: 'a-1', subject: 'Hi', at: '2026-11-02T07:00:00Z', state: 'seen 2026-11-02T07:10:00Z', done: true, reply_to: 'improve', in_reply_to: null, readable: true, path: 'inboxes/user/20261102-hi-renamed.md' }
    const m = messageOf('user', row)
    expect(m).toEqual({ inbox: 'user', id: 'a-1', path: 'inboxes/user/20261102-hi-renamed.md', jobAsk: false, job: null, subject: 'Hi', at: '2026-11-02T07:00:00Z', seen: true, done: true, replyTo: 'improve', inReplyTo: null, readable: true })
    expect(messageAt([m], 'inboxes/user/20261102-hi-renamed.md')).toBe(m)
    expect(messageAt([m], 'inboxes/user/a-1.md')).toBeUndefined()
    // An older CLI names no path: the file it never renamed.
    expect(messageOf('user', { id: 'b', state: 'new' })).toMatchObject({ path: messagePath({ inbox: 'user', id: 'b' }), subject: 'b', seen: false, done: false, replyTo: null })
    // A job ask is filed from a landing ticket with no reply_to; the slug only names it.
    expect(messageOf('user', { id: 'c', ticket: 't-1', slug: 'inbox-joe' })).toMatchObject({ jobAsk: true, job: 'inbox-joe' })
    expect(messageOf('user', { id: 'c', ticket: 't-1' })).toMatchObject({ jobAsk: true, job: null })
    expect(messageOf('user', { id: 'c', slug: 'inbox-joe' })).toMatchObject({ jobAsk: false, job: null })
    expect(messageOf('user', { id: 'd', ticket: 't-1', slug: 'inbox-joe', reply_to: 'improve' })).toMatchObject({ jobAsk: false, job: null })
  })
  it('groups held pages under the nearest root, the root\'s own page in its group, loose pages last', () => {
    const groups = heldGroups(
      ['sources/Lone memo.md', 'sources/acme/README.md', 'sources/acme/a.md', 'sources/acme/q3/README.md', 'sources/acme/q3/b.md', 'sources/acme-other/c.md'],
      ['sources/acme/README.md', 'sources/acme/q3/README.md'],
    )
    const page = (path: string, waiting = false) => ({ path, waiting })
    expect(groups).toEqual([
      { root: 'sources/acme/README.md', pages: [page('sources/acme/README.md'), page('sources/acme/a.md')] },
      { root: 'sources/acme/q3/README.md', pages: [page('sources/acme/q3/README.md'), page('sources/acme/q3/b.md')] },
      { root: null, pages: [page('sources/Lone memo.md'), page('sources/acme-other/c.md')] },
    ])
    expect(heldGroups([], [])).toEqual([])
    // A root holding no held page is no group; a root held alone is one; a counted page is marked.
    expect(heldGroups(['sources/x/README.md', 'sources/y/a.md'], ['sources/x/README.md', 'sources/y/README.md', 'sources/z/README.md'], new Set(['sources/y/a.md'])))
      .toEqual([{ root: 'sources/x/README.md', pages: [page('sources/x/README.md')] }, { root: 'sources/y/README.md', pages: [page('sources/y/a.md', true)] }])
  })
  it('says what the sweep did to the message pressed, and counts the others', () => {
    const m = msg()
    const row = (over: Partial<SweptRow>): SweptRow => ({ id: m.id, action: 'forwarded', to: 'improve', reply_id: 're-1', reason: null, ...over })
    expect(sweptSentence({ swept: [row({})] }, m)).toEqual({ ok: true, message: 'Replied to “Pull the Promotions tab?”: your answer went to improve' })
    expect(sweptSentence({ swept: [row({}), row({ id: 'other', action: 'removed' })] }, m).message).toMatch(/and 1 other answered message\)$/)
    expect(sweptSentence({ swept: [row({ action: 'repeat' })] }, m).ok).toBe(true)
    expect(sweptSentence({ swept: [row({ action: 'refused', reason: 'inbox improve is not declared' })] }, m)).toEqual({ ok: false, message: '“Pull the Promotions tab?” stays in the inbox: inbox improve is not declared' })
    expect(sweptSentence({ swept: [] }, m).ok).toBe(false)
  })
  it('says what `inboxes done` did, a job ask included, and what Done will do before it is pressed', () => {
    const m = msg()
    expect(closedSentence({ action: 'forwarded', to: 'improve' }, m)).toEqual({ ok: true, message: 'Replied to “Pull the Promotions tab?”: your answer went to improve' })
    expect(closedSentence({ action: 'kept' }, m)).toEqual({ ok: true, message: 'Answered “Pull the Promotions tab?”: the job picks it up next run' })
    expect(closedSentence({ action: 'removed' }, m).message).toMatch(/removed from the inbox/)
    expect(closedSentence({ action: 'archived' }, m)).toEqual({ ok: true, message: '“Pull the Promotions tab?” is done; your answer is kept in the inbox\'s archive' })
    expect(closedSentence({}, m).ok).toBe(false)
    expect(doneWords(msg())).toBe('Done sends your answer to improve')
    expect(doneWords(msg({ replyTo: null }))).toBe('Done removes it')
    expect(doneWords(msg({ replyTo: null }), true)).toBe('Done archives your answer')
    expect(doneWords(msg({ replyTo: null }), true, false)).toBe('Done deletes your answer: this CLI cannot archive it')
    expect(doneWords(msg({ replyTo: null }), false, false)).toBe('Done removes it')
    expect(doneWords(msg({ replyTo: null, jobAsk: true, job: 'inbox-joe' }), true)).toBe('Done answers job inbox-joe: it picks the answer up next run')
    expect(doneWords(msg({ replyTo: null, jobAsk: true }))).toBe('Done answers the job: it picks the answer up next run')
  })
  it('counts messages and listed items in the Inbox badge, never curate groups', () => {
    const parts = { held: [{ path: 's/a.md', id: 'a' }], curate: [{ reason: 'draft', directory: 's/n' }, { reason: 'draft', directory: 's/m' }], conflicts: [{ id: 'c', subject: 'c' }] }
    const blocked = [{ job: 'j', reason: 'r', next: 'n' }]
    expect(inboxCount({ inbox: [msg(), msg({ id: 'x', done: true })], parts, blocked, conflicts: null })).toBe(4)
    expect(inboxCount({ inbox: [msg()], parts: null, blocked: [], conflicts: [msg({ inbox: 'conflicts' })] })).toBe(2)
    // A page whose update did not merge is listed, so it is counted (0.15, `page_conflicts`).
    expect(inboxCount({ inbox: [], parts: { ...parts, page_conflicts: [{ id: 'm-1', page: 'sources/j/a.md' }] }, blocked: [], conflicts: null })).toBe(3)
  })
  it('finds the job\'s version of a conflicted page beside it, in _versions/', () => {
    expect(incomingPath('sources/blackboard/cis101/lecture1.md')).toBe('sources/blackboard/cis101/_versions/lecture1.incoming.md')
    expect(incomingPath('top.md')).toBe('_versions/top.incoming.md')
  })
  it('raises one Overview row for the messages and one for the count, both opening the inbox', () => {
    expect(inboxAttention([], 0)).toEqual([])
    expect(inboxAttention(null, null)).toEqual([])
    const rows = inboxAttention([msg(), msg({ id: 'b', subject: 'Second' }), msg({ id: 'c', done: true })], 3)
    expect(rows.map((r) => [r.id, r.title, r.severity])).toEqual([
      ['inbox:user', '2 messages wait for your answer', 'warn'],
      ['inbox:needs-you', '3 things wait on your judgment', 'warn'],
    ])
    expect(rows[0]?.detail).toBe('“Pull the Promotions tab?”, “Second”')
    // With the breakdown, the detail names only the kinds there are.
    const parts = { held: [], curate: [{ reason: 'draft', directory: 's/n' }], conflicts: [] }
    expect(inboxAttention([], 2, parts, [{ job: 'j', reason: 'r', next: 'n' }])[0]?.detail).toBe('1 blocked job, 1 group of new pages.')
    expect(inboxAttention([], 2, { ...parts, curate: [], held: [{ path: 'a', id: 'a' }, { path: 'b', id: 'b' }] })[0]?.detail).toBe('2 held sources; held sources and conflicts are answered with /brain:ingest.')
    expect(inboxAttention([], 1, { held: [], curate: [], conflicts: [], page_conflicts: [{ id: 'm-1', page: 'sources/j/a.md' }] })[0]?.detail).toBe('1 page whose update did not merge.')
    expect(rows.every((r) => r.action?.kind === 'goto' && r.action.tab === 'inbox')).toBe(true)
  })
})

/** Records each verb it was asked, and answers from the table. */
function reader(given: Partial<Record<Verb, unknown>>, calls: { verb: Verb; args?: Args }[] = []): Reader {
  const answers: Partial<Record<Verb, unknown>> = { 'wiki.jobs.check': { jobs: [] }, 'wiki.page.updatesWaiting': { pages: [] }, ...given }
  return {
    run<T>(verb: Verb, args?: Args): Promise<T> {
      calls.push({ verb, args })
      if (answers[verb] === undefined) return Promise.reject(new Error(`${verb}: refused`))
      const a = answers[verb]
      return Promise.resolve((typeof a === 'function' ? (a as (x?: Args) => unknown)(args) : a) as T)
    },
  }
}

const QUIET: Partial<Record<Verb, unknown>> = {
  'wiki.doctor': { rows: [] }, 'wiki.jobs.ls': { jobs: [] }, 'wiki.jobs.due': { parked: [], review: [], handoffs: { problems: [] } }, 'wiki.tickets.ls': { tickets: [] },
  'wiki.page.ls': { pages: [] }, 'wiki.op.since': { runs: [] }, 'wiki.search.status': {}, 'wiki.git.conflicts': { pages: [] }, 'machine.runner.ls': { wikis: [] },
  'wiki.status': { machine: 'mac', git: { dirty: 0, untracked: 0, unpushed: 0, behind: 0 }, peers: [] }, 'wiki.git.log': { commits: [] }, 'wiki.git.status': { files: [] },
  'wiki.skills.ls': { skills: [] }, 'wiki.skills.doctor': { findings: [] }, 'wiki.packages.ls': { this_wiki: [] }, 'wiki.credentials.ls': { rows: [] }, 'wiki.credentials.bindings': { skills: [], jobs: [] },
}

describe('takeSnapshot: the inbox and what needs you', () => {
  it('reads the user inbox and the count, and nothing more while the count is zero', async () => {
    const calls: { verb: Verb; args?: Args }[] = []
    const snap = await takeSnapshot(reader({
      ...QUIET,
      'wiki.whereami': { needs_you: 0 },
      'wiki.page.held': { pages: [] },
      'wiki.page.heldRoots': { pages: [] },
      'wiki.inboxes.ls': { inbox: 'user', count: 2, messages: [
        { id: 'b', subject: 'Later', at: '2026-11-02T07:40:00Z', state: 'new', done: false, reply_to: null },
        { id: 'a', subject: 'Earlier', at: '2026-11-02T07:30:00Z', state: 'new', done: false, reply_to: 'improve' },
      ] },
    }, calls), 'kb', NOW)
    expect(snap.errors).toEqual({})
    expect(snap.inbox?.map((m) => m.id)).toEqual(['a', 'b'])
    expect(snap.needsYou).toBe(0)
    expect(snap.inboxDone).toBe(false)
    expect(snap.blocked).toEqual([])
    expect(snap.conflicts).toBeNull()
    expect(calls.filter((c) => c.verb === 'wiki.inboxes.ls').map((c) => c.args?.name)).toEqual(['user'])
    expect(calls.some((c) => c.verb === 'wiki.inboxes.conflicts')).toBe(false)
    // A full pass reads the held sources whatever the count: one held with no record is still shown, as held.
    expect(calls.filter((c) => c.verb === 'wiki.page.held' || c.verb === 'wiki.page.heldRoots')).toHaveLength(2)
    expect(snap.attention.map((a) => a.id)).toEqual(['inbox:user'])
    expect(snap.health).toEqual({ tone: 'warn', count: 1 })
  })
  it('reads the parts, the blocked jobs and the open conflicts when the count is above zero, and marks what it counts', async () => {
    const snap = await takeSnapshot(reader({
      ...QUIET,
      'wiki.doctor': { rows: [{ check: 'git', status: 'fail', detail: 'broken', fix: null }] },
      'wiki.whereami': {
        needs_you: 3,
        needs_you_parts: { held: [{ path: 'sources/acme/a.md', id: 'src-a' }], curate: [], conflicts: [{ id: 'c-1', subject: 'Launch date' }] },
        blocked: [{ job: 'inbox-joe', reason: 'credential refused', next: 'llm-wiki-ops jobs resume inbox-joe' }],
      },
      'wiki.inboxes.ls': { inbox: 'user', messages: [] },
      'wiki.inboxes.conflicts': { inbox: 'conflicts', messages: [{ id: 'c-1', subject: 'Launch date: 12-01 vs 11-15', at: '2026-11-02T07:35:52Z', state: 'new', done: false, path: 'inboxes/conflicts/c-1.md' }] },
      'wiki.page.held': { pages: [{ path: 'sources/acme/README.md' }, { path: 'sources/acme/a.md' }, { path: 'sources/acme/b.md' }, { path: 'sources/memo.md' }] },
      'wiki.page.heldRoots': { pages: [{ path: 'sources/acme/README.md' }] },
    }), 'kb', NOW)
    expect(snap.errors).toEqual({})
    expect(snap.inboxDone).toBe(true)
    expect(snap.held).toEqual([
      { root: 'sources/acme/README.md', pages: [{ path: 'sources/acme/README.md', waiting: false }, { path: 'sources/acme/a.md', waiting: true }, { path: 'sources/acme/b.md', waiting: false }] },
      { root: null, pages: [{ path: 'sources/memo.md', waiting: false }] },
    ])
    expect(snap.blocked.map((b) => b.job)).toEqual(['inbox-joe'])
    expect(snap.conflicts?.map((c) => [c.inbox, c.id, c.path])).toEqual([['conflicts', 'c-1', 'inboxes/conflicts/c-1.md']])
    expect(inboxCount(snap)).toBe(3)
    // An error still leads; the count follows it among the warnings.
    expect(snap.attention.map((a) => a.id)).toEqual(['doctor:git', 'inbox:needs-you'])
    expect(snap.health).toEqual({ tone: 'error', count: 2 })
  })
  it('a failed conflicts read is named apart from the inbox', async () => {
    const snap = await takeSnapshot(reader({ ...QUIET, 'wiki.whereami': { needs_you: 1 }, 'wiki.inboxes.ls': { messages: [] }, 'wiki.page.held': { pages: [] }, 'wiki.page.heldRoots': { pages: [] } }), 'kb', NOW)
    expect(Object.keys(snap.errors)).toEqual(['wiki.inboxes.conflicts'])
    expect(snap.inbox).toEqual([])
  })
  it('a CLI before the count, or with no inbox to read, leaves both unknown and says so', async () => {
    const snap = await takeSnapshot(reader({ ...QUIET, 'wiki.whereami': { wiki: {} } }), 'kb', NOW)
    expect(snap.needsYou).toBeNull()
    expect(snap.inbox).toBeNull()
    expect(Object.keys(snap.errors).sort()).toEqual(['wiki.inboxes.ls', 'wiki.page.held', 'wiki.page.heldRoots'])
    expect(snap.attention).toEqual([])
    expect(snap.parts).toBeNull()
  })
})

/** A vault holding one message, the note open in an editor, and the writes made, in order. */
function fakeApp(path: string, opts: { tickFails?: boolean; body?: string } = {}) {
  const did: string[] = []
  const fm: Record<string, unknown> = { done: false }
  const view = Object.assign(Object.create(MarkdownView.prototype) as object, { file: { path }, save: () => { did.push('save'); return Promise.resolve() } })
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === path ? new TFile() : null),
      read: () => Promise.resolve(`---\ndone: false\n---\n${opts.body ?? 'Which one?\n'}`),
    },
    workspace: { getLeavesOfType: () => [{ view }] },
    fileManager: {
      processFrontMatter: (_f: unknown, fn: (x: Record<string, unknown>) => void) => {
        if (opts.tickFails) return Promise.reject(new Error('locked'))
        fn(fm)
        did.push(`tick done=${String(fm.done)}`)
        return Promise.resolve()
      },
    },
  }
  const actions = {
    doneMessage: (m: InboxMessage, answered = false) => { did.push(`done ${m.inbox} ${m.id}${answered ? ' --answered' : ''}`); return Promise.resolve({ ok: true, message: 'closed' }) },
    removeMessage: (m: InboxMessage) => { did.push(`rm ${m.id}`); return Promise.resolve({ ok: true, message: 'removed' }) },
    sweepInbox: (m: InboxMessage) => { did.push(`sweep ${m.inbox}`); return Promise.resolve({ ok: true, message: 'swept' }) },
  }
  return { app: app as never, actions: actions as unknown as Actions, did }
}

describe('Done', () => {
  it('saves the open note, then one `inboxes done`: the answer typed there goes with it, and nothing is ticked by hand', async () => {
    for (const m of [msg(), msg({ replyTo: null }), msg({ replyTo: null, jobAsk: true, job: 'inbox-joe' })]) {
      const { app, actions, did } = fakeApp(m.path)
      expect(await closeMessage(app, actions, m, true, { baseline: 'Which one?\n' })).toEqual({ ok: true, message: 'closed' })
      expect(did).toEqual(['save', `done user ${m.id}`])
    }
  })
  it('a saved body that differs from what the CLI read is an answer: --answered, wherever it was typed', async () => {
    const m = msg({ replyTo: null })
    const typed = fakeApp(m.path, { body: 'Which one?\n\nThe blue one.\n' })
    await closeMessage(typed.app, typed.actions, m, true, { baseline: 'Which one?\n' })
    expect(typed.did).toEqual(['save', `done user ${m.id} --answered`])
    // No baseline to tell by: the CLI is told an answer may be there, so nothing typed is deleted.
    const unknown = fakeApp(m.path)
    await closeMessage(unknown.app, unknown.actions, m, true)
    expect(unknown.did).toEqual(['save', `done user ${m.id} --answered`])
  })
  it('an older CLI asks before `inboxes rm` deletes a typed answer, and keeps the message on no', async () => {
    const m = msg({ replyTo: null })
    const asked: string[] = []
    const no = fakeApp(m.path, { body: 'Which one?\nMine.\n' })
    const out = await closeMessage(no.app, no.actions, m, false, { baseline: 'Which one?\n', confirmDelete: () => { asked.push('ask'); return Promise.resolve(false) } })
    expect(out.ok).toBe(false)
    expect(no.did).toEqual(['save'])
    const yes = fakeApp(m.path, { body: 'Which one?\nMine.\n' })
    await closeMessage(yes.app, yes.actions, m, false, { baseline: 'Which one?\n', confirmDelete: () => { asked.push('ask'); return Promise.resolve(true) } })
    expect(yes.did).toEqual(['save', `rm ${m.id}`])
    expect(asked).toEqual(['ask', 'ask'])
  })
  it('an older CLI, with a reply_to: saves the open note, ticks done, then sweeps', async () => {
    const m = msg()
    const { app, actions, did } = fakeApp(m.path)
    expect(await closeMessage(app, actions, m, false)).toEqual({ ok: true, message: 'swept' })
    expect(did).toEqual(['save', 'tick done=true', 'sweep user'])
  })
  it('an older CLI, already ticked in the note: only the sweep', async () => {
    const m = msg({ done: true })
    const { app, actions, did } = fakeApp(m.path)
    await closeMessage(app, actions, m, false)
    expect(did).toEqual(['save', 'sweep user'])
  })
  it('an older CLI, with nowhere to send an answer and none typed: the note saved, then one `inboxes rm`, no tick, no question', async () => {
    const m = msg({ replyTo: null })
    const { app, actions, did } = fakeApp(m.path)
    await closeMessage(app, actions, m, false, { baseline: 'Which one?\n', confirmDelete: () => Promise.reject(new Error('asked')) })
    expect(did).toEqual(['save', `rm ${m.id}`])
  })
  it('a tick that fails sweeps nothing', async () => {
    const m = msg()
    const { app, actions, did } = fakeApp(m.path, { tickFails: true })
    const out = await closeMessage(app, actions, m, false)
    expect(out.ok).toBe(false)
    expect(did).toEqual(['save'])
  })
})
