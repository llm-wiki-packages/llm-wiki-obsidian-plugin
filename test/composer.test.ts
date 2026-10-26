import { describe, expect, it } from 'vitest'
import { matchSkills, permissionLabel, shortTokens, slashQuery } from '../src/views/composer'
import { DEFAULT_SETTINGS } from '../src/settings'

const skill = (name: string, description = '') => ({ name, description, args: '' })

describe('slash completion', () => {
  it('opens on a slash word at the start of a line, up to the caret', () => {
    expect(slashQuery('/', 1)).toBe('')
    expect(slashQuery('/sea', 4)).toBe('sea')
    expect(slashQuery('first line\n/cur', 15)).toBe('cur')
    expect(slashQuery('/brain:se', 9)).toBe('brain:se')
  })
  it('stays shut mid-sentence, after a space, or with the caret elsewhere', () => {
    expect(slashQuery('look in a/b', 11)).toBeNull()
    expect(slashQuery('/search the wiki', 16)).toBeNull()
    expect(slashQuery('/search', 0)).toBeNull()
    expect(slashQuery('hello', 5)).toBeNull()
  })
  it('matches a name before a description, and ignores the plugin prefix typed out', () => {
    const skills = [skill('curate', 'review search hits'), skill('search', 'look things up'), skill('status')]
    expect(matchSkills(skills, 'se').map((s) => s.name)).toEqual(['search', 'curate'])
    expect(matchSkills(skills, 'brain:sta').map((s) => s.name)).toEqual(['status'])
    expect(matchSkills(skills, '').map((s) => s.name)).toEqual(['curate', 'search', 'status'])
  })
})

describe('the permission button', () => {
  it('names the mode, and what overrides it', () => {
    expect(permissionLabel(DEFAULT_SETTINGS)).toBe('Ask first')
    expect(permissionLabel({ ...DEFAULT_SETTINGS, permissionMode: 'bypassPermissions', readOnly: true })).toBe('Full access · read-only')
    expect(permissionLabel({ ...DEFAULT_SETTINGS, sandboxed: true, sandbox: 'read-search' })).toBe('Sandbox: read-search')
  })
})

describe('token counts', () => {
  it('reads as k and m', () => {
    expect(shortTokens(950)).toBe('950')
    expect(shortTokens(331_400)).toBe('331k')
    expect(shortTokens(1_000_000)).toBe('1m')
    expect(shortTokens(200_000)).toBe('200k')
  })
})
