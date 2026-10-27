import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App, PluginManifest } from 'obsidian'
import type { SkillEntry } from '../src/chat/skills'
import type { Cli } from '../src/wiki/cli'
import type { Snapshot } from '../src/wiki/model'

// The plugin cache, so a test can say what it holds and count its reads.
const cache = vi.hoisted(() => ({ skills: [] as SkillEntry[], reads: 0 }))
vi.mock('../src/chat/skills', async (real) => ({
  ...(await real<typeof import('../src/chat/skills')>()),
  pluginDirs: () => Promise.resolve(['/plugins/brain']),
  listSkills: () => {
    cache.reads++
    return Promise.resolve(cache.skills)
  },
}))

// The wiki's reads: each takes the next answer, a snapshot or a failure.
const wiki = vi.hoisted(() => ({ answers: [] as unknown[], reads: 0 }))
vi.mock('../src/wiki/snapshot', () => ({
  takeSnapshot: () => {
    wiki.reads++
    const next = wiki.answers.shift()
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  },
}))

const { default: LlmWikiPlugin } = await import('../src/main')

const ADD: SkillEntry = { name: 'add', description: 'Follows a source.', args: '<url>' }
const CURATE: SkillEntry = { name: 'curate', description: 'Reviews drafts.', args: '' }
const GITHUB: SkillEntry = { name: 'channel-github', description: 'GitHub references.', args: '', unit: true }

/** A plugin as Obsidian loads it; `app` is what a test's path through it touches. */
const newPlugin = (app = {}) => new LlmWikiPlugin(app as App, {} as PluginManifest)

const snapshot = (palette: SkillEntry[] | null): Snapshot => ({ takenAt: 0, attention: [], jobs: [], palette }) as unknown as Snapshot

beforeEach(() => {
  cache.skills = [CURATE]
  cache.reads = 0
  wiki.answers = []
  wiki.reads = 0
})

describe('the chat slash skills', () => {
  it('are the snapshot’s palette when it has one, and the plugin cache is not read', async () => {
    const plugin = newPlugin()
    plugin.snapshot = snapshot([ADD, GITHUB])
    expect(await plugin.chatSkills()).toEqual([ADD, GITHUB])
    expect(cache.reads).toBe(0)
  })

  it('stay empty when the palette is empty: a new CLI that lists no session skill is not the plugin cache', async () => {
    const plugin = newPlugin()
    plugin.snapshot = snapshot([])
    expect(await plugin.chatSkills()).toEqual([])
    expect(cache.reads).toBe(0)
  })

  it('come from the plugin cache, read once, from an older CLI or a failed skills ls', async () => {
    const plugin = newPlugin()
    plugin.snapshot = snapshot(null)
    expect(await plugin.chatSkills()).toEqual([CURATE])
    expect(await plugin.chatSkills()).toEqual([CURATE])
    expect(cache.reads).toBe(1)
  })

  it('come from the plugin cache before the first read', async () => {
    expect(await newPlugin().chatSkills()).toEqual([CURATE])
  })
})

describe('Skills…', () => {
  // The read schedules the next poll; fake timers keep it from outliving the test.
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  /** A plugin that has read the wiki once, and the list Skills… opens with. */
  function ready(palette: SkillEntry[] | null) {
    const plugin = newPlugin({ workspace: { trigger: () => undefined, getLeavesOfType: () => [] } })
    plugin.cli = {} as Cli
    plugin.wiki = { key: 'w', name: 'W', root: '/w' }
    plugin.snapshot = snapshot(palette)
    const opened: SkillEntry[][] = []
    Object.assign(plugin, { pickFrom: (skills: SkillEntry[]) => opened.push(skills) })
    return { plugin, opened }
  }

  it('reads skills ls again, so a unit enabled from a terminal since the last read is in the list', async () => {
    const { plugin, opened } = ready([ADD])
    wiki.answers = [snapshot([ADD, GITHUB])]
    await plugin.pickSkill()
    expect(wiki.reads).toBe(1)
    expect(opened).toEqual([[ADD, GITHUB]])
    expect(await plugin.chatSkills()).toEqual([ADD, GITHUB])
  })

  it('keeps the last list when the read fails, never an empty one', async () => {
    const { plugin, opened } = ready([ADD])
    wiki.answers = [new Error('cli: refused')]
    await plugin.pickSkill()
    expect(opened).toEqual([[ADD]])
  })

  it('reads the plugin cache again from an older CLI or a failed skills ls, as it did before', async () => {
    const { plugin, opened } = ready(null)
    expect(await plugin.chatSkills()).toEqual([CURATE])
    cache.skills = [CURATE, ADD]
    wiki.answers = [snapshot(null)]
    await plugin.pickSkill()
    expect(cache.reads).toBe(2)
    expect(opened).toEqual([[CURATE, ADD]])
  })
})
