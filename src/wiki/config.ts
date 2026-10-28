// The wiki's config as a person sees it: what each key does, what applies now,
// and which layer says so. The CLI keeps two, the wiki's (committed, every
// machine reads it) and this machine's over it, and `config` is the one reader
// and writer of both (`OPS/commands/config/config.py`, the `config` contract,
// schema 1). One bare `config get` answers every row: its value, each layer's
// own value under `in`, where it may be written, its type, default and doc.
//
// KNOBS is not a catalog any more; the CLI's rows are. It picks the keys a
// person would look for, names and groups them, and says which ones the tab
// edits. A value is written back to the layer that sets it now, so a key a wiki
// chose to commit stays committed; a key set in neither goes where its knob says.

/** The CLI's two layers: the wiki's `.llm-wiki.toml` and this machine's `.llm-wiki.local.toml`. */
export type Layer = 'wiki' | 'local'

/** One row of `config get` (contract § 2). */
export interface ConfigRow {
  value: unknown
  /** Each layer's own value as written; a layer that does not set it is absent. */
  in: Partial<Record<Layer, unknown>>
  writable_in: Layer[]
  /** How the layers combine: `override`, `union`, `replace_table`, `wiki_only`, `local_only`, … */
  combine: string
  /** `int`, `float`, `bool`, `str`, `enum`, `list<str>`, `map`, `table`, … */
  type: string
  default: unknown
  doc?: string
  /** An `enum`'s choices. */
  values?: string[]
  /** Why no `config` command writes it, when `writable_in` is empty. */
  why?: string
}

/** `config get`'s answer. */
export interface ConfigRows {
  schema: number
  rows: Record<string, ConfigRow>
  /** A layer whose file did not parse, and why; it adds nothing to the rows. */
  problems?: Partial<Record<Layer, string | null>>
}

/** `config set|unset`'s answer. */
export interface ConfigWritten {
  schema: number
  wrote: Layer
  /** The keys the write changed; empty when it changed nothing. */
  changed: string[]
  rows: Record<string, ConfigRow>
  commit: string | null
  carried_uncommitted: boolean
  warnings: string[]
}

export interface Knob {
  /** The TOML dotted key, as `config get` names its row. */
  key: string
  name: string
  /** Shown under the name; the row's `doc` when absent. */
  desc?: string
  /** What applies when no layer sets it and the row has no default, in words. */
  unset?: string
  min?: number
  /** Where a first value goes when neither layer sets it and both may. */
  home?: Layer
  /** `value`: the tab changes it. `view`: it shows, and changing it is more than one key. */
  edit: 'value' | 'view'
}

export interface KnobGroup {
  id: string
  heading: string
  desc?: string
  knobs: Knob[]
  /** A setup that takes more than a value: install, check, then set; the agent does it. */
  chat?: { label: string; ask: string }
}

/** The stages `[runner.caps]` counts slices for, seeded by `init` and `join`. */
const STAGES: [string, string][] = [['harvest', 'Harvest'], ['transcribe', 'Transcribe'], ['enrich', 'Enrich'], ['process', 'Process'], ['routine', 'Routines'], ['handoff', 'Handoff']]

export const SEARCH_GROUP = 'search'
export const TEMPLATES = 'page.templates'
export const SEARCH_PATHS = 'search.paths'
export const SEARCH_PROPERTIES = 'search.properties'
/** A search property's kinds (`searchconf`), for one the wiki has none of yet to borrow from. */
export const PROPERTY_TYPES = ['text', 'multitext', 'checkbox', 'number', 'date', 'datetime']

