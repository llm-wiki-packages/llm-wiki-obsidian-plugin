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
