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
    expect(v.next).toMatchObject({ kind: 'at', text: 'in 40m' })
    expect(v.last).toEqual({ at: '2026-10-23T11:40:00Z', outcome: 'ok' })
  })
  it('reads due, paused, running, blocked, held and queued', () => {
    expect(jobView(job({ verdict: { due: true, kind: null, reasons: ['never run'], next_at: null } }), [], NOW).next).toMatchObject({ kind: 'due', text: 'Due now' })
    expect(jobView(job({ state: 'paused', verdict: { due: false, kind: 'paused' } }), [], NOW).next.kind).toBe('paused')
    const r = jobView(job({ running: [{ id: 't1', stage: 'routine', since: '2026-10-23T11:58:00Z', step: { index: 0, name: 'llm-wiki:curate' } }] }), [], NOW)
    expect(r.next.kind).toBe('running')
    expect(r.running).toEqual({ ticket: 't1', stage: 'llm-wiki:curate', since: '2026-10-23T11:58:00Z' })
    expect(jobView(job({ verdict: { due: false, kind: 'requires', blocked_by: ['credential gmail'] } }), [], NOW).next).toMatchObject({ kind: 'blocked', text: 'Blocked — credential gmail' })
    expect(jobView(job({ blocked: 'no search server is configured here' }), [], NOW).next.kind).toBe('blocked')
    const held = jobView(job({}), [{ id: 't2', stage: 'routine', state: 'pending', slug: 'ops-hourly', not_before: '2026-10-23T13:00:00Z', reason: 'killed' }], NOW)
    expect(held.next.kind).toBe('held')
    expect(held.next.text).toMatch(/^Held until /)
    expect(jobView(job({}), [{ id: 't3', stage: 'routine', state: 'pending', slug: 'ops-hourly' }], NOW).next).toMatchObject({ kind: 'due', text: 'Queued' })
  })
  it('marks a failing stage as the last outcome and survives an older CLI with no verdict', () => {
    expect(jobView(job({ stages: [{ stage: 'routine', failing: ['devops1'], attempts: 2, ok_started: '2026-10-22T11:00:00Z' }] }), [], NOW).last).toEqual({ at: '2026-10-23T11:40:00Z', outcome: 'failed' })
    const old = jobView({ slug: 'x', every: '1d', state: 'active', due: true }, [], NOW)
    expect(old.next).toMatchObject({ kind: 'due' })
    expect(old.schedule).toBe('every 1d')
  })
})

function reader(answers: Partial<Record<Verb, unknown>>): Reader {
  return {
    run<T>(verb: Verb, _args?: Args): Promise<T> {
      if (!(verb in answers)) return Promise.reject(new Error(`${verb}: refused`))
      return Promise.resolve(answers[verb] as T)
    },
  }
}

describe('takeSnapshot', () => {
  it('builds attention from doctor, parked tickets and blocked jobs, and says when there is no runner', async () => {
    const snap = await takeSnapshot(
      reader({
        'wiki.doctor': { overall: 'warn', rows: [{ check: 'manifest', status: 'ok', detail: 'fine', fix: null }, { check: 'jobs-poll', status: 'warn', detail: 'no runner polls this wiki', fix: '`llm-wiki-cli machine runner install kb`' }] },
        'wiki.jobs.ls': { jobs: [job({}), job({ slug: 'gmail', description: 'Gmail inbox', kind: 'pipeline', verdict: { due: false, kind: 'requires', blocked_by: ['credential gmail'] } })], unreadable: [] },
        'wiki.jobs.due': { parked: [{ id: 'p1', job: 'gmail', stage: 'harvest', reason: 'login expired' }], review: [], handoffs: { problems: [] } },
        'wiki.tickets.ls': { tickets: [] },
        'wiki.page.ls': { pages: [{ path: 'sources/web/a.md', status: 'draft' }, { path: 'wiki/n.md', status: null, change: 'new' }, { path: 'sources/web/b.md', status: 'stable' }, { path: 'sources/notes/dropped.md', status: null, change: 'new' }] },
        'wiki.op.since': { runs: [{ op: 'pass', outcome: 'ok', when: '2026-10-23T11:40:00Z', summary: 'pass ok' }] },
        'wiki.search.status': { engine_configured: false, realm_ready: false, serving: 'grep' },
        'wiki.git.conflicts': { pages: [] },
        'machine.runner.ls': { wikis: [] },
      }),
      'kb',
      NOW,
    )
    expect(snap.attention.map((a) => a.id)).toEqual(['doctor:jobs-poll', 'parked:p1', 'blocked:gmail'])
    expect(snap.attention[1]?.action).toEqual({ kind: 'retry', ticket: 'p1' })
    expect(snap.health).toEqual({ tone: 'warn', sentence: '3 things need you. Last run 20m ago. Next up curate what the pipeline has landed, every hour in 40m.' })
    expect(snap.runner).toBe(false)
    expect(snap.curation).toEqual([{ path: 'sources/web/a.md', title: 'a', job: 'web' }])
    expect(snap.unadopted).toEqual([{ path: 'sources/notes/dropped.md', title: 'dropped', job: 'notes' }])
    expect(snap.recent[0]).toMatchObject({ op: 'pass', outcome: 'ok', summary: '' })
    expect(snap.errors).toEqual({})
  })
  it('records a failed read and still answers', async () => {
    const snap = await takeSnapshot(reader({ 'wiki.doctor': { overall: 'ok', rows: [] } }), 'kb', NOW)
    expect(snap.health.tone).toBe('ok')
    expect(Object.keys(snap.errors)).toContain('wiki.jobs.ls')
    expect(snap.errors['wiki.jobs.ls']).toBe('refused')
  })
})
