// More > Config: the `config get|set|unset` verbs and the knobs read from the
// CLI's rows. `mocks/config-get.json` is a real `config get` answer, trimmed to
// the rows the tab reads, from a wiki made by `init` on CLI main at 0419d2077
// with a few values set in each layer.
import { describe, expect, it } from 'vitest'
import { VERBS, childEnv } from '../src/wiki/cli'
import {
  KNOBS, defaultWords, folderPattern, parseInput, parseList, patchOf, propertyName, propertyRows, propertyWords, sourceOf, spellKey, targetOf, templateRows, valueWords,
  type ConfigRow, type ConfigRows, type Knob,
} from '../src/wiki/config'
import answer from './mocks/config-get.json'

const { rows } = answer as unknown as ConfigRows
const knob = (key: string): Knob => KNOBS.flatMap((g) => g.knobs).find((k) => k.key === key)!
const row = (key: string): ConfigRow => rows[key]!

describe('the config verbs', () => {
  it('reads every row in one call under the floor', () => {
    expect(VERBS['wiki.config.get']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'config', 'get', '--json'])
    expect(childEnv({}, 'wiki.config.get').LLM_WIKI_PERMISSIONS).toBe('read')
  })
  it('writes one named layer, key and value after --', () => {
    expect(VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'edits.settle_seconds', value: '300', layer: 'local' }))
      .toEqual(['wiki', 'kb', 'config', 'set', '--local', '--json', '--', 'edits.settle_seconds', '300'])
    expect(VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'page.templates."sources/journal"', value: 'templates/Journal.md', layer: 'wiki' }))
      .toEqual(['wiki', 'kb', 'config', 'set', '--wiki', '--json', '--', 'page.templates."sources/journal"', 'templates/Journal.md'])
    expect(VERBS['wiki.config.unset']({ wiki: 'kb', configKey: 'logging.level', layer: 'wiki' })).toEqual(['wiki', 'kb', 'config', 'unset', '--wiki', '--json', '--', 'logging.level'])
    expect(VERBS['wiki.config.patch']({ wiki: 'kb', patch: { search: { paths: ['wiki/', 'notes/'] } }, layer: 'local' }))
      .toEqual(['wiki', 'kb', 'config', 'set', '--local', '--json', '--', '{"search":{"paths":["wiki/","notes/"]}}'])
    for (const v of ['wiki.config.set', 'wiki.config.patch', 'wiki.config.unset'] as const) expect(childEnv({}, v).LLM_WIKI_PERMISSIONS).toBeUndefined()
  })
  it('never leans on the CLI’s default layer, and refuses what would not be one clean key or value', () => {
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: 'x' })).toThrow(/names its layer/)
    expect(() => VERBS['wiki.config.unset']({ wiki: 'kb', configKey: 'wiki.name', layer: 'committed' as 'wiki' })).toThrow(/names its layer/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: '--wiki', value: 'x', layer: 'local' })).toThrow(/bad config key/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'page.templates.sources/x', value: 'x', layer: 'wiki' })).toThrow(/bad config key/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: 'a\nb', layer: 'local' })).toThrow(/config value/)
    expect(() => VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: '', layer: 'local' })).toThrow(/config value/)
    expect(() => VERBS['wiki.config.patch']({ wiki: 'kb', patch: ['x'] as unknown as Record<string, unknown>, layer: 'wiki' })).toThrow(/JSON object/)
    // After `--`, a dash-led value is text, not a flag.
    expect(VERBS['wiki.config.set']({ wiki: 'kb', configKey: 'wiki.name', value: '-x', layer: 'local' }).slice(-2)).toEqual(['wiki.name', '-x'])
  })
})

describe('where a value comes from', () => {
  it('is this machine over the wiki, both for a union both add to, or neither', () => {
    expect(sourceOf(row('logging.level'))).toBe('wiki')
    expect(sourceOf(row('jobs.defaults.model'))).toBe('local')
    expect(sourceOf(row('search.paths'))).toBe('both')
    expect(sourceOf(row('jobs.defaults.effort'))).toBeNull()
    expect(sourceOf({ in: { wiki: 'a', local: 'b' }, combine: 'override' })).toBe('local')
  })
})

describe('where a change lands', () => {
  it('goes back to the layer that sets it now, whatever the knob’s usual home', () => {
    // logging.level lives on the machine by habit, but `init` seeds it in the wiki.
    expect(targetOf(knob('logging.level'), rows)).toBe('wiki')
    expect(targetOf(knob('jobs.defaults.model'), rows)).toBe('local')
    expect(targetOf(knob('search.not_indexed'), rows)).toBe('local')
  })
  it('takes the one layer a row allows, and none for a row no command writes', () => {
    expect(targetOf(knob('jobs.request_gap_seconds'), rows)).toBe('wiki')
    expect(targetOf(knob('runner.caps.enrich'), rows)).toBe('local')
    expect(targetOf(knob('ops.major'), rows)).toBeNull()
    expect(targetOf({ key: 'nope' }, rows)).toBeNull()
  })
  it('goes to this machine inside a table it replaces whole, else the knob’s home', () => {
    // This machine has its own [jobs.defaults]; a wiki effort would be hidden by it.
    expect(targetOf(knob('jobs.defaults.effort'), rows)).toBe('local')
    const bare = { ...rows, 'jobs.defaults': { ...row('jobs.defaults'), in: {} } }
    expect(targetOf(knob('jobs.defaults.effort'), bare)).toBe('wiki')
    expect(targetOf(knob('edits.settle_seconds'), rows)).toBe('local')
  })
})

