// More > Config: the `config get|set|unset` verbs and the knob list that stands
// in for a `config ls`. The answers are real ones, from a wiki made by `init`
// on CLI main at ac9b1fa49.
import { describe, expect, it } from 'vitest'
import { VERBS, childEnv } from '../src/wiki/cli'
import { KNOBS, folderPattern, knobKeys, parseInput, placeOf, readAll, spellKey, targetOf, templateRows, valueWords, type ConfigValue, type Knob } from '../src/wiki/config'

const knob = (key: string): Knob => KNOBS.flatMap((g) => g.knobs).find((k) => k.key === key)!

describe('the config verbs', () => {
  it('reads under the floor and writes without it', () => {
    expect(VERBS['wiki.config.get']({ wiki: 'kb', configKey: 'edits.settle_seconds' })).toEqual(['wiki', '--read-only', 'kb', 'config', 'get', 'edits.settle_seconds', '--json'])
    expect(VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'edits.settle_seconds', value: '300' })).toEqual(['wiki', 'kb', 'config', 'set', 'edits.settle_seconds', '300', '--json'])
    expect(VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'page.templates."sources/journal"', value: 'templates/Journal.md', committed: true }))
      .toEqual(['wiki', 'kb', 'config', 'set', '--committed', 'page.templates."sources/journal"', 'templates/Journal.md', '--json'])
    expect(VERBS['wiki.config.unset']({ wiki: 'kb', configKey: 'logging.level' })).toEqual(['wiki', 'kb', 'config', 'unset', 'logging.level', '--json'])
    expect(childEnv({}, 'wiki.config.get').LLM_WIKI_PERMISSIONS).toBe('read')
    expect(childEnv({}, 'wiki.config.set').LLM_WIKI_PERMISSIONS).toBeUndefined()
    expect(childEnv({}, 'wiki.config.unset').LLM_WIKI_PERMISSIONS).toBeUndefined()
  })
  it('refuses what would not be one clean key or value', () => {
    expect(() => VERBS['wiki.config.get']({ wiki: 'kb', configKey: '--committed' })).toThrow(/bad config key/)
    expect(() => VERBS['wiki.config.get']({ wiki: 'kb', configKey: 'page.templates.sources/x' })).toThrow(/bad config key/)
    expect(() => VERBS['wiki.config.get']({ wiki: 'kb', configKey: 'a. b' })).toThrow(/bad config key/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: '--committed' })).toThrow(/config value/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: 'a\nb' })).toThrow(/config value/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: '' })).toThrow(/config value/)
  })
})

describe('where a change lands', () => {
  it('reads the source the CLI names', () => {
    expect(placeOf('.llm-wiki.toml')).toBe('committed')
    expect(placeOf('.llm-wiki.local.toml')).toBe('local')
    expect(placeOf('.llm-wiki.toml + .llm-wiki.local.toml')).toBeNull()
    expect(placeOf(null)).toBeNull()
  })
  it('goes back where the value is set now, whatever the knob’s usual home', () => {
    // logging.level lives on the machine by habit, but `init` seeds it committed.
    expect(targetOf(knob('logging.level'), '.llm-wiki.toml')).toBe('committed')
    expect(targetOf(knob('jobs.defaults.model'), '.llm-wiki.local.toml')).toBe('local')
  })
  it('takes the knob’s home when neither file sets it, and its scope when the CLI fixes one', () => {
    expect(targetOf(knob('edits.settle_seconds'), null)).toBe('local')
    expect(targetOf(knob('jobs.defaults.model'), null)).toBe('committed')
    expect(targetOf(knob('jobs.request_gap_seconds'), null)).toBe('committed')
    expect(targetOf(knob('runner.caps.enrich'), null)).toBe('local')
  })
})

