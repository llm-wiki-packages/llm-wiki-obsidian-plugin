import { MarkdownView, TFile } from 'obsidian'
import { describe, expect, it } from 'vitest'
import { closeMessage } from '../src/views/dashboard/inbox'
import type { Actions } from '../src/wiki/actions'
import { childEnv, CliError, VERBS, type Args, type Verb } from '../src/wiki/cli'
import { heldGroups, inboxAttention, messageAt, messageOf, messagePath, sweptSentence, type SweptRow } from '../src/wiki/inbox'
import type { InboxMessage } from '../src/wiki/model'
import { takeSnapshot, type Reader } from '../src/wiki/snapshot'

const NOW = Date.parse('2026-11-02T08:00:00Z')

const msg = (over: Partial<InboxMessage> = {}): InboxMessage => ({
  inbox: 'user', id: '20261102-073405-pull-the-promotions-tab', subject: 'Pull the Promotions tab?', at: '2026-11-02T07:34:05Z',
  seen: false, done: false, replyTo: 'improve', inReplyTo: null, readable: true, ...over,
})

describe('the inbox verbs', () => {
  it('lists one inbox, every machine’s, under the read floor', () => {
    expect(VERBS['wiki.inboxes.ls']({ wiki: 'kb', name: 'user' })).toEqual(['wiki', '--read-only', 'kb', 'inboxes', 'ls', 'user', '--all', '--json'])
    expect(VERBS['wiki.page.held']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'filter=under:sources', 'filter=lever:ingest=hold', '--json'])
    expect(VERBS['wiki.page.heldRoots']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'filter=prop:root', 'filter=lever:ingest=hold', '--json'])
    expect(childEnv({ LLM_WIKI_PERMISSIONS: 'write' }, 'wiki.inboxes.ls').LLM_WIKI_PERMISSIONS).toBe('read')
  })
  it('reads, removes and sweeps as writes, and refuses a name that is not one', () => {
    expect(VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: 'a-1' })).toEqual(['wiki', 'kb', 'inboxes', 'read', 'user', 'a-1', '--json'])
    expect(VERBS['wiki.inboxes.rm']({ wiki: 'kb', name: 'user', id: 'a-1' })).toEqual(['wiki', 'kb', 'inboxes', 'rm', 'user', 'a-1', '--json'])
    expect(VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: 'user' })).toEqual(['wiki', 'kb', 'inboxes', 'sweep', 'user', '--json'])
    for (const v of ['wiki.inboxes.read', 'wiki.inboxes.rm', 'wiki.inboxes.sweep'] as const) expect(childEnv({ LLM_WIKI_PERMISSIONS: 'read' }, v).LLM_WIKI_PERMISSIONS).toBeUndefined()
    expect(() => VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: '../x' })).toThrow(CliError)
    expect(() => VERBS['wiki.inboxes.read']({ wiki: 'kb', name: 'user', id: '-rf' })).toThrow(CliError)
    expect(() => VERBS['wiki.inboxes.sweep']({ wiki: 'kb', name: 'User/..' })).toThrow(CliError)
  })
})

