import { describe, expect, it } from 'vitest'
import { hasModes, loadsHere, paletteOf, slashCommand, type SkillsLsRow } from '../src/chat/skills'
import type { Args, Verb } from '../src/wiki/cli'
import type { SkillView } from '../src/wiki/model'
import { takeSnapshot, type Reader } from '../src/wiki/snapshot'
import { matchSkills } from '../src/views/composer'
import { pipelineName, pipelinePill } from '../src/views/dashboard/jobs'
import { byHand, skillAction } from '../src/views/dashboard/skills'

const NOW = Date.parse('2026-10-27T12:00:00Z')

/** A `skills ls` from a CLI that reads manifests (#3702): the wiki's units, then the `brain` plugin's own skills. */
const ROWS: SkillsLsRow[] & Record<string, unknown>[] = [
  { name: 'channel-gmail', state: 'enabled', from: 'llm-wiki-packages/llm-wiki-skills@v0.6.0', stages: ['harvest', 'process'], mode: ['pipeline'], description: 'Gmail capture, one watch per mailbox.', argument_hint: 'ticket=<id> stage=<harvest|process>', next: '/channel-gmail ticket=<id>', warnings: [] },
  { name: 'channel-github', state: 'enabled', from: 'llm-wiki-packages/llm-wiki-skills@v0.6.0', stages: ['harvest', 'process', 'routine'], mode: ['pipeline', 'session'], description: 'GitHub references for this wiki.', argument_hint: '<setup|rank|pending|retag> [words] | ticket=<id> stage=process', warnings: [] },
  { name: 'daily-report', state: 'installed', from: 'llm-wiki-packages/llm-wiki-skills@v0.6.0', stages: ['routine'], mode: ['pipeline', 'session'], description: 'A morning digest.', argument_hint: '[date|focus|setup] [ticket=<id> stage=routine]', warnings: [] },
  { name: 'hand-made', state: 'enabled', from: null, stages: ['harvest'], mode: null, description: null, argument_hint: null, warnings: ['hand-made: manifest declares no description, mode, argument_hint; skills enable materializes them into this machine’s copy, and writing them is what commits them'] },
  { name: 'PLUGIN:add', state: null, from: 'plugin', stages: [], mode: ['session'], description: 'Follows a source or schedules recurring work in this wiki.', argument_hint: '<url-or-channel-or-task> [more...]', next: null, warnings: [] },
  { name: 'PLUGIN:curate', state: 'accepted', from: 'plugin', stages: ['routine'], mode: ['pipeline', 'session'], description: 'Reviews draft pages and accepts them into the wiki.', argument_hint: '[path|ticket=<id>]', next: null, warnings: [] },
  { name: 'PLUGIN:wiki-report', state: 'unaccepted', from: 'plugin', stages: ['routine'], mode: ['pipeline'], description: 'Writes the wiki’s digest of what its ops did since the last report.', argument_hint: '[<ISO|Nh|Nd>] ticket=<id>', next: 'llm-wiki-ops skills enable PLUGIN:wiki-report', warnings: [] },
  { name: 'PLUGIN:dream', state: null, from: 'plugin', stages: ['routine'], mode: ['pipeline'], description: 'Ships no sandbox, so it needs no yes.', argument_hint: 'ticket=<id>', next: null, warnings: [] },
  { name: 'PLUGIN:tidy', state: 'stale', from: 'plugin', stages: ['routine'], mode: ['pipeline'], description: 'Its reach grew since the operator’s yes.', argument_hint: 'ticket=<id>', next: 'llm-wiki-ops skills enable PLUGIN:tidy', warnings: [] },
]

/** The same wiki from a CLI before #3702: no `mode`, `description` or `argument_hint` keys, and no plugin rows. */
const OLD_ROWS = ROWS.filter((r) => !r.name.startsWith('PLUGIN:')).map(({ mode: _m, description: _d, argument_hint: _a, ...r }) => r)

function reader(answers: Partial<Record<Verb, unknown>>, seen: [Verb, Args | undefined][] = []): Reader {
  return {
    run<T>(verb: Verb, args?: Args): Promise<T> {
      seen.push([verb, args])
      if (answers[verb] === undefined) return Promise.reject(new Error(`${verb}: refused`))
      return Promise.resolve(answers[verb] as T)
    },
  }
}

