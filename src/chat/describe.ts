// A tool call as a row a person reads: an icon, a verb, and what it touched.
// A file the agent read or wrote under the wiki is named by its vault path, so
// the row can open it.

export interface ToolRow {
  icon: string
  label: string
  /** The command, path, pattern or URL; shown monospace and muted. */
  detail?: string
  /** A vault path the row opens on a click: a markdown page inside the wiki. */
  open?: string
}

const FILE_TOOLS: Record<string, [string, string]> = {
  Read: ['file-text', 'Read'],
  Write: ['file-plus', 'Write'],
  Edit: ['pencil', 'Edit'],
  MultiEdit: ['pencil', 'Edit'],
  NotebookEdit: ['pencil', 'Edit'],
}

/** `abs` relative to the wiki root, or null when it lies outside it. A relative path is already the vault's. */
export function vaultPath(abs: string, root: string | null): string | null {
  if (!abs.startsWith('/')) return abs.replace(/^\.\//, '') || null
  if (!root) return null
  const base = root.replace(/\/+$/, '')
  return abs.startsWith(`${base}/`) ? abs.slice(base.length + 1) : null
}

const str = (input: Record<string, unknown> | undefined, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = input?.[k]
    if (typeof v === 'string' && v) return v
  }
  return undefined
}

/**
 * `sentence` is the llm-wiki command in words, when there is one
 * (`toolSentence`); `detail` the harness's own summary, used where `input`
 * did not come along (a sandboxed turn's lines carry only the summary).
 */
export function describeTool(name: string, input: Record<string, unknown> | undefined, detail: string | undefined, root: string | null, sentence: string | null = null): ToolRow {
  const file = FILE_TOOLS[name]
  if (file) {
    const path = str(input, 'file_path', 'notebook_path') ?? detail
    if (!path) return { icon: file[0], label: file[1] }
    const rel = vaultPath(path, root)
    return { icon: file[0], label: file[1], detail: rel ?? path, open: rel && /\.md$/i.test(rel) && !rel.startsWith('.') ? rel : undefined }
  }
  switch (name) {
    case 'Bash':
      return sentence ? { icon: 'terminal', label: sentence } : { icon: 'terminal', label: 'Run', detail: str(input, 'command') ?? detail }
    case 'Grep':
      return { icon: 'search', label: 'Search files', detail: str(input, 'pattern') ?? detail }
    case 'Glob':
      return { icon: 'folder-search', label: 'Find files', detail: str(input, 'pattern') ?? detail }
    case 'Skill': {
      const skill = str(input, 'skill', 'command')
      const args = str(input, 'args')
      return { icon: 'sparkles', label: 'Skill', detail: skill ? `${skill}${args ? ` · ${args}` : ''}` : detail }
    }
    case 'WebFetch':
      return { icon: 'globe', label: 'Fetch', detail: str(input, 'url') ?? detail }
    case 'WebSearch':
      return { icon: 'globe', label: 'Search the web', detail: str(input, 'query') ?? detail }
    case 'Task':
    case 'Agent':
      return { icon: 'bot', label: 'Agent', detail: str(input, 'description') ?? detail }
    case 'TodoWrite':
      return { icon: 'list-checks', label: 'Update the plan' }
    default:
      return { icon: 'wrench', label: name, detail }
  }
}

/** One block of an opened row: the command, an edit, the output. */
export interface DetailBlock {
  label: string
  text: string
  /** `diff` colors lines by their `+`/`-`. */
  kind: 'code' | 'diff'
}

/** Lines an opened row shows of any one block before it says how many it left out. */
export const DETAIL_LINES = 40

/** `text` cut to `DETAIL_LINES`, saying what was left out. */
export function clip(text: string, lines = DETAIL_LINES): string {
  const all = text.replace(/\s+$/, '').split('\n')
  if (all.length <= lines) return all.join('\n')
  return `${all.slice(0, lines).join('\n')}\n… ${all.length - lines} more lines`
}

const diffOf = (before: string, after: string): string =>
  [...before.split('\n').map((l) => `- ${l}`), ...after.split('\n').map((l) => `+ ${l}`)].join('\n')

/** What an opened row shows about the call itself; the output joins it when the result lands. */
export function toolDetail(name: string, input: Record<string, unknown> | undefined, detail: string | undefined): DetailBlock[] {
  const s = (k: string) => (typeof input?.[k] === 'string' ? (input[k]) : undefined)
  switch (name) {
    case 'Bash': {
      const command = s('command') ?? detail
      const blocks: DetailBlock[] = command ? [{ label: s('description') ?? 'Command', text: command, kind: 'code' }] : []
      return blocks
    }
    case 'Edit': {
      const before = s('old_string')
      const after = s('new_string')
      return before !== undefined && after !== undefined ? [{ label: input?.replace_all ? 'Edit, every match' : 'Edit', text: clip(diffOf(before, after)), kind: 'diff' }] : []
    }
    case 'MultiEdit': {
      const edits = Array.isArray(input?.edits) ? (input.edits as { old_string?: string; new_string?: string }[]) : []
      return edits.length ? [{ label: `${edits.length} edits`, text: clip(edits.map((e) => diffOf(e.old_string ?? '', e.new_string ?? '')).join('\n…\n')), kind: 'diff' }] : []
    }
    case 'Write':
      return s('content') !== undefined ? [{ label: 'Content', text: clip(s('content')!), kind: 'code' }] : []
    case 'Read': {
      const from = input?.offset
      const n = input?.limit
      return typeof from === 'number' || typeof n === 'number' ? [{ label: 'Lines', text: `${typeof from === 'number' ? `from ${from}` : 'from the top'}${typeof n === 'number' ? `, ${n} lines` : ''}`, kind: 'code' }] : []
    }
    case 'Grep':
    case 'Glob': {
      const parts = ['pattern', 'path', 'glob', 'type'].map((k) => (s(k) ? `${k}: ${s(k)}` : '')).filter(Boolean)
      return parts.length ? [{ label: 'Search', text: parts.join('\n'), kind: 'code' }] : []
    }
    case 'Skill':
      return s('args') ? [{ label: 'Arguments', text: s('args')!, kind: 'code' }] : []
    default: {
      const keys = input ? Object.keys(input) : []
      if (keys.length) return [{ label: 'Input', text: clip(JSON.stringify(input, null, 2)), kind: 'code' }]
      return detail ? [{ label: 'Input', text: detail, kind: 'code' }] : []
    }
  }
}

/** A group's one line: `Ran 3 commands · read 1 file`. */
export function groupSummary(names: string[]): string {
  const count = (pred: (n: string) => boolean) => names.filter(pred).length
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const parts: string[] = []
  const ran = count((n) => n === 'Bash')
  const read = count((n) => n === 'Read')
  const edited = count((n) => n in FILE_TOOLS && n !== 'Read')
  const searched = count((n) => n === 'Grep' || n === 'Glob' || n === 'WebSearch')
  const skills = count((n) => n === 'Skill')
  const rest = names.length - ran - read - edited - searched - skills
  if (ran) parts.push(`ran ${plural(ran, 'command')}`)
  if (read) parts.push(`read ${plural(read, 'file')}`)
  if (edited) parts.push(`changed ${plural(edited, 'file')}`)
  if (searched) parts.push(`searched ${plural(searched, 'time')}`)
  if (skills) parts.push(`used ${plural(skills, 'skill')}`)
  if (rest) parts.push(`used ${plural(rest, 'other tool')}`)
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}