describe('inbox answers into the model', () => {
  it('reads seen, done and reply_to off an `inboxes ls` row, and finds a message by its vault path', () => {
    const row = { id: 'a-1', subject: 'Hi', at: '2026-11-02T07:00:00Z', state: 'seen 2026-11-02T07:10:00Z', done: true, reply_to: 'improve', in_reply_to: null, readable: true }
    const m = messageOf('user', row)
    expect(m).toEqual({ inbox: 'user', id: 'a-1', subject: 'Hi', at: '2026-11-02T07:00:00Z', seen: true, done: true, replyTo: 'improve', inReplyTo: null, readable: true })
    expect(messageOf('user', { id: 'b', state: 'new' })).toMatchObject({ subject: 'b', seen: false, done: false, replyTo: null })
    expect(messagePath(m)).toBe('inboxes/user/a-1.md')
    expect(messageAt([m], 'inboxes/user/a-1.md')).toBe(m)
    expect(messageAt([m], 'wiki/a-1.md')).toBeUndefined()
  })
  it('groups held pages under the nearest root, the root heading its group, loose pages last', () => {
    const groups = heldGroups(
      ['sources/Lone memo.md', 'sources/acme/README.md', 'sources/acme/a.md', 'sources/acme/q3/README.md', 'sources/acme/q3/b.md', 'sources/acme-other/c.md'],
      ['sources/acme/README.md', 'sources/acme/q3/README.md'],
    )
    expect(groups).toEqual([
      { root: 'sources/acme/README.md', pages: ['sources/acme/a.md'] },
      { root: 'sources/acme/q3/README.md', pages: ['sources/acme/q3/b.md'] },
      { root: null, pages: ['sources/Lone memo.md', 'sources/acme-other/c.md'] },
    ])
    expect(heldGroups([], [])).toEqual([])
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
  it('raises one Overview row for the messages and one for the count, both opening the inbox', () => {
    expect(inboxAttention([], 0)).toEqual([])
    expect(inboxAttention(null, null)).toEqual([])
    const rows = inboxAttention([msg(), msg({ id: 'b', subject: 'Second' }), msg({ id: 'c', done: true })], 3)
    expect(rows.map((r) => [r.id, r.title, r.severity])).toEqual([
      ['inbox:user', '2 messages wait for your answer', 'warn'],
      ['inbox:needs-you', '3 things wait on your judgment', 'warn'],
    ])
    expect(rows[0]?.detail).toBe('“Pull the Promotions tab?”, “Second”')
    expect(rows.every((r) => r.action?.kind === 'goto' && r.action.tab === 'inbox')).toBe(true)
  })
})

/** Records each verb it was asked, and answers from the table. */
function reader(answers: Partial<Record<Verb, unknown>>, calls: { verb: Verb; args?: Args }[] = []): Reader {
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
      'wiki.inboxes.ls': { inbox: 'user', count: 2, messages: [
        { id: 'b', subject: 'Later', at: '2026-11-02T07:40:00Z', state: 'new', done: false, reply_to: null },
        { id: 'a', subject: 'Earlier', at: '2026-11-02T07:30:00Z', state: 'new', done: false, reply_to: 'improve' },
      ] },
    }, calls), 'kb', NOW)
    expect(snap.errors).toEqual({})
    expect(snap.inbox?.map((m) => m.id)).toEqual(['a', 'b'])
    expect(snap.needsYou).toBe(0)
    expect(snap.held).toBeNull()
    expect(snap.conflicts).toBeNull()
    expect(calls.filter((c) => c.verb === 'wiki.inboxes.ls').map((c) => c.args?.name)).toEqual(['user'])
    expect(calls.some((c) => c.verb === 'wiki.page.held' || c.verb === 'wiki.page.heldRoots')).toBe(false)
    expect(snap.attention.map((a) => a.id)).toEqual(['inbox:user'])
    expect(snap.health).toEqual({ tone: 'warn', count: 1 })
  })
  it('reads the held sources, their roots and the open conflicts when the count is above zero', async () => {
    const snap = await takeSnapshot(reader({
      ...QUIET,
      'wiki.doctor': { rows: [{ check: 'git', status: 'fail', detail: 'broken', fix: null }] },
      'wiki.whereami': { needs_you: 2 },
      'wiki.inboxes.ls': (a?: Args) => a?.name === 'conflicts'
        ? { inbox: 'conflicts', messages: [{ id: 'c-1', subject: 'Launch date: 12-01 vs 11-15', at: '2026-11-02T07:35:52Z', state: 'new', done: false }] }
        : { inbox: 'user', messages: [] },
      'wiki.page.held': { pages: [{ path: 'sources/acme/README.md' }, { path: 'sources/acme/a.md' }, { path: 'sources/memo.md' }] },
      'wiki.page.heldRoots': { pages: [{ path: 'sources/acme/README.md' }] },
    }), 'kb', NOW)
    expect(snap.errors).toEqual({})
    expect(snap.held).toEqual([{ root: 'sources/acme/README.md', pages: ['sources/acme/a.md'] }, { root: null, pages: ['sources/memo.md'] }])
    expect(snap.conflicts?.map((c) => [c.inbox, c.id])).toEqual([['conflicts', 'c-1']])
    // An error still leads; the count follows it among the warnings.
    expect(snap.attention.map((a) => a.id)).toEqual(['doctor:git', 'inbox:needs-you'])
    expect(snap.health).toEqual({ tone: 'error', count: 2 })
  })
  it('a CLI before the count, or with no inbox to read, leaves both unknown and says so', async () => {
    const snap = await takeSnapshot(reader({ ...QUIET, 'wiki.whereami': { wiki: {} } }), 'kb', NOW)
    expect(snap.needsYou).toBeNull()
    expect(snap.inbox).toBeNull()
    expect(Object.keys(snap.errors)).toEqual(['wiki.inboxes.ls'])
    expect(snap.attention).toEqual([])
  })
})

/** A vault holding one message, the note open in an editor, and the writes made, in order. */
function fakeApp(path: string, opts: { tickFails?: boolean } = {}) {
  const did: string[] = []
  const fm: Record<string, unknown> = { done: false }
  const view = Object.assign(Object.create(MarkdownView.prototype) as object, { file: { path }, save: () => { did.push('save'); return Promise.resolve() } })
  const app = {
    vault: { getAbstractFileByPath: (p: string) => (p === path ? new TFile() : null) },
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
    removeMessage: (m: InboxMessage) => { did.push(`rm ${m.id}`); return Promise.resolve({ ok: true, message: 'removed' }) },
    sweepInbox: (m: InboxMessage) => { did.push(`sweep ${m.inbox}`); return Promise.resolve({ ok: true, message: 'swept' }) },
  }
  return { app: app as never, actions: actions as unknown as Actions, did }
}

describe('Done', () => {
  it('with a reply_to: saves the open note, ticks done, then sweeps', async () => {
    const m = msg()
    const { app, actions, did } = fakeApp(messagePath(m))
    expect(await closeMessage(app, actions, m)).toEqual({ ok: true, message: 'swept' })
    expect(did).toEqual(['save', 'tick done=true', 'sweep user'])
  })
  it('already ticked in the note: only the sweep', async () => {
    const m = msg({ done: true })
    const { app, actions, did } = fakeApp(messagePath(m))
    await closeMessage(app, actions, m)
    expect(did).toEqual(['save', 'sweep user'])
  })
  it('with nowhere to send an answer: one `inboxes rm`, no tick', async () => {
    const m = msg({ replyTo: null })
    const { app, actions, did } = fakeApp(messagePath(m))
    await closeMessage(app, actions, m)
    expect(did).toEqual([`rm ${m.id}`])
  })
  it('a tick that fails sweeps nothing', async () => {
    const m = msg()
    const { app, actions, did } = fakeApp(messagePath(m), { tickFails: true })
    const out = await closeMessage(app, actions, m)
    expect(out.ok).toBe(false)
    expect(did).toEqual(['save'])
  })
})