const WIKI = (rows: unknown[]): Partial<Record<Verb, unknown>> => ({
  'wiki.jobs.ls': { jobs: [{ slug: 'inbox-joe', description: '', every: '1h', state: 'active', kind: 'pipeline', skill: 'channel-gmail', stages: [] }] },
  'wiki.skills.ls': { skills: rows },
  'wiki.skills.doctor': { findings: [] },
  'wiki.packages.ls': { this_wiki: [] },
  'wiki.credentials.ls': { rows: [] },
  'wiki.credentials.bindings': { skills: [], jobs: [] },
})

describe('the chat palette from skills ls', () => {
  it('is every row whose mode includes session: plugin skills as /brain:<name>, enabled units as /<name>', () => {
    const palette = paletteOf(ROWS)!
    expect(palette.map((s) => slashCommand(s))).toEqual(['/brain:add', '/brain:curate', '/channel-github'])
    expect(palette[0]).toEqual({ name: 'add', description: 'Follows a source or schedules recurring work in this wiki.', args: '<url-or-channel-or-task> [more...]' })
    expect(slashCommand(palette[2]!, ' rank ')).toBe('/channel-github rank')
  })
  it('leaves out a pipeline-only skill, which stays typeable: the list closes on it and the text is kept', () => {
    const palette = paletteOf(ROWS)!
    expect(palette.map((s) => s.name)).not.toContain('wiki-report')
    expect(palette.map((s) => s.name)).not.toContain('channel-gmail')
    expect(matchSkills(palette, 'brain:wiki-report')).toEqual([])
  })
  it('leaves out a unit not enabled here, and one whose mode the author has not filled', () => {
    const names = paletteOf(ROWS)!.map((s) => s.name)
    expect(names).not.toContain('daily-report')
    expect(names).not.toContain('hand-made')
  })
  it('is null from an older CLI, whose rows carry no mode key, so the plugin cache answers as before', () => {
    expect(hasModes(OLD_ROWS)).toBe(false)
    expect(paletteOf(OLD_ROWS)).toBeNull()
    expect(paletteOf([])).toBeNull()
    expect(hasModes([{ name: 'hand-made', state: 'enabled', mode: null }])).toBe(true)
  })
})

describe('which units this machine loads', () => {
  it('is one answer for the / list and the Skills tab, state by state', async () => {
    const states = ['enabled', 'drifted', 'linked', 'installed', 'missing', 'broken', null]
    const rows: SkillsLsRow[] = states.map((state, i) => ({ name: `unit-${i}`, state, mode: ['session'] }))
    const palette = paletteOf(rows)!.map((s) => s.name)
    const snap = await takeSnapshot(reader(WIKI(rows)), 'kb', NOW)
    for (const r of rows) {
      expect(palette.includes(r.name), `${r.state} in the / list`).toBe(loadsHere(r.state))
      expect(snap.skills.find((s) => s.name === r.name)?.state === 'enabled', `${r.state} on the Skills tab`).toBe(loadsHere(r.state))
    }
    expect(states.filter(loadsHere)).toEqual(['enabled', 'drifted', 'linked'])
  })
})

