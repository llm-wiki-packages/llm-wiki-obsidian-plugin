import { describe, expect, it } from 'vitest'
import { clip, describeTool, groupSummary, toolDetail, vaultPath } from '../src/chat/describe'
import { READ_VERBS, readRules } from '../src/chat/readVerbs'

const ROOT = '/Users/joe/wikis/personal'

describe('tool rows', () => {
  it('names a file by its vault path and opens a page inside the wiki', () => {
    expect(describeTool('Read', { file_path: `${ROOT}/wiki/log.md` }, undefined, ROOT)).toEqual({ icon: 'file-text', label: 'Read', detail: 'wiki/log.md', open: 'wiki/log.md' })
    expect(describeTool('Edit', { file_path: `${ROOT}/sources/notes/a b.md` }, undefined, `${ROOT}/`).open).toBe('sources/notes/a b.md')
  })
  it('opens nothing outside the wiki, under a dot folder, or that is not markdown', () => {
    expect(describeTool('Read', { file_path: '/etc/hosts' }, undefined, ROOT)).toEqual({ icon: 'file-text', label: 'Read', detail: '/etc/hosts', open: undefined })
    expect(describeTool('Read', { file_path: `${ROOT}/.claude/settings.json` }, undefined, ROOT).open).toBeUndefined()
    expect(describeTool('Write', { file_path: `${ROOT}-other/wiki/a.md` }, undefined, ROOT).open).toBeUndefined()
  })
  it('takes a sandboxed turn’s summary as the path', () => {
    expect(describeTool('Read', undefined, 'wiki/a.md', null).open).toBe('wiki/a.md')
  })
  it('says a skill and a command in words', () => {
    expect(describeTool('Skill', { skill: 'brain:wiki-report', args: "what's new" }, '{"skill":…}', ROOT)).toEqual({ icon: 'sparkles', label: 'Skill', detail: "brain:wiki-report · what's new" })
    expect(describeTool('Bash', { command: 'llm-wiki-ops jobs ls' }, 'llm-wiki-ops jobs ls', ROOT, 'Reading the job list')).toEqual({ icon: 'terminal', label: 'Reading the job list' })
    expect(describeTool('Bash', { command: 'ls -la' }, 'ls -la', ROOT)).toEqual({ icon: 'terminal', label: 'Run', detail: 'ls -la' })
  })
  it('relativizes only under the root', () => {
    expect(vaultPath(`${ROOT}/x.md`, ROOT)).toBe('x.md')
    expect(vaultPath('/elsewhere/x.md', ROOT)).toBeNull()
    expect(vaultPath('/abs.md', null)).toBeNull()
  })
})

describe('Ask first asks about writes', () => {
  it('allows the read verbs, with and without --json, and help', () => {
    const rules = readRules()
    expect(rules).toContain('Bash(llm-wiki-ops op since:*)')
    expect(rules).toContain('Bash(llm-wiki-ops --json page ls:*)')
    expect(rules).toContain('Bash(llm-wiki-ops --help:*)')
    expect(rules).toContain('Bash(llm-wiki-ops jobs --help:*)')
  })
  it('lists no verb that writes', () => {
    for (const w of ['page edit', 'page curate', 'jobs request', 'git commit', 'credentials get', 'credentials ls', 'hooks session-start'])
      expect(READ_VERBS as readonly string[]).not.toContain(w)
  })
})

describe('an opened row', () => {
  it('shows the whole command, under its description when the agent gave one', () => {
    expect(toolDetail('Bash', { command: 'llm-wiki-ops op since 24h', description: 'Recent runs' }, undefined)).toEqual([{ label: 'Recent runs', text: 'llm-wiki-ops op since 24h', kind: 'code' }])
  })
  it('shows an edit as a diff', () => {
    expect(toolDetail('Edit', { file_path: '/w/a.md', old_string: 'a\nb', new_string: 'c' }, undefined)).toEqual([{ label: 'Edit', text: '- a\n- b\n+ c', kind: 'diff' }])
  })
  it('falls back to the input for a tool it does not know', () => {
    expect(toolDetail('mcp__x__y', { q: 1 }, undefined)[0]?.text).toBe('{\n  "q": 1\n}')
  })
  it('clips long output and says how much', () => {
    const long = Array.from({ length: 50 }, (_, i) => String(i)).join('\n')
    expect(clip(long).split('\n')).toHaveLength(41)
    expect(clip(long).endsWith('… 10 more lines')).toBe(true)
  })
  it('counts a group in words', () => {
    expect(groupSummary(['Bash', 'Bash', 'Read', 'Skill'])).toBe('Ran 2 commands · read 1 file · used 1 skill')
    expect(groupSummary(['Edit', 'Write', 'Grep'])).toBe('Changed 2 files · searched 1 time')
  })
})
