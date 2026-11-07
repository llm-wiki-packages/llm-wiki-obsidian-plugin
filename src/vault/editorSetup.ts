// What a wiki's vault expects of Obsidian, which `init` seeds into a new one
// (`.obsidian/app.json`, `.obsidian/types.json`) and an older vault may lack:
// the raw captures out of Obsidian's search, graph and quick switcher, and the
// boxes a person ticks typed as checkboxes. Obsidian keeps both in memory and
// writes the files itself, so they are changed through its own config, never
// by editing the JSON under it. Neither call is public API: where one is
// missing, that part is left alone.
import type { App } from 'obsidian'
import { layout, type Layout } from '../wiki/layout'

/** The properties the seeded `types.json` makes checkboxes: the two boxes and a message's `done`. */
export function boxKeys(l: Layout = layout()): string[] {
  return [l.draftKey, l.archiveKey, 'done']
}

export interface Missing {
  /** The raw tree is not in Obsidian's excluded files. */
  raw: boolean
  /** Box keys with no type assigned; a key a person typed otherwise is theirs and stays. */
  boxes: string[]
}

export function missingSetup(ignore: unknown, typeOf: (key: string) => string | null | undefined, l: Layout = layout()): Missing {
  const dir = l.raw.replace(/\/+$/, '')
  const filters = Array.isArray(ignore) ? ignore.filter((f): f is string => typeof f === 'string') : []
  return {
    raw: !filters.some((f) => f.replace(/\/+$/, '') === dir),
    boxes: boxKeys(l).filter((k) => !typeOf(k)),
  }
}

export const nothingMissing = (m: Missing): boolean => !m.raw && !m.boxes.length

interface Internals {
  vault: { getConfig?: (key: string) => unknown; setConfig?: (key: string, value: unknown) => void }
  metadataTypeManager?: {
    getAssignedType?: (key: string) => string | null | undefined
    types?: Record<string, { type?: string } | undefined>
    setType?: (key: string, type: string) => void
  }
}

const internals = (app: App) => app as unknown as Internals

function typeOf(app: App): (key: string) => string | null | undefined {
  const m = internals(app).metadataTypeManager
  return (key) => (m?.getAssignedType ? m.getAssignedType(key) : m?.types?.[key.toLowerCase()]?.type)
}

/** What this vault lacks, as far as Obsidian lets it be read; null when neither part can be. */
export function vaultMissing(app: App): Missing | null {
  const { vault, metadataTypeManager: m } = internals(app)
  if (!vault.getConfig && !m) return null
  const found = missingSetup(vault.getConfig ? vault.getConfig('userIgnoreFilters') : [layout().raw], typeOf(app))
  return { raw: found.raw && Boolean(vault.setConfig), boxes: m?.setType ? found.boxes : [] }
}

/** Adds what is missing, keeping every filter and type already there. Says what it did. */
export function applySetup(app: App): string {
  const { vault, metadataTypeManager: m } = internals(app)
  const missing = vaultMissing(app)
  if (!missing || nothingMissing(missing)) return 'This vault already has the wiki’s Obsidian settings'
  const did: string[] = []
  if (missing.raw && vault.getConfig && vault.setConfig) {
    const now: unknown = vault.getConfig('userIgnoreFilters')
    const kept: unknown[] = Array.isArray(now) ? (now as unknown[]) : []
    vault.setConfig('userIgnoreFilters', [...kept, `${layout().raw.replace(/\/+$/, '')}/`])
    did.push(`${layout().raw}/ excluded from search and the graph`)
  }
  for (const k of missing.boxes) m?.setType?.(k, 'checkbox')
  if (missing.boxes.length) did.push(`${missing.boxes.join(', ')} shown as checkboxes`)
  return did.join('; ')
}
