import { describe, expect, it } from 'vitest'
import { childEnv, CliError, VERBS, type Args, type Verb } from '../src/wiki/cli'
import { destAttention, destChecks, heldAttention, heldCountsOf, heldSentence, renamedDests, repointTo, STAMP_FIX } from '../src/wiki/dest'
import { inboxAttention, inboxCount, updatesOnly } from '../src/wiki/inbox'
import type { JobView } from '../src/wiki/model'
import { takeSnapshot, type Reader } from '../src/wiki/snapshot'

const NOW = Date.parse('2026-11-08T08:00:00Z')

/** `jobs check --json` rows as `OPS/commands/jobs/check.py` builds them (llm-wiki-ops 0.15, run on a bench wiki). */
const CHECK = {
  jobs: [
    { slug: 'acme-blog', dest: 'sources/web/acme', state: 'renamed', why: "none of its 4 page(s) sit under 'sources/web/acme'; they sit under 'sources/acme'", inside: 0, outside: 4, folders: ['sources/acme'], next: 'llm-wiki-ops jobs edit acme-blog dest=sources/acme', overlaps: [] },
    { slug: 'news', dest: 'sources/news', state: 'scattered', why: "none of its 3 page(s) sit under 'sources/news'; they sit in 2 folders (sources/a, sources/b)", inside: 0, outside: 3, folders: ['sources/a', 'sources/b'], next: 'llm-wiki-ops jobs edit news dest=sources/a', overlaps: [] },
    { slug: 'mail', dest: 'sources/mail', state: 'moved-out', why: "1 of its pages sit outside 'sources/mail', which keeps 5", inside: 5, outside: 1, folders: ['wiki'], next: null, overlaps: [] },
    { slug: 'ops-hourly', dest: '', state: 'ok', why: "0 page(s) under ''", inside: 0, outside: 0, folders: [], next: null, overlaps: [] },
    { slug: 'fresh', dest: 'sources/fresh', state: 'fresh', why: 'no pages yet', inside: 0, outside: 0, folders: [], next: null, overlaps: [] },
  ],
}

const jobs = [{ slug: 'acme-blog', name: 'Acme engineering blog' }] as JobView[]

describe('the dest verbs', () => {
  it('reads jobs check and the updates waiting under the read floor', () => {
    expect(VERBS['wiki.jobs.check']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'jobs', 'check', '--json'])
    expect(VERBS['wiki.page.updatesWaiting']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'filter=prop:ops.updates_waiting', '--json'])
    expect(childEnv({}, 'wiki.jobs.check').LLM_WIKI_PERMISSIONS).toBe('read')
  })
  it('re-points with --confirm after the verb path, marked attended, and refuses a dest that is not a vault folder', () => {
    expect(VERBS['wiki.jobs.repoint']({ wiki: 'kb', slug: 'acme-blog', dest: 'sources/acme' })).toEqual(['wiki', 'kb', 'jobs', 'edit', '--confirm', 'acme-blog', 'dest=sources/acme', '--json'])
    expect(VERBS['wiki.jobs.repoint']({ wiki: 'kb', slug: 'acme-blog', dest: 'sources/acme/' })).toContain('dest=sources/acme')
    const env = childEnv({ LLM_WIKI_PERMISSIONS: 'read' }, 'wiki.jobs.repoint')
    expect(env.LLM_WIKI_PERMISSIONS).toBeUndefined()
    expect(env.LLM_WIKI_SESSION_ATTENDED).toBe('1')
    for (const dest of ['', '/', '/abs', '../up', 'sources/../..', '-flag', 'a\nb'])
      expect(() => VERBS['wiki.jobs.repoint']({ wiki: 'kb', slug: 'acme-blog', dest } as Args)).toThrow(CliError)
    expect(() => VERBS['wiki.jobs.repoint']({ wiki: 'kb', slug: '../x', dest: 'sources/a' })).toThrow(CliError)
  })
})