export const KNOBS: KnobGroup[] = [
  { id: 'wiki', heading: 'Wiki', knobs: [
    { key: 'wiki.name', name: 'Name', desc: 'Shown in logs, prompts and this dashboard. A machine may set its own to tell two checkouts apart.', unset: 'the folder name', home: 'wiki', edit: 'value' },
  ] },
  { id: 'templates', heading: 'New page templates', desc: 'Which template a new page starts from, by the folder it lands in. The most specific folder wins; * is one folder name.', knobs: [
    { key: TEMPLATES, name: 'Templates', edit: 'value' },
  ] },
  { id: SEARCH_GROUP, heading: 'Search', desc: 'What search answers from, and what the search engine keeps. A change to folders or properties takes effect when the index is next updated.', knobs: [
    { key: SEARCH_PATHS, name: 'Searched folders', desc: 'Pages outside these folders are not searched. A machine adds to the wiki’s list.', edit: 'value' },
    { key: 'search.not_indexed', name: 'Not indexed', desc: 'Searched by grep only, kept out of the search engine. A machine’s list replaces the wiki’s.', unset: 'none', home: 'wiki', edit: 'value' },
    { key: SEARCH_PROPERTIES, name: 'Indexed properties', desc: 'Frontmatter the search engine stores, so a property filter runs there. Any other property still filters, more slowly.', edit: 'value' },
  ], chat: { label: 'Change search setup', ask: 'search' } },
  { id: 'jobs', heading: 'Jobs', knobs: [
    { key: 'jobs.defaults.model', name: 'Default model', desc: 'For every skill that names none of its own. A model name, or alternatives joined by |.', unset: 'the router’s default', home: 'wiki', edit: 'value' },
    { key: 'jobs.defaults.effort', name: 'Default effort', unset: 'the harness’s own', home: 'wiki', edit: 'value' },
    { key: 'jobs.request_gap_seconds', name: 'Run again after', desc: 'Seconds after a run lands before Run now may run the same job again.', unset: '60', min: 0, edit: 'value' },
    { key: 'harness.run_cap_seconds', name: 'Longest run', desc: 'Seconds a model session may run. The lower of this and the machine’s own cap applies.', unset: '300', min: 1, edit: 'value' },
  ] },
  { id: 'edits', heading: 'Edits', knobs: [
    { key: 'edits.settle_seconds', name: 'Wait after an edit', desc: 'Seconds a page someone touched sits unchanged before the pipeline writes it. A click here is not held by it.', min: 0, home: 'local', edit: 'value' },
    { key: 'inboxes.archive', name: 'Keep removed inbox items', desc: 'Removing an inbox item moves it to the inbox’s _archive/ instead of deleting it.', edit: 'value' },
  ] },
  { id: 'transcribe', heading: 'Transcription', desc: 'How this machine turns audio and video into transcripts. Changing the engine means installing and checking it, so the agent sets it up.', knobs: [
    { key: 'transcribe.engine', name: 'Engine', unset: 'none: this machine transcribes nothing', edit: 'view' },
    { key: 'transcribe.diarize_supported', name: 'Labels speakers', desc: 'The engine marks who is speaking. A job asks for it; this says the machine can.', edit: 'view' },
    { key: 'transcribe.model', name: 'Model', unset: 'the engine’s default', edit: 'view' },
    { key: 'transcribe.device', name: 'Device', unset: 'the engine’s default', edit: 'view' },
    { key: 'transcribe.language', name: 'Language', unset: 'detected per file', edit: 'view' },
  ], chat: { label: 'Set up transcription', ask: 'transcribe' } },
  { id: 'runner', heading: 'This machine runs at once', desc: 'How many slices of each stage this machine runs in parallel.', knobs: STAGES.map(([stage, name]) => (
    { key: `runner.caps.${stage}`, name, min: 0, edit: 'value' } satisfies Knob
  )) },
  { id: 'logging', heading: 'Logging', knobs: [
    { key: 'logging.level', name: 'Log level', desc: 'What the CLI keeps in its daily log under .llm-wiki.local/runtime/logs.', home: 'local', edit: 'value' },
    { key: 'logging.retention_days', name: 'Keep logs for', desc: 'Days; 0 keeps everything.', min: 0, home: 'local', edit: 'value' },
  ] },
  { id: 'ops', heading: 'Machinery', desc: 'Which llm-wiki runs this wiki. Changed by hand, deliberately, never from here.', knobs: [
    { key: 'ops.major', name: 'Major version', unset: 'none', edit: 'view' },
    { key: 'ops.requires', name: 'Needs at least', unset: 'any', edit: 'view' },
  ] },
]

/** The layer that answers a row: this machine's over the wiki's, both for a union both add to, or neither. */
export function sourceOf(row: Pick<ConfigRow, 'in' | 'combine'>): Layer | 'both' | null {
  const wiki = 'wiki' in row.in
  const local = 'local' in row.in
  if (wiki && local && row.combine === 'union') return 'both'
  return local ? 'local' : wiki ? 'wiki' : null
}

/** The key of the table a dotted key sits in, or null at the top. Knob keys are bare segments. */
function parentKey(key: string): string | null {
  const i = key.lastIndexOf('.')
  return i > 0 ? key.slice(0, i) : null
}

/**
 * Where a change goes, or null when no `config` command writes it: the one
 * layer it may be in; else the layer that sets it now; else, inside a table a
 * machine replaces whole, this machine when it has that table (a wiki value
 * would be hidden by it); else the knob's home, else this machine.
 */
export function targetOf(knob: Pick<Knob, 'key' | 'home'>, rows: Record<string, ConfigRow>): Layer | null {
  const row = rows[knob.key]
  if (!row || !row.writable_in.length) return null
  if (row.writable_in.length === 1) return row.writable_in[0]!
  if ('local' in row.in) return 'local'
  if ('wiki' in row.in) return 'wiki'
  const parent = parentKey(knob.key)
  if (row.combine === 'replace_table' && parent && rows[parent] && 'local' in rows[parent].in) return 'local'
  return knob.home && row.writable_in.includes(knob.home) ? knob.home : 'local'
}

/** The layer, in words, for a label. */
export function layerWords(l: Layer): string {
  return l === 'wiki' ? 'the wiki (every machine)' : 'this machine'
}

