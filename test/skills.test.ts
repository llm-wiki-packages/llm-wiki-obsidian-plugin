import { describe, expect, it } from 'vitest'
import { SKILLS, slashCommand } from '../src/chat/skills'

describe('the skill catalogue', () => {
  it('spells a slash command with and without arguments', () => {
    expect(slashCommand(SKILLS.find((s) => s.name === 'research')!, '  money models ')).toBe('/llm-wiki:research money models')
    expect(slashCommand(SKILLS.find((s) => s.name === 'doctor')!)).toBe('/llm-wiki:doctor')
  })
  it('names only skills the ops plugin ships, each once', () => {
    const names = SKILLS.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z-]+$/)
  })
})