describe('jobs check into the model', () => {
  const checks = destChecks(CHECK)
  it('keeps each row, and reads an unknown state as ok', () => {
    expect(checks.map((c) => c.state)).toEqual(['renamed', 'scattered', 'moved-out', 'ok', 'fresh'])
    expect(destChecks({ jobs: [{ slug: 'x', state: 'sideways' }] })[0]).toMatchObject({ state: 'ok', dest: '', folders: [], next: null })
  })
  it('offers a click only where every page left for one folder', () => {
    expect(checks.map(repointTo)).toEqual(['sources/acme', null, null, null, null])
  })
  it('a renamed job is a Needs-you row with Re-point; a scattered one shows the command and asks the agent; moved-out is information', () => {
    const rows = destAttention(checks, jobs)
    expect(rows.map((r) => [r.id, r.severity])).toEqual([['dest:acme-blog', 'warn'], ['dest:news', 'warn'], ['dest:mail', 'info']])
    expect(rows[0]).toMatchObject({ title: 'Acme engineering blog: its folder moved to sources/acme', fix: 'llm-wiki-ops jobs edit acme-blog dest=sources/acme', action: { kind: 'repoint', slug: 'acme-blog', from: 'sources/web/acme', dest: 'sources/acme' } })
    expect(rows[1]).toMatchObject({ title: 'news: its pages left sources/news', fix: 'llm-wiki-ops jobs edit news dest=sources/a', action: { kind: 'ask' } })
    expect(destAttention(null, jobs)).toEqual([])
  })
  it('matches a renamed folder to the jobs whose dest was it or sat under it, never a sibling that shares a prefix', () => {
    expect(renamedDests('sources/web/acme', 'sources/acme', checks)).toEqual([{ slug: 'acme-blog', from: 'sources/web/acme', dest: 'sources/acme' }])
    expect(renamedDests('sources/web', 'sources/blogs', checks)).toEqual([{ slug: 'acme-blog', from: 'sources/web/acme', dest: 'sources/blogs/acme' }])
    expect(renamedDests('sources/new', 'sources/x', checks)).toEqual([])
    expect(renamedDests('sources/news', 'archive/news', checks)).toEqual([{ slug: 'news', from: 'sources/news', dest: 'archive/news' }])
    // A job whose dest is the wiki root follows no folder.
    expect(renamedDests('', 'x', checks)).toEqual([])
    expect(renamedDests('a', 'b', null)).toEqual([])
  })
})

describe('held job pages', () => {
  it('names the statuses a person did not choose, and the stamp repair for unstamped ones', () => {
    expect(heldCountsOf({ unstamped: 463 })).toEqual({ unstamped: 463 })
    expect(heldCountsOf(null)).toBeNull()
    expect(heldCountsOf({ edited: 'x', draft: 0 })).toEqual({})
    expect(heldSentence({ unstamped: 2, edited: 1, settling: 1, conflict: 1, draft: 9 })).toBe('Jobs leave 5 of their pages alone: 1 in conflict, 2 unstamped, 1 edited by you, 1 still being edited')
    expect(heldSentence({ draft: 3, off: 1 })).toBeNull()
    expect(heldSentence({ edited: 1 })).toBe('Jobs leave 1 of their page alone: 1 edited by you')
    const [row] = heldAttention({ unstamped: 2 })
    expect(row).toMatchObject({ id: 'held-pages', severity: 'info', fix: STAMP_FIX, action: { kind: 'ask', label: 'Stamp them' } })
    expect(heldAttention({ edited: 1 })[0]?.fix).toBeUndefined()
    expect(heldAttention(null)).toEqual([])
  })
})