/** A value on one line. */
export function valueWords(type: string, v: unknown): string {
  if (type === 'bool') return v === true ? 'On' : 'Off'
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** What applies when no layer sets the row, in words: its default, else the knob's sentence. */
export function defaultWords(knob: Pick<Knob, 'unset'>, row: Pick<ConfigRow, 'type' | 'default'>): string {
  const d = row.default
  const empty = d === null || d === undefined || (Array.isArray(d) && !d.length)
  if (!empty) return valueWords(row.type, d)
  return knob.unset ?? (Array.isArray(d) ? 'none' : 'not set')
}

/** A typed value, checked against its row, as the text `config set` takes; or why not. The CLI parses it by the row's type. */
export function parseInput(knob: Pick<Knob, 'min'>, row: Pick<ConfigRow, 'type' | 'values'>, raw: string): { value: string } | { error: string } {
  const t = raw.trim()
  switch (row.type) {
    case 'int': {
      if (!/^\d{1,9}$/.test(t)) return { error: 'a whole number' }
      if (knob.min !== undefined && Number(t) < knob.min) return { error: `at least ${knob.min}` }
      return { value: String(Number(t)) }
    }
    case 'float':
      return /^\d{1,9}(\.\d{1,6})?$/.test(t) ? { value: t } : { error: 'a number' }
    case 'bool':
      return t === 'true' || t === 'false' ? { value: t } : { error: 'on or off' }
    case 'enum':
      return row.values?.includes(t) ? { value: t } : { error: `one of ${row.values?.filter(Boolean).join(', ')}` }
    default:
      // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
      if (!t || t.length > 200 || /[\x00-\x1f]/.test(t)) return { error: 'one line of 1–200 characters' }
      return { value: t }
  }
}

/** A list typed one entry per line, as `list<str>` takes it: trimmed, blank lines and repeats dropped. */
export function parseList(raw: string): { value: string[] } | { error: string } {
  const out: string[] = []
  for (const line of raw.split('\n').map((l) => l.trim())) {
    if (!line || out.includes(line)) continue
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (line.length > 200 || /[\x00-\x1f]/.test(line)) return { error: 'one entry per line, each up to 200 characters' }
    out.push(line)
  }
  return out.length > 100 ? { error: 'at most 100 entries' } : { value: out }
}

/** A dotted key as the nested object `config set --<layer> {json}` merges (RFC 7396): `null` removes it. */
export function patchOf(segments: string[], value: unknown): Record<string, unknown> {
  return segments.reduceRight<unknown>((inner, s) => ({ [s]: inner }), value) as Record<string, unknown>
}

const BARE = /^[A-Za-z0-9_-]+$/

/** Segments as one dotted key, quoting the ones a bare key cannot spell (`configkey.spell`). */
export function spellKey(segments: string[]): string {
  return segments.map((s) => (BARE.test(s) ? s : JSON.stringify(s))).join('.')
}

/** `page.templates` as rows, most general first, the way a person reads them. */
export function templateRows(v: unknown): { pattern: string; template: string }[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([pattern, template]) => ({ pattern, template }))
    .sort((a, b) => a.pattern.split('/').length - b.pattern.split('/').length || a.pattern.localeCompare(b.pattern))
}

/** One indexed property, as `[search.properties]` keeps it. */
export interface SearchProperty {
  name: string
  type: string
  match: string
  boost: number | null
}

/** `search.properties` as rows, by name. */
export function propertyRows(v: unknown): SearchProperty[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
    .filter((e): e is [string, Record<string, unknown>] => !!e[1] && typeof e[1] === 'object')
    .map(([name, p]) => ({ name, type: typeof p.type === 'string' ? p.type : '', match: typeof p.match === 'string' ? p.match : 'exact', boost: typeof p.boost === 'number' ? p.boost : null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** A property in words: its kind, and how it matches when not exactly. */
export function propertyWords(p: Pick<SearchProperty, 'type' | 'match' | 'boost'>): string {
  return [p.type, p.match === 'prefix' ? 'prefix' : '', p.boost !== null ? `boost ${p.boost}` : ''].filter(Boolean).join(', ')
}

/** A frontmatter key as a property name: what a person types in Obsidian's Properties, one line. */
export function propertyName(raw: string): { name: string } | { error: string } {
  const t = raw.trim()
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!t || t.length > 64 || /[\x00-\x1f".\\]/.test(t)) return { error: 'a property name of up to 64 characters, without dots or quotes' }
  return { name: t }
}

/** A folder pattern as `config` keys it: wiki-relative, no slashes at either end, `*` only as a whole segment. */
export function folderPattern(raw: string): { pattern: string } | { error: string } {
  const t = raw.trim().replace(/^\/+|\/+$/g, '')
  if (!t) return { error: 'a folder, or * for every folder' }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\x00-\x1f"\\]/.test(t) || t.length > 200) return { error: 'a folder path without quotes or backslashes' }
  const parts = t.split('/')
  if (parts.some((p) => !p || p === '.' || p === '..')) return { error: 'a folder path inside the wiki' }
  if (parts.some((p) => p.includes('*') && p !== '*')) return { error: '* stands for a whole folder name' }
  return { pattern: t }
}
