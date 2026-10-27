import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { App, PluginManifest } from 'obsidian'
import type { SkillEntry } from '../src/chat/skills'
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

const { default: LlmWikiPlugin } = await import('../src/main')

const ADD: SkillEntry = { name: 'add', description: 'Follows a source.', args: '<url>' }
const CURATE: SkillEntry = { name: 'curate', description: 'Reviews drafts.', args: '' }
const GITHUB: SkillEntry = { name: 'channel-github', description: 'GitHub references.', args: '', unit: true }

/** A plugin as Obsidian loads it. */
const newPlugin = (app = {}) => new LlmWikiPlugin(app as App, {} as PluginManifest)

const snapshot = (palette: SkillEntry[] | null): Snapshot => ({ takenAt: 0, attention: [], jobs: [], palette }) as unknown as Snapshot

beforeEach(() => {
  cache.skills = [CURATE]
  cache.reads = 0
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
