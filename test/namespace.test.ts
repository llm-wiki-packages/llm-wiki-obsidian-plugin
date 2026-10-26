import { describe, expect, it } from 'vitest'
import { PLUGIN_NAMESPACE, noSkillsMessage, skillsButtonLabel, slash, slashCommand } from '../src/chat/skills'
import { addWith, skillAction } from '../src/views/dashboard/skills'
import { matchSkills } from '../src/views/composer'
import type { SkillView } from '../src/wiki/model'

const view = (over: Partial<SkillView>): SkillView => ({ name: 'channel-gmail', state: 'installed', description: '', venue: null, version: null, from: null, usage: null, drifted: false, outdated: false, inputs: [], jobs: [], slots: [], warnings: [], notes: { skill: '' }, dir: null, ...over }) as SkillView

describe('the plugin namespace', () => {
  it('is brain', () => expect(PLUGIN_NAMESPACE).toBe('brain'))
  it('spells a slash command through the constant', () => {
    expect(slash('add', ' x ')).toBe('/brain:add x')
    expect(slashCommand({ name: 'add', description: '', args: '' })).toBe('/brain:add')
  })
  it('types /brain:add and /brain:enable from the dashboard', () => {
    expect(addWith(view({}))).toMatch(/^\/brain:add a new source/)
    expect(skillAction(view({ state: 'installed' }))?.action).toEqual({ kind: 'ask', prompt: '/brain:enable channel-gmail' })
    expect(skillAction(view({ state: 'available' }))?.action).toEqual({ kind: 'ask', prompt: '/brain:enable channel-gmail' })
  })
  it('lists every skill for a bare typed-out prefix', () => {
    const skills = [{ name: 'add', description: 'a', args: '' }]
    expect(matchSkills(skills, 'brain:')).toEqual(skills)
    expect(matchSkills(skills, 'brain:ad')).toEqual(skills)
  })
})

describe('user-facing plugin names', () => {
  it('names the brain plugin when no skills are found', () => {
    expect(noSkillsMessage()).toBe('No brain skills found under ~/.claude/plugins; install the brain plugin in Claude Code first')
  })
  it('names the brain plugin in the skills button label', () => expect(skillsButtonLabel()).toContain('brain plugin'))
})
