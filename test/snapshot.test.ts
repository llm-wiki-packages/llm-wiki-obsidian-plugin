import { describe, expect, it } from 'vitest'
import type { Args, Verb } from '../src/wiki/cli'
import { jobView, takeSnapshot, type JobRow, type Reader } from '../src/wiki/snapshot'

const NOW = Date.parse('2026-10-23T12:00:00Z')

const job = (over: Partial<JobRow>): JobRow => ({
  slug: 'ops-hourly', description: 'curate what the pipeline has landed, every hour', every: '1h', state: 'active', kind: 'routines',
  window: null, due: false, blocked: null,
  stages: [{ stage: 'routine', skipped: false, failing: [], attempts: 0, ok_started: null }],
  verdict: { due: false, kind: 'period', reasons: ['ran recently'], blocked_by: [], next_at: '2026-10-23T12:40:00Z', last_ok: '2026-10-23T11:40:00Z' },
  running: [],
  ...over,
})

describe('jobView: the Next column in plain words', () => {
  it('reads a scheduled job', () => {
    const v = jobView(job({}), [], NOW)
    expect(v.name).toBe('curate what the pipeline has landed, every hour')
    expect(v.schedule).toBe('every 1h')
    expect(v.next).toEqual({ kind: 'at', at: '2026-10-23T12:40:00Z', detail: 'ran recently' })
    expect(v.last).toEqual({ at: '2026-10-23T11:40:00Z', outcome: 'ok' })
  })
  it('reads due, paused, running, blocked, held and queued', () => {
    expect(jobView(job({ verdict: { due: true, kind: null, reasons: ['never run'], next_at: null } }), [], NOW).next).toEqual({ kind: 'due', detail: 'never run' })
    expect(jobView(job({ state: 'paused', verdict: { due: false, kind: 'paused' } }), [], NOW).next.kind).toBe('paused')
    const r = jobView(job({ running: [{ id: 't1', stage: 'routine', since: '2026-10-23T11:58:00Z', step: { index: 0, name: 'PLUGIN:curate' } }] }), [], NOW)
    expect(r.next.kind).toBe('running')
    expect(r.running).toEqual({ ticket: 't1', stage: 'PLUGIN:curate', since: '2026-10-23T11:58:00Z' })
    expect(jobView(job({ verdict: { due: false, kind: 'requires', blocked_by: ['credential gmail'] } }), [], NOW).next).toEqual({ kind: 'blocked', detail: 'credential gmail' })
    expect(jobView(job({ blocked: 'no search server is configured here' }), [], NOW).next.kind).toBe('blocked')
    const held = jobView(job({}), [{ id: 't2', stage: 'routine', state: 'pending', slug: 'ops-hourly', not_before: '2026-10-23T13:00:00Z', reason: 'killed' }], NOW)
    expect(held.next).toEqual({ kind: 'held', at: '2026-10-23T13:00:00Z', detail: 'killed' })
    expect(jobView(job({}), [{ id: 't3', stage: 'routine', state: 'pending', slug: 'ops-hourly' }], NOW).next.kind).toBe('queued')
  })
  it('marks a failing stage as the last outcome and survives an older CLI with no verdict', () => {
    expect(jobView(job({ stages: [{ stage: 'routine', failing: ['devops1'], attempts: 2, ok_started: '2026-10-22T11:00:00Z' }] }), [], NOW).last).toEqual({ at: null, outcome: 'failed' })
    expect(jobView(job({ stages: [{ stage: 'routine', failing: ['devops1'] }] }), [{ id: 'f1', stage: 'routine', state: 'failed', slug: 'ops-hourly', queued_at: '2026-10-23T11:50:00Z' }], NOW).last).toEqual({ at: '2026-10-23T11:50:00Z', outcome: 'failed' })
    const old = jobView({ slug: 'x', every: '1d', state: 'active', due: true }, [], NOW)
    expect(old.next).toMatchObject({ kind: 'due' })
    expect(old.schedule).toBe('every 1d')
  })
})

function reader(answers: Partial<Record<Verb, unknown>>): Reader {
  return {
    run<T>(verb: Verb, _args?: Args): Promise<T> {
      if (!(verb in answers)) return Promise.reject(new Error(`${verb}: refused`))
      if (answers[verb] === undefined) return Promise.reject(new Error(`${verb}: refused`))
      return Promise.resolve(answers[verb] as T)
    },
  }
}