describe('a typed value', () => {
  it('is checked for its kind before the CLI sees it', () => {
    expect(parseInput(knob('edits.settle_seconds'), ' 300 ')).toEqual({ value: '300' })
    expect(parseInput(knob('edits.settle_seconds'), '5m')).toEqual({ error: 'a whole number' })
    expect(parseInput(knob('harness.run_cap_seconds'), '0')).toEqual({ error: 'at least 1' })
    expect(parseInput(knob('inboxes.archive'), 'true')).toEqual({ value: 'true' })
    expect(parseInput(knob('jobs.defaults.effort'), 'high')).toEqual({ value: 'high' })
    expect(parseInput(knob('jobs.defaults.effort'), 'huge')).toMatchObject({ error: expect.stringMatching(/^one of low/) })
    expect(parseInput(knob('jobs.defaults.model'), 'opus|sonnet')).toEqual({ value: 'opus|sonnet' })
  })
  it('keeps text from being written as a number or a boolean', () => {
    expect(parseInput(knob('wiki.name'), '2026')).toMatchObject({ error: expect.any(String) })
    expect(parseInput(knob('wiki.name'), 'false')).toMatchObject({ error: expect.any(String) })
    expect(parseInput(knob('wiki.name'), '-x')).toMatchObject({ error: expect.any(String) })
  })
  it('reads back in words', () => {
    expect(valueWords(knob('inboxes.archive'), true)).toBe('On')
    expect(valueWords(knob('inboxes.archive'), false)).toBe('Off')
    expect(valueWords(knob('runner.caps.enrich'), 2)).toBe('2')
  })
})

describe('template rules', () => {
  it('quote a folder the way the CLI spells it', () => {
    expect(spellKey(['page', 'templates', 'sources/notes'])).toBe('page.templates."sources/notes"')
    expect(spellKey(['page', 'templates', '*'])).toBe('page.templates."*"')
    expect(spellKey(['page', 'templates', 'journal'])).toBe('page.templates.journal')
    expect(VERBS['wiki.config.get']({ wiki: 'kb', configKey: spellKey(['page', 'templates', 'sources/*/daily']) })).toContain('page.templates."sources/*/daily"')
  })
  it('list most general first', () => {
    expect(templateRows({ 'sources/journal': 'templates/Journal.md', '*': 'templates/Note.md', sources: 'templates/Source.md', bad: 3 }).map((r) => r.pattern))
      .toEqual(['*', 'sources', 'sources/journal'])
    expect(templateRows(null)).toEqual([])
  })
  it('take a folder pattern, not a glob', () => {
    expect(folderPattern(' /sources/notes/ ')).toEqual({ pattern: 'sources/notes' })
    expect(folderPattern('sources/*')).toEqual({ pattern: 'sources/*' })
    expect(folderPattern('sources/n*')).toMatchObject({ error: expect.any(String) })
    expect(folderPattern('../x')).toMatchObject({ error: expect.any(String) })
    expect(folderPattern('')).toMatchObject({ error: expect.any(String) })
  })
})

describe('reading the knobs', () => {
  it('asks for every key once, and a failed one stays an error', async () => {
    const answers: Record<string, ConfigValue> = {
      'wiki.name': { key: 'wiki.name', found: true, value: 'w4', source: '.llm-wiki.toml' },
      'runner.caps.enrich': { key: 'runner.caps.enrich', found: true, value: 2, source: '.llm-wiki.local.toml' },
    }
    const asked: string[] = []
    const got = await readAll(knobKeys(), (k) => {
      asked.push(k)
      if (k === 'ops.major') return Promise.reject(new Error('refused'))
      return Promise.resolve(answers[k] ?? { key: k, found: false, value: null, source: null })
    }, 3)
    expect(asked.sort()).toEqual([...knobKeys()].sort())
    expect(got['wiki.name']).toEqual(answers['wiki.name'])
    expect(got['ops.major']).toEqual({ error: 'refused' })
    expect(got['transcribe.engine']).toMatchObject({ found: false })
  })
  it('never lists a search key, which config refuses', () => {
    expect(knobKeys().some((k) => k.startsWith('search.'))).toBe(false)
  })
})