describe('a typed value', () => {
  it('is checked against its row before the CLI sees it', () => {
    expect(parseInput(knob('edits.settle_seconds'), row('edits.settle_seconds'), ' 300 ')).toEqual({ value: '300' })
    expect(parseInput(knob('edits.settle_seconds'), row('edits.settle_seconds'), '5m')).toEqual({ error: 'a whole number' })
    expect(parseInput({ min: 1 }, row('harness.run_cap_seconds'), '0')).toEqual({ error: 'at least 1' })
    expect(parseInput({}, row('inboxes.archive'), 'true')).toEqual({ value: 'true' })
    expect(parseInput({}, row('logging.level'), 'debug')).toEqual({ value: 'debug' })
    expect(parseInput({}, row('logging.level'), 'loud')).toMatchObject({ error: expect.stringMatching(/^one of off/) })
    // The CLI parses by the row's type now, so text that looks like a number stays text.
    expect(parseInput({}, row('wiki.name'), '2026')).toEqual({ value: '2026' })
    expect(parseInput({}, row('jobs.defaults.model'), 'opus|sonnet')).toEqual({ value: 'opus|sonnet' })
  })
  it('reads back in words, and says the default when no layer sets it', () => {
    expect(valueWords('bool', true)).toBe('On')
    expect(valueWords('list<str>', ['wiki/', 'sources/'])).toBe('wiki/, sources/')
    expect(defaultWords(knob('edits.settle_seconds'), row('edits.settle_seconds'))).toBe('600')
    expect(defaultWords(knob('jobs.defaults.effort'), row('jobs.defaults.effort'))).toBe('the harness’s own')
    expect(defaultWords({}, { type: 'list<str>', default: [] })).toBe('none')
  })
})

describe('lists and payloads', () => {
  it('take one entry per line', () => {
    expect(parseList(' wiki/\n\nsources/\nwiki/ \n')).toEqual({ value: ['wiki/', 'sources/'] })
    expect(parseList('')).toEqual({ value: [] })
    expect(parseList('a\u0007b')).toMatchObject({ error: expect.any(String) })
  })
  it('nest a dotted key as the merge patch takes it', () => {
    expect(patchOf(['search', 'paths'], ['a/'])).toEqual({ search: { paths: ['a/'] } })
    expect(patchOf(['search', 'properties', 'Draft'], null)).toEqual({ search: { properties: { Draft: null } } })
  })
})

describe('template rules', () => {
  it('quote a folder the way the CLI spells it', () => {
    expect(spellKey(['page', 'templates', 'sources/notes'])).toBe('page.templates."sources/notes"')
    expect(spellKey(['page', 'templates', '*'])).toBe('page.templates."*"')
    expect(spellKey(['page', 'templates', 'journal'])).toBe('page.templates.journal')
    // The CLI keys each entry's own row the same way.
    expect(Object.keys(rows).filter((k) => k.startsWith('page.templates.')).sort()).toEqual([spellKey(['page', 'templates', '*']), spellKey(['page', 'templates', 'sources/journal'])])
  })
  it('list most general first', () => {
    expect(templateRows(row('page.templates').value).map((r) => r.pattern)).toEqual(['*', 'sources/journal'])
    expect(templateRows({ 'sources/journal': 'a', '*': 'b', sources: 'c', bad: 3 }).map((r) => r.pattern)).toEqual(['*', 'sources', 'sources/journal'])
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

describe('indexed properties', () => {
  it('read from the map row, by name', () => {
    expect(propertyRows(row('search.properties').value)).toEqual([
      { name: 'Archive', type: 'checkbox', match: 'exact', boost: null },
      { name: 'Draft', type: 'checkbox', match: 'exact', boost: 1.25 },
      { name: 'Status', type: 'text', match: 'prefix', boost: null },
    ])
    expect(propertyWords({ type: 'text', match: 'prefix', boost: null })).toBe('text, prefix')
    expect(propertyWords({ type: 'checkbox', match: 'exact', boost: 1.25 })).toBe('checkbox, boost 1.25')
  })
  it('take a frontmatter key a dotted path cannot split', () => {
    expect(propertyName(' Status ')).toEqual({ name: 'Status' })
    expect(propertyName('a.b')).toMatchObject({ error: expect.any(String) })
    expect(propertyName('')).toMatchObject({ error: expect.any(String) })
  })
})

describe('the knobs', () => {
  it('each name a row the CLI answers', () => {
    expect(KNOBS.flatMap((g) => g.knobs).filter((k) => !rows[k.key]).map((k) => k.key)).toEqual([])
  })
})
