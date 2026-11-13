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

/**
 * Whether one excluded-files entry already covers the raw tree: `_raw`, `_raw/`, `/_raw/`, `_raw/**`. A regex entry
 * (`/…/`) is not read; at worst the offer adds the plain one beside it.
 */
function coversRaw(filter: string, dir: string): boolean {
  return filter.replace(/^\/+/, '').replace(/(\/\*\*)?\/*$/, '') === dir
}

export function missingSetup(ignore: unknown, typeOf: (key: string) => string | null | undefined, l: Layout = layout()): Missing {
  const filters = Array.isArray(ignore) ? ignore.filter((f): f is string => typeof f === 'string') : []
  return {
    raw: !filters.some((f) => coversRaw(f, l.raw)),
    boxes: boxKeys(l).filter((k) => !typeOf(k)),
  }
}

export const nothingMissing = (m: Missing): boolean => !m.raw && !m.boxes.length

interface Internals {
  vault: { getConfig?: (key: string) => unknown; setConfig?: (key: string, value: unknown) => void }
  metadataTypeManager?: {
    /** Obsidian 1.9 and later; `getAssignedType` before. */
    getAssignedWidget?: (key: string) => string | null | undefined
    getAssignedType?: (key: string) => string | null | undefined
    /** Obsidian 1.9 and later, keyed lower-case; `types` before. */
    assignedWidgets?: Record<string, { widget?: string } | undefined>
    types?: Record<string, { type?: string } | undefined>
    setType?: (key: string, type: string) => void
  }
}

const internals = (app: App) => app as unknown as Internals

/**
 * The type a key is assigned. Obsidian renamed the call (`getAssignedType` to `getAssignedWidget`) and its table
 * (`types` to `assignedWidgets`); reading only the old names found nothing on a newer Obsidian, so the offer came
 * back on every launch though Apply had saved the types.
 */
export function typeOf(app: App): (key: string) => string | null | undefined {
  const m = internals(app).metadataTypeManager
  return (key) => {
    if (m?.getAssignedWidget) return m.getAssignedWidget(key)
    if (m?.getAssignedType) return m.getAssignedType(key)
    const k = key.toLowerCase()
    return m?.assignedWidgets?.[k]?.widget ?? m?.types?.[k]?.type
  }
}

/** What this vault lacks and Obsidian lets this plugin add; null when it exposes neither part. */
export function vaultMissing(app: App): Missing | null {
  const { vault, metadataTypeManager: m } = internals(app)
  const canFilter = Boolean(vault.getConfig && vault.setConfig)
  const canType = Boolean(m?.setType)
  if (!canFilter && !canType) return null
  const found = missingSetup(canFilter ? vault.getConfig!('userIgnoreFilters') : [], typeOf(app))
  return { raw: canFilter && found.raw, boxes: canType ? found.boxes : [] }
}

/** Adds what `missing` names, keeping every filter and type already there. Says what it did. */
export function applySetup(app: App, missing: Missing | null = vaultMissing(app)): string {
  const { vault, metadataTypeManager: m } = internals(app)
  if (!missing || nothingMissing(missing)) return 'This vault already has the wiki’s Obsidian settings'
  const did: string[] = []
  if (missing.raw && vault.getConfig && vault.setConfig) {
    const now: unknown = vault.getConfig('userIgnoreFilters')
    const kept: unknown[] = Array.isArray(now) ? (now as unknown[]) : []
    vault.setConfig('userIgnoreFilters', [...kept, `${layout().raw}/`])
    did.push(`${layout().raw}/ excluded from search and the graph`)
  }
  for (const k of missing.boxes) m?.setType?.(k, 'checkbox')
  if (missing.boxes.length) did.push(`${missing.boxes.join(', ')} shown as checkboxes`)
  return did.join('; ')
}