describe('updates waiting', () => {
  const parts = { held: [], curate: [], conflicts: [], page_conflicts: [{ id: 'pc-1', page: 'sources/acme/a.md' }] }
  it('counts the pages no page-conflicts record already lists', () => {
    expect(updatesOnly(['sources/acme/a.md', 'sources/acme/b.md'], parts)).toEqual(['sources/acme/b.md'])
    expect(updatesOnly(null, parts)).toEqual([])
    expect(inboxCount({ inbox: [], parts, blocked: [], conflicts: null, updatesWaiting: ['sources/acme/a.md', 'sources/acme/b.md'] })).toBe(2)
    expect(inboxCount({ inbox: [], parts: null, blocked: [], conflicts: null, updatesWaiting: ['x.md'] })).toBe(1)
  })
  it('the Overview gets a row for them, opening the inbox', () => {
    const rows = inboxAttention([], 1, parts, [], ['sources/acme/a.md', 'sources/acme/b.md'])
    expect(rows.find((r) => r.id === 'inbox:updates-waiting')).toMatchObject({ title: 'A job’s update waits on 1 page you changed', detail: 'b: keep yours, or take the job’s', action: { kind: 'goto', tab: 'inbox' } })
    expect(inboxAttention([], 1, parts, [], ['sources/acme/a.md']).some((r) => r.id === 'inbox:updates-waiting')).toBe(false)
  })
})

const QUIET: Partial<Record<Verb, unknown>> = {
  'wiki.doctor': { rows: [] }, 'wiki.jobs.ls': { jobs: [] }, 'wiki.jobs.due': { parked: [], review: [], handoffs: { problems: [] } }, 'wiki.tickets.ls': { tickets: [] },
  'wiki.page.ls': { pages: [] }, 'wiki.op.since': { runs: [] }, 'wiki.search.status': {}, 'wiki.git.conflicts': { pages: [] }, 'machine.runner.ls': { wikis: [] },
  'wiki.git.log': { commits: [] }, 'wiki.git.status': { files: [] }, 'wiki.whereami': { needs_you: 0, needs_you_parts: { held: [], curate: [], conflicts: [] } },
  'wiki.inboxes.ls': { messages: [] }, 'wiki.page.held': { pages: [] }, 'wiki.page.heldRoots': { pages: [] },
  'wiki.skills.ls': { skills: [] }, 'wiki.skills.doctor': { findings: [] }, 'wiki.packages.ls': { this_wiki: [] }, 'wiki.credentials.list': { rows: [] }, 'wiki.credentials.bindings': { skills: [], jobs: [] },
}

function reader(answers: Partial<Record<Verb, unknown>>, calls: Verb[] = []): Reader {
  return {
    run<T>(verb: Verb): Promise<T> {
      calls.push(verb)
      return answers[verb] === undefined ? Promise.reject(new Error(`${verb}: refused`)) : Promise.resolve(answers[verb] as T)
    },
  }
}

describe('takeSnapshot: dests, updates waiting and held pages', () => {
  const answers = {
    ...QUIET,
    'wiki.jobs.check': CHECK,
    'wiki.page.updatesWaiting': { pages: [{ path: 'sources/acme/b.md' }, { path: 'sources/x.md', unreadable: true }] },
    'wiki.status': { machine: 'mac', git: { dirty: 0, untracked: 0, unpushed: 0, behind: 0 }, peers: [], held: { unstamped: 2, draft: 1 } },
  }
  it('a full read carries all three, and their rows', async () => {
    const snap = await takeSnapshot(reader(answers), 'kb', NOW)
    expect(snap.dests?.map((d) => d.slug)).toEqual(['acme-blog', 'news', 'mail', 'ops-hourly', 'fresh'])
    expect(snap.updatesWaiting).toEqual(['sources/acme/b.md'])
    expect(snap.heldPages).toEqual({ unstamped: 2, draft: 1 })
    expect(snap.attention.map((a) => a.id)).toEqual(expect.arrayContaining(['dest:acme-blog', 'dest:news', 'dest:mail', 'held-pages', 'inbox:updates-waiting']))
    expect(snap.errors).toEqual({})
  })
  it('a light read keeps the last dests and updates and re-reads neither while nothing waits', async () => {
    const none = { ...answers, 'wiki.page.updatesWaiting': { pages: [] } }
    const full = await takeSnapshot(reader(none), 'kb', NOW)
    const calls: Verb[] = []
    const light = await takeSnapshot(reader({ ...none, 'wiki.jobs.check': { jobs: [] } }, calls), 'kb', NOW + 10_000, undefined, full)
    expect(calls).not.toContain('wiki.jobs.check')
    expect(calls).not.toContain('wiki.page.updatesWaiting')
    expect(light.dests).toEqual(full.dests)
    expect(light.updatesWaiting).toEqual([])
    // One known, and the light read asks again: it may have been resolved elsewhere.
    const withOne = await takeSnapshot(reader(answers), 'kb', NOW)
    const again: Verb[] = []
    await takeSnapshot(reader(answers, again), 'kb', NOW + 10_000, undefined, withOne)
    expect(again).toContain('wiki.page.updatesWaiting')
  })
  it('a CLI without the verbs leaves them unknown, and says so', async () => {
    const { ['wiki.jobs.check']: _c, ['wiki.page.updatesWaiting']: _u, ...older } = answers
    const snap = await takeSnapshot(reader({ ...older, 'wiki.status': { machine: 'mac', git: {}, peers: [] } }), 'kb', NOW)
    expect(snap.dests).toBeNull()
    expect(snap.updatesWaiting).toBeNull()
    expect(snap.heldPages).toBeNull()
    expect(Object.keys(snap.errors).sort()).toEqual(['wiki.jobs.check', 'wiki.page.updatesWaiting'])
    expect(snap.errors['wiki.page.updatesWaiting']).toBe('refused')
  })
})