const EMPTY_UNITS: Partial<Record<Verb, unknown>> = {
  'wiki.skills.ls': { skills: [] },
  'wiki.skills.doctor': { findings: [] },
  'wiki.packages.ls': { this_wiki: [] },
  'wiki.credentials.ls': { rows: [] },
  'wiki.credentials.bindings': { skills: [], jobs: [] },
}

/** The scratch wiki of 2026-10-23: channel-gmail enabled, its `file` slot empty, one job on it; the doctor's two sentences about that. */
const GMAIL: Partial<Record<Verb, unknown>> = {
  'wiki.doctor': { rows: [
    { check: 'jobs-skipped', status: 'warn', detail: 'inbox-joe/harvest: harvest requires file and this machine fills none of it', fix: 'llm-wiki-ops credentials bind skill channel-gmail <name>=<credential>' },
    { check: 'bindings', status: 'warn', detail: 'inbox-joe: harvest requires file and this machine fills none of it; channel-gmail: required file unmapped on this machine', fix: 'llm-wiki-ops credentials bind skill <unit> <name>=<credential>' },
  ] },
  'wiki.jobs.ls': { jobs: [job({ slug: 'inbox-joe', description: '', skill: 'channel-gmail', kind: 'pipeline', verdict: { due: true, kind: null, reasons: ['never run'] } })] },
  'wiki.jobs.due': { parked: [], review: [], handoffs: { problems: [] } },
  'wiki.tickets.ls': { tickets: [] },
  'wiki.page.ls': { pages: [] },
  'wiki.op.since': { runs: [] },
  'wiki.search.status': {},
  'wiki.git.conflicts': { pages: [] },
  'machine.runner.ls': { wikis: [] },
  'wiki.skills.ls': { skills: [{ name: 'channel-gmail', state: 'enabled', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', venue: 'gmail', version: '0.1.0', stages: ['harvest', 'process'], drifted: false, outdated: false, next: '/channel-gmail ticket=<id>', warnings: [], mapped: '0/1' }] },
  'wiki.skills.show': { skills: [{ name: 'channel-gmail', state: 'enabled', venue: 'gmail', version: '0.1.0', next: '/channel-gmail ticket=<id>', mapped: '0/1', manifest: { usage: '/channel-gmail ticket=<id>', requires: { credentials: { file: 'required' } }, watch: { inputs: { mailbox: { prompt: 'Which mailbox does this watch pull?', required: true } } } }, enable_notes: 'references/enable.md', usage_notes: 'references/usage.md' }] },
  'wiki.skills.doctor': { findings: [] },
  'wiki.packages.ls': { this_wiki: [{ package: 'llm-wiki-packages/llm-wiki-skills', current: '0.5.0' }] },
  'wiki.packages.show': { shown: '0.5.0', manifest: { artifacts: [{ type: 'skill', name: 'channel-gmail' }, { type: 'skill', name: 'channel-youtube' }, { type: 'skill', name: 'web-page' }] } },
  'wiki.credentials.ls': { rows: [{ name: 'claude_login', kind: 'harness', login: 'hand', state: 'unverified', verified: null }, { name: 'gmail_token', kind: 'value', login: 'none', state: 'unverified', verified: null }] },
  'wiki.credentials.bindings': { skills: [], jobs: [] },
}

describe('takeSnapshot: skills and credentials', () => {
  it('derives the job that cannot run here from the empty slot, in place of the doctor rows about it', async () => {
    const snap = await takeSnapshot(reader(GMAIL), 'kb', NOW)
    expect(snap.errors).toEqual({})
    expect(snap.jobs[0]?.next).toEqual({ kind: 'unbound', detail: 'channel-gmail needs a token or key' })
    expect(snap.jobs[0]?.credential).toEqual({ slot: 'file', name: null, problem: 'missing' })
    expect(snap.attention.map((a) => a.id)).toEqual(['unbound:inbox-joe'])
    expect(snap.attention[0]?.action).toEqual({ kind: 'credential', skill: 'channel-gmail', slot: 'file' })
    expect(snap.health).toEqual({ tone: 'warn', count: 1 })
    const gmail = snap.skills.find((s) => s.name === 'channel-gmail')
    expect(gmail).toMatchObject({ state: 'enabled', usage: '/channel-gmail ticket=<id>', jobs: ['inbox-joe'], slots: [{ name: 'file', required: true, credential: null }], inputs: [{ name: 'mailbox', required: true }], notes: { skill: 'SKILL.md', enable: 'references/enable.md', usage: 'references/usage.md' }, dir: '.llm-wiki/skills/channel-gmail' })
    expect(snap.skills.map((s) => `${s.name}:${s.state}`)).toEqual(['channel-gmail:enabled', 'channel-youtube:available', 'web-page:available'])
    expect(snap.credentials.map((c) => c.name)).toEqual(['claude_login', 'gmail_token'])
  })
  it('clears the job once the skill slot is bound, and names the credential’s uses', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.doctor': { rows: [] }, 'wiki.credentials.bindings': { skills: [{ skill: 'channel-gmail', name: 'file', credential: 'gmail_token', upstream: null, state: 'bound' }], jobs: [] } }), 'kb', NOW)
    expect(snap.jobs[0]?.next.kind).toBe('due')
    expect(snap.attention).toEqual([])
    expect(snap.skills[0]?.slots).toEqual([{ name: 'file', required: true, credential: 'gmail_token' }])
    expect(snap.credentials[1]?.uses).toEqual([{ skill: 'channel-gmail', slot: 'file' }])
  })
  it('keeps the doctor’s own sentence when the manifest is unreadable: no guessed slot, no dialog', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.skills.show': undefined }), 'kb', NOW)
    expect(snap.skills[0]?.slots).toEqual([])
    expect(snap.jobs[0]?.next.kind).toBe('due')
    expect(snap.attention.map((a) => a.id)).toEqual(['doctor:jobs-skipped', 'doctor:bindings'])
  })
  it('a stopped job whose credential went stale gets Replace credential with the retry riding along, once', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.doctor': { rows: [] },
      'wiki.jobs.due': { parked: [{ id: 'p1', job: 'inbox-joe', stage: 'harvest', reason: 'login expired' }], review: [], handoffs: { problems: [] } },
      'wiki.tickets.ls': { tickets: [{ id: 'p1', stage: 'harvest', state: 'failed', slug: 'inbox-joe', reason: 'login expired', queued_at: '2026-10-23T09:00:00Z', runtime_s: 12 }] },
      'wiki.credentials.bindings': { skills: [{ skill: 'channel-gmail', name: 'file', credential: 'gmail_token', state: 'stale' }], jobs: [] } }), 'kb', NOW)
    expect(snap.jobs[0]?.next).toEqual({ kind: 'unbound', detail: 'gmail_token is stale' })
    expect(snap.jobs[0]?.tickets).toEqual([{ id: 'p1', stage: 'harvest', state: 'failed', at: '2026-10-23T09:00:00Z', reason: 'login expired', runtimeS: 12 }])
    expect(snap.attention.map((a) => a.id)).toEqual(['parked:p1'])
    expect(snap.attention[0]).toMatchObject({ title: 'inbox-joe stopped: gmail_token is stale', action: { kind: 'credential', skill: 'channel-gmail', slot: 'file', name: 'gmail_token', retry: 'p1', job: 'inbox-joe' } })
  })
  it('a light read carries the skills, credentials and runner over and re-reads only what moves', async () => {
    const full = await takeSnapshot(reader(GMAIL), 'kb', NOW)
    const seen: string[] = []
    const spy: Reader = { run: (verb, args) => { seen.push(verb); return reader({ ...GMAIL, 'wiki.jobs.ls': { jobs: [job({ slug: 'inbox-joe', skill: 'channel-gmail', state: 'paused', verdict: { due: false, kind: 'paused' } })] } }).run(verb, args) } }
    const light = await takeSnapshot(spy, 'kb', NOW + 10_000, undefined, full)
    expect(seen).not.toContain('wiki.skills.ls')
    expect(seen).not.toContain('wiki.credentials.ls')
    expect(seen).toContain('wiki.jobs.ls')
    expect(light.skills).toHaveLength(full.skills.length)
    expect(light.credentials).toEqual(full.credentials)
    expect(light.jobs[0]?.next.kind).toBe('paused')
    expect(light.skills[0]?.jobs).toEqual(['inbox-joe'])
  })
  it('a light read keeps the skills doctor findings it did not re-read, so the count does not flicker', async () => {
    const withFinding = { ...GMAIL, 'wiki.doctor': { rows: [] }, 'wiki.skills.doctor': { findings: [{ name: 'channel-gmail', level: 'warn', what: 'the enabled copy drifted', fix: null }] } }
    const full = await takeSnapshot(reader(withFinding), 'kb', NOW)
    expect(full.attention.map((a) => a.id)).toContain('skill:channel-gmail')
    const light = await takeSnapshot(reader(withFinding), 'kb', NOW + 10_000, undefined, full)
    expect(light.attention.filter((a) => a.id === 'skill:channel-gmail')).toHaveLength(1)
    expect(light.health.count).toBe(full.health.count)
  })
  it('a credential whose own check failed breaks the slot it fills', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.doctor': { rows: [] },
      'wiki.credentials.ls': { rows: [{ name: 'gmail_token', kind: 'value', state: 'failed' }] },
      'wiki.credentials.bindings': { skills: [{ skill: 'channel-gmail', name: 'file', credential: 'gmail_token', state: 'bound' }], jobs: [] } }), 'kb', NOW)
    expect(snap.skills[0]?.slots).toEqual([{ name: 'file', required: true, credential: 'gmail_token', problem: 'failed' }])
    expect(snap.jobs[0]?.next.kind).toBe('unbound')
  })
  it('reads each unit’s description from its SKILL.md, held units under the wiki and available ones from the package cache, with the package manifest’s needs', async () => {
    const read = async (p: string) => {
      if (p === '/w/.llm-wiki/skills/channel-gmail/SKILL.md') return '---\nname: channel-gmail\ndescription: Gmail capture. More.\n---\n'
      if (p === '/h/.local/share/llm-wiki/packages/cache/llm-wiki-packages/llm-wiki-skills/@abc/skills/channel-youtube/SKILL.md') return '---\ndescription: YouTube capture.\n---\n'
      if (p === '/h/.local/share/llm-wiki/packages/cache/llm-wiki-packages/llm-wiki-skills/@abc/skills/channel-youtube/manifest.json') return JSON.stringify({ requires: { credentials: { dir: 'optional' } }, watch: { inputs: { channel: { prompt: 'Which channel?', required: true } } } })
      throw new Error('no such file')
    }
    const snap = await takeSnapshot(reader({ ...GMAIL,
      'wiki.packages.ls': { this_wiki: [{ package: 'llm-wiki-packages/llm-wiki-skills' }], installed: [{ package: 'llm-wiki-packages/llm-wiki-skills', cache: '~/.local/share/llm-wiki/packages/cache/llm-wiki-packages/llm-wiki-skills' }] },
      'wiki.packages.show': { shown: '0.5.0', shown_ref: 'abc', manifest: { artifacts: [{ type: 'skill', name: 'channel-youtube' }, { type: 'skill', name: 'web-page' }] } },
    }), 'kb', NOW, { root: '/w', home: '/h', read })
    expect(snap.skills.map((s) => [s.name, s.description, s.dir])).toEqual([
      ['channel-gmail', 'Gmail capture.', '/w/.llm-wiki/skills/channel-gmail'],
      ['channel-youtube', 'YouTube capture.', '/h/.local/share/llm-wiki/packages/cache/llm-wiki-packages/llm-wiki-skills/@abc/skills/channel-youtube'],
      ['web-page', '', '/h/.local/share/llm-wiki/packages/cache/llm-wiki-packages/llm-wiki-skills/@abc/skills/web-page'],
    ])
    expect(snap.skills[1]).toMatchObject({ slots: [{ name: 'dir', required: false, credential: null }], inputs: [{ name: 'channel', required: true }] })
  })
  it('names the job a recent run was about when the summary names its slug', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.op.since': { runs: [{ op: 'pass', outcome: 'ok', when: '2026-10-23T11:00:00Z', summary: 'pass ok: inbox-joe harvest, 3 pages' }, { op: 'dream', outcome: 'ok', when: '2026-10-23T10:00:00Z', summary: 'dream ok' }] } }), 'kb', NOW)
    expect(snap.recent.map((r) => r.job)).toEqual(['inbox-joe', undefined])
  })
  it('a stale binding counts as empty, and drift and updates become attention', async () => {
    const snap = await takeSnapshot(reader({ ...GMAIL, 'wiki.doctor': { rows: [] },
      'wiki.skills.ls': { skills: [{ name: 'channel-gmail', state: 'drifted' }] },
      'wiki.skills.show': { skills: [{ name: 'channel-gmail', state: 'drifted', drifted: true, outdated: true, warnings: ['enabled copy differs from the wiki copy'], manifest: { requires: { credentials: { file: 'required' } } } }] },
      'wiki.credentials.bindings': { skills: [{ skill: 'channel-gmail', name: 'file', credential: 'gmail_token', state: 'stale' }], jobs: [] } }), 'kb', NOW)
    expect(snap.jobs[0]?.next.kind).toBe('unbound')
    expect(snap.attention.map((a) => a.id)).toEqual(['unbound:inbox-joe', 'drifted:channel-gmail'])
    expect(snap.credentials[1]?.uses).toEqual([{ skill: 'channel-gmail', slot: 'file', problem: 'stale' }])
  })
})