describe('the snapshot from skills ls rows', () => {
  it('takes each unit’s description and mode off its row, reads no SKILL.md, and shows no plugin row', async () => {
    const seen: [Verb, Args | undefined][] = []
    const reads: string[] = []
    const read = (p: string) => {
      reads.push(p)
      return Promise.reject(new Error('no such file'))
    }
    const snap = await takeSnapshot(reader(WIKI(ROWS), seen), 'kb', NOW, { root: '/w', home: '/h', read })
    expect(seen.filter(([v]) => v === 'wiki.skills.show').map(([, a]) => a?.name)).toEqual(['channel-gmail', 'channel-github', 'daily-report', 'hand-made'])
    expect(reads.filter((p) => p.endsWith('SKILL.md'))).toEqual([])
    expect(snap.skills.map((s) => s.name)).toEqual(['channel-github', 'channel-gmail', 'hand-made', 'daily-report'])
    expect(snap.skills.find((s) => s.name === 'channel-gmail')).toMatchObject({ description: 'Gmail capture, one watch per mailbox.', mode: ['pipeline'], argumentHint: 'ticket=<id> stage=<harvest|process>', stages: ['harvest', 'process'] })
    expect(snap.skills.find((s) => s.name === 'hand-made')).toMatchObject({ description: '', mode: null, warnings: [expect.stringContaining('manifest declares no')] })
  })
  it('keeps the row’s manifest keys over the show verb’s answer', async () => {
    const snap = await takeSnapshot(reader({ ...WIKI(ROWS.slice(0, 1)), 'wiki.skills.show': { skills: [{ name: 'channel-gmail', state: 'enabled', manifest: { usage: '/channel-gmail ticket=<id>' } }] } }), 'kb', NOW)
    expect(snap.skills[0]).toMatchObject({ description: 'Gmail capture, one watch per mailbox.', mode: ['pipeline'], usage: '/channel-gmail ticket=<id>' })
  })
  it('lists what a job can run: rows with pipeline in mode, plugin routines first, with their state and next step', async () => {
    const snap = await takeSnapshot(reader(WIKI(ROWS)), 'kb', NOW)
    expect(snap.pipeline.map((p) => [p.name, p.ready, p.stale, p.next, p.jobs])).toEqual([
      ['PLUGIN:curate', true, false, null, []],
      ['PLUGIN:dream', true, false, null, []],
      ['PLUGIN:tidy', false, true, 'llm-wiki-ops skills enable PLUGIN:tidy', []],
      ['PLUGIN:wiki-report', false, false, 'llm-wiki-ops skills enable PLUGIN:wiki-report', []],
      ['channel-github', true, false, null, []],
      ['channel-gmail', true, false, null, ['inbox-joe']],
      ['daily-report', false, false, null, []],
    ])
    expect(pipelineName(snap.pipeline[3]!)).toBe('wiki-report')
    expect(snap.pipeline.map((p) => [pipelineName(p), pipelinePill(p)])).toEqual([
      ['curate', null],
      ['dream', null],
      ['tidy', 'reach grew since enable'],
      ['wiki-report', 'not enabled here'],
      ['channel-github', null],
      ['channel-gmail', null],
      ['daily-report', 'not enabled here'],
    ])
    expect(snap.pipeline.find((p) => p.name === 'channel-gmail')).toMatchObject({ plugin: false, stages: ['harvest', 'process'], description: 'Gmail capture, one watch per mailbox.' })
  })
  it('puts a skill with both modes in both places, and a pipeline-only one in the jobs list alone', async () => {
    const snap = await takeSnapshot(reader(WIKI(ROWS)), 'kb', NOW)
    const palette = paletteOf(ROWS)!.map((s) => slashCommand(s))
    const pipeline = snap.pipeline.map((p) => p.name)
    expect(palette).toContain('/brain:curate')
    expect(pipeline).toContain('PLUGIN:curate')
    expect(palette).toContain('/channel-github')
    expect(pipeline).toContain('channel-github')
    expect(palette).not.toContain('/brain:wiki-report')
    expect(pipeline).toContain('PLUGIN:wiki-report')
    expect(pipeline).not.toContain('PLUGIN:add')
    expect(pipeline).not.toContain('hand-made')
  })
  it('holds the / list from its own skills ls, so a unit enabled since shows on the next full read and a light one keeps it', async () => {
    const before = ROWS.map((r) => (r.name === 'daily-report' ? { ...r, state: 'installed' } : r))
    const after = ROWS.map((r) => (r.name === 'daily-report' ? { ...r, state: 'enabled' } : r))
    const first = await takeSnapshot(reader(WIKI(before)), 'kb', NOW)
    expect(first.palette).toEqual(paletteOf(before))
    expect(first.palette!.map((s) => s.name)).not.toContain('daily-report')
    const next = await takeSnapshot(reader(WIKI(after)), 'kb', NOW)
    expect(next.palette!.map((s) => slashCommand(s))).toEqual(['/brain:add', '/brain:curate', '/channel-github', '/daily-report'])
    const light = await takeSnapshot(reader(WIKI([])), 'kb', NOW, undefined, next)
    expect(light.palette).toEqual(next.palette)
  })
  it('carries the jobs list over a light read', async () => {
    const full = await takeSnapshot(reader(WIKI(ROWS)), 'kb', NOW)
    const light = await takeSnapshot(reader(WIKI([])), 'kb', NOW, undefined, full)
    expect(light.pipeline.map((p) => p.name)).toEqual(full.pipeline.map((p) => p.name))
    expect(light.pipeline.find((p) => p.name === 'channel-gmail')?.jobs).toEqual(['inbox-joe'])
  })
  it('gives an available unit the package manifest’s description and mode, and its SKILL.md’s while the catalog lacks one', async () => {
    const cache = '/h/cache/llm-wiki-skills/@abc/skills'
    const read = async (p: string) => {
      if (p === `${cache}/channel-youtube/manifest.json`) return JSON.stringify({ mode: ['pipeline'], description: 'YouTube capture.', argument_hint: 'ticket=<id> stage=process' })
      if (p === `${cache}/channel-youtube/SKILL.md`) return '---\ndescription: Use when a pipeline ticket invokes it.\n---\n'
      if (p === `${cache}/web-page/manifest.json`) return JSON.stringify({ usage: 'run' })
      if (p === `${cache}/web-page/SKILL.md`) return '---\ndescription: Fetch a web page.\n---\n'
      throw new Error('no such file')
    }
    const snap = await takeSnapshot(reader({ ...WIKI(ROWS.slice(4)),
      'wiki.packages.ls': { this_wiki: [{ package: 'llm-wiki-packages/llm-wiki-skills' }], installed: [{ package: 'llm-wiki-packages/llm-wiki-skills', cache: '~/cache/llm-wiki-skills' }] },
      'wiki.packages.show': { shown: '0.6.0', shown_ref: 'abc', manifest: { artifacts: [{ type: 'skill', name: 'channel-youtube' }, { type: 'skill', name: 'web-page' }] } },
    }), 'kb', NOW, { root: '/w', home: '/h', read })
    expect(snap.skills.map((s) => [s.name, s.description, s.mode])).toEqual([['channel-youtube', 'YouTube capture.', ['pipeline']], ['web-page', 'Fetch a web page.', null]])
  })
})