describe('review: updates waiting and renames that move twice', () => {
  const answers = {
    ...QUIET,
    'wiki.jobs.check': CHECK,
    'wiki.status': { machine: 'mac', git: { dirty: 0, untracked: 0, unpushed: 0, behind: 0 }, peers: [] },
    'wiki.whereami': { needs_you: 1, needs_you_parts: { held: [], curate: [], conflicts: [], page_conflicts: [{ id: 'pc-1', page: 'sources/acme/a.md' }] } },
    'wiki.page.updatesWaiting': { pages: [{ path: 'sources/acme/a.md' }] },
  }
  it('a page resolved elsewhere leaves the list on the next light read, never coming back as an update waiting', async () => {
    const full = await takeSnapshot(reader(answers), 'kb', NOW)
    expect(updatesOnly(full.updatesWaiting, full.parts)).toEqual([])
    const resolved = { ...answers, 'wiki.whereami': { needs_you: 0, needs_you_parts: { held: [], curate: [], conflicts: [], page_conflicts: [] } }, 'wiki.page.updatesWaiting': { pages: [] } }
    const calls: Verb[] = []
    const light = await takeSnapshot(reader(resolved, calls), 'kb', NOW + 10_000, undefined, full)
    expect(calls).toContain('wiki.page.updatesWaiting')
    expect(light.updatesWaiting).toEqual([])
    expect(light.attention.some((a) => a.id === 'inbox:updates-waiting')).toBe(false)
  })
  it('a light read keeps a failed updates read named, so the hole does not look healed', async () => {
    const { ['wiki.page.updatesWaiting']: _u, ...failing } = answers
    const full = await takeSnapshot(reader({ ...failing, 'wiki.whereami': { needs_you: 0 } }), 'kb', NOW)
    expect(full.errors['wiki.page.updatesWaiting']).toBe('refused')
    const light = await takeSnapshot(reader({ ...failing, 'wiki.whereami': { needs_you: 0 } }), 'kb', NOW + 10_000, undefined, full)
    expect(light.errors['wiki.page.updatesWaiting']).toBe('refused')
  })
  it('a renamed job whose new folder is moved again follows it; a dest written with a slash still matches', () => {
    const checks = destChecks(CHECK)
    expect(renamedDests('sources/acme', 'sources/blogs/acme', checks)).toEqual([{ slug: 'acme-blog', from: 'sources/web/acme', dest: 'sources/blogs/acme' }])
    const slashed = destChecks({ jobs: [{ slug: 'x', dest: 'sources/x/', state: 'fresh' }] })
    expect(slashed[0]?.dest).toBe('sources/x')
    expect(renamedDests('sources/x', 'sources/y', slashed)).toEqual([{ slug: 'x', from: 'sources/x', dest: 'sources/y' }])
  })
})