describe('takeSnapshot', () => {
  it('builds attention from doctor, parked tickets and blocked jobs, and says when there is no runner', async () => {
    const snap = await takeSnapshot(
      reader({
        'wiki.doctor': { overall: 'warn', rows: [{ check: 'manifest', status: 'ok', detail: 'fine', fix: null }, { check: 'jobs-poll', status: 'warn', detail: 'no runner polls this wiki', fix: '`llm-wiki-cli machine runner install kb`' }] },
        'wiki.jobs.ls': { jobs: [job({}), job({ slug: 'gmail', description: 'Gmail inbox', kind: 'pipeline', verdict: { due: false, kind: 'requires', blocked_by: ['credential gmail'] } })], unreadable: [] },
        'wiki.jobs.due': { parked: [{ id: 'p1', job: 'gmail', stage: 'harvest', reason: 'login expired' }], review: [], handoffs: { problems: [] } },
        'wiki.tickets.ls': { tickets: [] },
        'wiki.page.ls': { pages: [{ path: 'sources/web/a.md', status: 'draft', change: 'current' }, { path: 'wiki/n.md', status: null, change: 'new' }, { path: 'sources/web/b.md', status: 'stable', change: 'current' }, { path: 'sources/notes/dropped.md', status: null, change: 'new' }] },
        'wiki.op.since': { runs: [{ op: 'pass', outcome: 'ok', when: '2026-10-23T11:40:00Z', summary: 'pass ok' }] },
        'wiki.search.status': { engine_configured: false, realm_ready: false, serving: 'grep' },
        'wiki.git.conflicts': { pages: [] },
        'machine.runner.ls': { wikis: [] },
        ...EMPTY_UNITS,
      }),
      'kb',
      NOW,
    )
    expect(snap.attention.map((a) => a.id)).toEqual(['doctor:jobs-poll', 'parked:p1', 'blocked:gmail'])
    expect(snap.attention[1]?.action).toEqual({ kind: 'retry', ticket: 'p1', slug: 'gmail' })
    expect(snap.health).toEqual({ tone: 'warn', count: 3 })
    expect(snap.runner).toBe(false)
    expect(snap.curation).toEqual([{ path: 'sources/web/a.md', title: 'a', job: 'web' }])
    expect(snap.unadopted).toEqual([{ path: 'sources/notes/dropped.md', title: 'dropped', job: 'notes' }])
    expect(snap.recent[0]).toMatchObject({ op: 'pass', outcome: 'ok', summary: '' })
    expect(snap.errors).toEqual({})
  })
  it('records a failed read and still answers', async () => {
    const snap = await takeSnapshot(reader({ 'wiki.doctor': { rows: [] } }), 'kb', NOW)
    expect(snap.health).toEqual({ tone: 'ok', count: 0 })
    expect(Object.keys(snap.errors)).toContain('wiki.jobs.ls')
    expect(snap.errors['wiki.jobs.ls']).toBe('refused')
    expect(snap.unadopted).toBeNull()
  })

  it('does not count an info item as needing you, nor a queued ticket as due', async () => {
    const snap = await takeSnapshot(
      reader({
        'wiki.doctor': { rows: [] },
        'wiki.jobs.ls': { jobs: [job({ verdict: { due: true, kind: null } })] },
        'wiki.jobs.due': { parked: [], review: [{ id: 'r1', job: 'ops-hourly', stage: 'routine', reason: null }], handoffs: { problems: [] } },
        'wiki.tickets.ls': { tickets: [{ id: 'r1', stage: 'routine', state: 'pending', slug: 'ops-hourly' }] },
        'wiki.page.ls': { pages: [{ path: 'sources/web/a.md', status: 'stable' }] },
        'wiki.op.since': { runs: [] },
        'wiki.search.status': {},
        'wiki.git.conflicts': { pages: [] },
        'machine.runner.ls': { wikis: [{ wiki_key: 'kb', installed: {} }] },
        ...EMPTY_UNITS,
      }),
      'kb',
      NOW,
    )
    expect(snap.health).toEqual({ tone: 'ok', count: 0 })
    expect(snap.attention.map((a) => a.severity)).toEqual(['info'])
    expect(snap.jobs[0]?.next.kind).toBe('queued')
    expect(snap.runner).toBe(true)
    expect(snap.unadopted).toBeNull()
  })
})
