import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listSkills, parseSkill, pluginDirs, slashCommand } from '../src/chat/skills'

const ADD = `---
name: add
description: >
  Use when asked to watch, follow, track, or add a source to the wiki you
  stand in — a URL, or a channel. A directory of dropped files is not a job.
argument-hint: "<url, channel or task>"
---
# add
`

describe('the chat skill list', () => {
  it('parses a folded description down to its first sentence, and the argument hint', () => {
    expect(parseSkill('add', ADD)).toEqual({ name: 'add', description: 'When asked to watch, follow, track, or add a source to the wiki you stand in — a URL, or a channel.', args: '<url, channel or task>' })
    expect(parseSkill('x', '# no frontmatter')).toEqual({ name: 'x', description: '', args: '' })
  })
  it('reads skills/<name>/SKILL.md under the llm-wiki plugin directories, the in-wiki plugin first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'llm-wiki-skills-'))
    const ops = join(home, 'ops')
    const glob = join(home, 'global')
    await mkdir(join(ops, 'skills', 'add'), { recursive: true })
    await mkdir(join(ops, 'skills', 'search'), { recursive: true })
    await mkdir(join(glob, 'skills', 'search'), { recursive: true })
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true })
    await writeFile(join(ops, 'skills', 'add', 'SKILL.md'), ADD)
    await writeFile(join(ops, 'skills', 'search', 'SKILL.md'), '---\nname: search\ndescription: In-wiki search.\n---\n')
    await writeFile(join(glob, 'skills', 'search', 'SKILL.md'), '---\nname: search\ndescription: Cross-wiki search.\n---\n')
    await writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'brain@llm-wiki-global': [{ installPath: glob }], 'brain@llm-wiki-ops-v1': [{ installPath: ops }], 'llm-wiki@llm-wiki-ops-v1': [{ installPath: home }], 'other@x': [{ installPath: home }] } }))
    const dirs = await pluginDirs(home)
    expect(dirs).toEqual([ops, glob])
    const skills = await listSkills(dirs)
    expect(skills.map((s) => `${s.name}: ${s.description}`)).toEqual(['add: When asked to watch, follow, track, or add a source to the wiki you stand in — a URL, or a channel.', 'search: In-wiki search.'])
    expect(slashCommand(skills[0]!, ' https://x ')).toBe('/brain:add https://x')
    expect(await pluginDirs(join(home, 'nowhere'))).toEqual([])
  })
})
