// The chat slash skills the installed llm-wiki plugins ship, read from where Claude Code keeps them.
// Obsidian hides none of this on purpose; it just lives outside the vault.
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The Claude Code plugin namespace every typed slash command is spelled with. */
export const PLUGIN_NAMESPACE = 'brain'

/** `/<namespace>:<name>` with trimmed arguments after it. */
export function slash(name: string, args = ''): string {
  return `/${PLUGIN_NAMESPACE}:${name}${args.trim() ? ` ${args.trim()}` : ''}`
}

export interface SkillEntry {
  name: string
  /** The first sentence of the skill's description. */
  description: string
  /** What to type after it, from the frontmatter's `argument-hint`, or empty. */
  args: string
}

interface InstalledPlugins {
  plugins?: Record<string, { installPath?: string }[]>
}

/** The `llm-wiki` plugins' install directories: the in-wiki one first, so its skill wins a shared name. */
export async function pluginDirs(home = homedir()): Promise<string[]> {
  let doc: InstalledPlugins
  try {
    doc = JSON.parse(await readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as InstalledPlugins
  } catch {
    return []
  }
  const dirs: { path: string; ops: boolean }[] = []
  for (const [key, installs] of Object.entries(doc.plugins ?? {})) {
    if (!key.startsWith('llm-wiki@')) continue
    for (const i of installs) if (i.installPath) dirs.push({ path: i.installPath, ops: key.includes('ops') })
  }
  return dirs.sort((a, b) => Number(b.ops) - Number(a.ops)).map((d) => d.path)
}

/** Every `skills/<name>/SKILL.md` under the plugin directories, by name, first directory winning. */
export async function listSkills(dirs: string[]): Promise<SkillEntry[]> {
  const seen = new Map<string, SkillEntry>()
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(join(dir, 'skills'))
    } catch {
      continue
    }
    for (const name of names.sort()) {
      if (seen.has(name)) continue
      try {
        const entry = parseSkill(name, await readFile(join(dir, 'skills', name, 'SKILL.md'), 'utf8'))
        seen.set(name, entry)
      } catch {
        // a directory without a SKILL.md is not a skill
      }
    }
  }
  return [...seen.values()]
}

/** The frontmatter fields the palette shows; a folded `description: >` is joined into one line. */
export function parseSkill(name: string, md: string): SkillEntry {
  const m = /^---\n([\s\S]*?)\n---/.exec(md)
  const fm = m?.[1] ?? ''
  const field = (key: string): string => {
    const r = new RegExp(`^${key}:[ \\t]*(.*)$((?:\\n[ \\t]+.*)*)`, 'm').exec(fm)
    if (!r) return ''
    const head = (r[1] ?? '').trim()
    const rest = (r[2] ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
    const raw = head === '>' || head === '|' || head === '>-' ? rest : [head, rest].filter(Boolean).join(' ')
    return raw.replace(/^["']|["']$/g, '')
  }
  const description = field('description')
  const first = /^(.*?[.!?])(\s|$)/.exec(description)?.[1] ?? description
  return { name: field('name') || name, description: first.replace(/^Use when asked to /, 'When asked to '), args: field('argument-hint') }
}

export function slashCommand(skill: SkillEntry, args = ''): string {
  return slash(skill.name, args)
}