describe('an older CLI, whose rows carry no mode', () => {
  it('reads each unit’s description from its SKILL.md and leaves its mode unset', async () => {
    const read = async (p: string) => {
      if (p === '/w/.llm-wiki/skills/channel-gmail/SKILL.md') return '---\ndescription: Gmail capture. More.\n---\n'
      throw new Error('no such file')
    }
    const snap = await takeSnapshot(reader(WIKI(OLD_ROWS)), 'kb', NOW, { root: '/w', home: '/h', read })
    const gmail = snap.skills.find((s) => s.name === 'channel-gmail')!
    expect(gmail.description).toBe('Gmail capture.')
    expect('mode' in gmail).toBe(false)
  })
  it('holds no / list, so the plugin cache answers as before', async () => {
    expect((await takeSnapshot(reader(WIKI(OLD_ROWS)), 'kb', NOW)).palette).toBeNull()
    expect((await takeSnapshot(reader({ ...WIKI([]), 'wiki.skills.ls': undefined }), 'kb', NOW)).palette).toBeNull()
  })
  it('lists the units with a stage as what a job can run, and no plugin routines', async () => {
    const snap = await takeSnapshot(reader(WIKI([...OLD_ROWS, { name: 'notes-only', state: 'enabled', stages: [] }])), 'kb', NOW)
    expect(snap.pipeline.map((p) => p.name)).toEqual(['channel-github', 'channel-gmail', 'daily-report', 'hand-made'])
  })
})

describe('whether a person can run a skill', () => {
  const view = (over: Partial<SkillView>): SkillView => ({ name: 'channel-github', state: 'enabled', description: '', argumentHint: null, stages: [], venue: null, version: null, from: null, usage: '/channel-github ticket=<id>', drifted: false, outdated: false, inputs: [], jobs: [], slots: [], warnings: [], notes: { skill: '' }, dir: null, ...over })
  it('reads session in its mode, whatever its usage line says', () => {
    expect(byHand(view({ mode: ['pipeline', 'session'] }))).toBe(true)
    expect(byHand(view({ mode: ['pipeline'], usage: '/web-page url=<url>' }))).toBe(false)
    expect(byHand(view({ mode: null, usage: '/hand-made' }))).toBe(false)
    expect(skillAction(view({ mode: ['pipeline', 'session'] }))).toMatchObject({ label: 'Run', action: { kind: 'ask', prompt: '/channel-github ticket=<id>' } })
  })
  it('from an older CLI, keeps the ticket= heuristic on the usage line', () => {
    expect(byHand(view({ usage: '/channel-gmail ticket=<id>' }))).toBe(false)
    expect(byHand(view({ usage: '/web-page url=<url>' }))).toBe(true)
    expect(skillAction(view({ usage: '/channel-gmail ticket=<id>' }))).toBeNull()
  })
})
