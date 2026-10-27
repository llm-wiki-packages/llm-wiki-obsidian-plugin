// The chat slash skills: the session skills `skills ls` lists, or, from a CLI older than the skill
// manifests, what the installed `brain` plugins ship, read from where Claude Code keeps them.
// Obsidian hides none of this on purpose; it just lives outside the vault.
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The Claude Code plugin namespace every typed slash command is spelled with. */
export const PLUGIN_NAMESPACE = 'brain'

/** The notice when no installed plugin ships a skill. */
export function noSkillsMessage(): string {
  return `No ${PLUGIN_NAMESPACE} skills found under ~/.claude/plugins; install the ${PLUGIN_NAMESPACE} plugin in Claude Code first`
}

/** The skills button's tooltip. */
export function skillsButtonLabel(): string {
  return `The skills the ${PLUGIN_NAMESPACE} plugin ships; one becomes a chat turn`
}

/** `/<namespace>:<name>` with trimmed arguments after it. */
export function slash(name: string, args = ''): string {
  return `/${PLUGIN_NAMESPACE}:${name}${args.trim() ? ` ${args.trim()}` : ''}`
}

export interface SkillEntry {
  name: string
  /** The first sentence of the skill's description; the manifest's whole one from `skills ls`. */
  description: string
  /** What to type after it, from the frontmatter's `argument-hint` or the manifest's `argument_hint`, or empty. */
  args: string
  /** A wiki unit, typed `/<name>`; a plugin skill is typed `/brain:<name>`. */
  unit?: boolean
}

/** The fields of a `skills ls` row the palette reads; `mode` is absent on a CLI older than the skill manifests. */
export interface SkillsLsRow {
  name: string
  state: string | null
  from?: string | null
  mode?: string[] | null
  description?: string | null
  argument_hint?: string | null
}

/** The record form of a plugin skill's name, as `skills ls` lists it. */
export const PLUGIN_PREFIX = 'PLUGIN:'

/** Whether a `skills ls` answer comes from a CLI that reads skill manifests: some row carries a `mode` key, even a null one. */
export function hasModes(rows: SkillsLsRow[]): boolean {
  return rows.some((r) => 'mode' in r)
}

/**
 * The palette from `skills ls`: every row whose mode includes `session`, plugin skills first. A unit counts only where
 * it is enabled, since only then does `/<name>` load. Null for an older CLI, whose rows say no mode: read the plugin cache.
 */
export function paletteOf(rows: SkillsLsRow[]): SkillEntry[] | null {
  if (!hasModes(rows)) return null
  const session = rows.filter((r) => r.mode?.includes('session'))
  const plugin = session.filter((r) => r.name.startsWith(PLUGIN_PREFIX))
  const units = session.filter((r) => !r.name.startsWith(PLUGIN_PREFIX) && (r.state === 'enabled' || r.state === 'drifted' || r.state === 'linked'))
  return [
    ...plugin.map((r) => ({ name: r.name.slice(PLUGIN_PREFIX.length), description: r.description ?? '', args: r.argument_hint ?? '' })),
    ...units.map((r) => ({ name: r.name, description: r.description ?? '', args: r.argument_hint ?? '', unit: true })),
  ]
}

interface InstalledPlugins {
  plugins?: Record<string, { installPath?: string }[]>
}

/** The `brain` plugins' install directories: the in-wiki one first, so its skill wins a shared name. */
export async function pluginDirs(home = homedir()): Promise<string[]> {
  let doc: InstalledPlugins
  try {
    doc = JSON.parse(await readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as InstalledPlugins
  } catch {
    return []
  }
  const dirs: { path: string; ops: boolean }[] = []
  for (const [key, installs] of Object.entries(doc.plugins ?? {})) {
    if (!key.startsWith(`${PLUGIN_NAMESPACE}@`)) continue
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
  return skill.unit ? `/${skill.name}${args.trim() ? ` ${args.trim()}` : ''}` : slash(skill.name, args)
}
