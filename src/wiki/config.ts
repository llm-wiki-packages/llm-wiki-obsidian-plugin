// The wiki's config knobs as a person sees them: what each does, what it is
// now, and which file says so. The CLI keeps two files, the committed
// `.llm-wiki.toml` every machine reads and this machine's `.llm-wiki.local.toml`
// over it, and `config get|set|unset` reads and writes them
// (`OPS/commands/config/config.py`).
//
// KNOBS is a stand-in for a `config ls` the CLI does not have yet: the keys,
// what kind of value each takes, and which file may hold it. It lists only what
// a person would look for, not every key the CLI knows. A value is written back
// to the file it is set in now, so a key a wiki chose to commit stays committed;
// a key set in neither file goes where its knob says.

/** Which file a key may be set in: `committed` and `local` are the CLI's own refusals, `either` is the ladder. */
export type Scope = 'committed' | 'local' | 'either'
export type Place = 'committed' | 'local'

export interface Knob {
  /** The TOML dotted key, as `config get` takes it. */
  key: string
  name: string
  desc?: string
  type: 'text' | 'int' | 'bool' | 'enum' | 'map'
  options?: readonly string[]
  min?: number
  /** What applies when neither file sets it, in words. */
  unset: string
  scope: Scope
  /** Where a first value goes when neither file sets it, for an `either` key. */
  home?: Place
  /** `value`: one `config set` is the whole change. `view`: it shows, and changing it is more than one key. */
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

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const LOG_LEVELS = ['off', 'error', 'info', 'debug'] as const
export const TRANSCRIBE_ENGINES = ['faster-whisper', 'macparakeet', 'parakeet-onnx'] as const
/** The stages `[runner.caps]` counts slices for, seeded by `init` and `join`. */
const STAGES: [string, string, number][] = [['harvest', 'Harvest', 1], ['transcribe', 'Transcribe', 1], ['enrich', 'Enrich', 2], ['process', 'Process', 2], ['routine', 'Routines', 1], ['handoff', 'Handoff', 1]]

/** The search table is read by search's own rules and refused by `config`; the tab draws it from `search status`. */
export const SEARCH_GROUP = 'search'

export const KNOBS: KnobGroup[] = [
  { id: 'wiki', heading: 'Wiki', knobs: [
    { key: 'wiki.name', name: 'Name', desc: 'Shown in logs, prompts and this dashboard. A machine may set its own to tell two checkouts apart.', type: 'text', unset: 'the folder name', scope: 'either', home: 'committed', edit: 'value' },
  ] },
  { id: 'templates', heading: 'New page templates', desc: 'Which template a new page starts from, by the folder it lands in. The most specific folder wins; * is one folder name.', knobs: [
    { key: 'page.templates', name: 'Templates', type: 'map', unset: 'no template', scope: 'committed', edit: 'value' },
  ] },
  { id: SEARCH_GROUP, heading: 'Search', desc: 'What search answers from, and what the search engine keeps. A change here can mean rebuilding the index, so the agent makes it with you.', knobs: [],
    chat: { label: 'Change search setup', ask: 'search' } },
  { id: 'jobs', heading: 'Jobs', knobs: [
    { key: 'jobs.defaults.model', name: 'Default model', desc: 'For every skill that names none of its own. A model name, or alternatives joined by |.', type: 'text', unset: 'the router’s default', scope: 'either', home: 'committed', edit: 'value' },
    { key: 'jobs.defaults.effort', name: 'Default effort', type: 'enum', options: EFFORTS, unset: 'the harness’s own', scope: 'either', home: 'committed', edit: 'value' },
    { key: 'jobs.request_gap_seconds', name: 'Run again after', desc: 'Seconds after a run lands before Run now may run the same job again.', type: 'int', min: 0, unset: '60 seconds', scope: 'committed', edit: 'value' },
    { key: 'harness.run_cap_seconds', name: 'Longest run', desc: 'Seconds a model session may run. The lower of this and the machine’s own cap applies.', type: 'int', min: 1, unset: '300 seconds', scope: 'committed', edit: 'value' },
  ] },
  { id: 'edits', heading: 'Edits', knobs: [
    { key: 'edits.settle_seconds', name: 'Wait after an edit', desc: 'Seconds a page someone touched sits unchanged before the pipeline writes it. A click here is not held by it.', type: 'int', min: 0, unset: '600 seconds', scope: 'either', home: 'local', edit: 'value' },
    { key: 'inboxes.archive', name: 'Keep removed inbox items', desc: 'Removing an inbox item moves it to the inbox’s _archive/ instead of deleting it.', type: 'bool', unset: 'off', scope: 'committed', edit: 'value' },
  ] },
  { id: 'transcribe', heading: 'Transcription', desc: 'How this machine turns audio and video into transcripts. Changing the engine means installing and checking it, so the agent sets it up.', knobs: [
    { key: 'transcribe.engine', name: 'Engine', type: 'enum', options: TRANSCRIBE_ENGINES, unset: 'none: this machine transcribes nothing', scope: 'either', home: 'local', edit: 'view' },
    { key: 'transcribe.diarize_supported', name: 'Labels speakers', desc: 'The engine marks who is speaking. A job asks for it; this says the machine can.', type: 'bool', unset: 'off', scope: 'either', home: 'local', edit: 'view' },
    { key: 'transcribe.model', name: 'Model', type: 'text', unset: 'the engine’s default', scope: 'either', home: 'local', edit: 'view' },
    { key: 'transcribe.device', name: 'Device', type: 'text', unset: 'the engine’s default', scope: 'either', home: 'local', edit: 'view' },
    { key: 'transcribe.language', name: 'Language', type: 'text', unset: 'detected per file', scope: 'either', home: 'local', edit: 'view' },
  ], chat: { label: 'Set up transcription', ask: 'transcribe' } },
  { id: 'runner', heading: 'This machine runs at once', desc: 'How many slices of each stage this machine runs in parallel.', knobs: STAGES.map(([stage, name, seeded]) => (
    { key: `runner.caps.${stage}`, name, type: 'int', min: 0, unset: String(seeded), scope: 'local', edit: 'value' } satisfies Knob
  )) },
  { id: 'logging', heading: 'Logging', knobs: [
    { key: 'logging.level', name: 'Log level', desc: 'What the CLI keeps in its daily log under .llm-wiki.local/runtime/logs.', type: 'enum', options: LOG_LEVELS, unset: 'error', scope: 'either', home: 'local', edit: 'value' },
    { key: 'logging.retention_days', name: 'Keep logs for', desc: 'Days; 0 keeps everything.', type: 'int', min: 0, unset: '14 days', scope: 'either', home: 'local', edit: 'value' },
  ] },
  { id: 'ops', heading: 'Machinery', desc: 'Which llm-wiki runs this wiki. Changed by hand, deliberately, never from here.', knobs: [
    { key: 'ops.major', name: 'Major version', type: 'int', unset: 'none', scope: 'committed', edit: 'view' },
    { key: 'ops.requires', name: 'Needs at least', type: 'text', unset: 'any', scope: 'committed', edit: 'view' },
  ] },
]

/** Every key the tab reads with `config get`. */
export function knobKeys(groups: KnobGroup[] = KNOBS): string[] {
  return groups.flatMap((g) => g.knobs.map((k) => k.key))
}

/** `config get`'s answer. */
export interface ConfigValue {
  key: string
  found: boolean
  value: unknown
  /** The file that answered: `.llm-wiki.toml`, `.llm-wiki.local.toml`, or both joined by ` + ` for a whole table. */
  source: string | null
}

/** `config set|unset`'s answer. */
export interface ConfigWritten {
  key: string
  value: string | null
  file: string
  removed: boolean | null
  /** Which file answers the key after the write. */
  effective_source: string | null
  commits: { sha: string; subject: string }[]
  warnings: string[]
}

export const COMMITTED_FILE = '.llm-wiki.toml'
export const LOCAL_FILE = '.llm-wiki.local.toml'

/** Which file a `source` names; null for a key neither sets, or a table both do. */
export function placeOf(source: string | null | undefined): Place | null {
  if (source === COMMITTED_FILE) return 'committed'
  if (source === LOCAL_FILE) return 'local'
  return null
}

/** Where a change goes: the file the value is in now, else the one the key must be in, else its usual home. */
export function targetOf(knob: Knob, source: string | null | undefined): Place {
  if (knob.scope !== 'either') return knob.scope
  return placeOf(source) ?? knob.home ?? 'local'
}

/** The file, in words, for a label. */
export function placeWords(p: Place): string {
  return p === 'committed' ? 'the wiki (every machine)' : 'this machine'
}

/** A value on one line. */
export function valueWords(knob: Pick<Knob, 'type'>, v: unknown): string {
  if (knob.type === 'bool') return v === true ? 'On' : 'Off'
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** A typed value, checked, as the string `config set` takes; or why not. The CLI writes digits and true/false as TOML numbers and booleans. */
export function parseInput(knob: Knob, raw: string): { value: string } | { error: string } {
  const t = raw.trim()
  switch (knob.type) {
    case 'int': {
      if (!/^\d{1,9}$/.test(t)) return { error: 'a whole number' }
      if (knob.min !== undefined && Number(t) < knob.min) return { error: `at least ${knob.min}` }
      return { value: String(Number(t)) }
    }
    case 'bool':
      return t === 'true' || t === 'false' ? { value: t } : { error: 'on or off' }
    case 'enum':
      return knob.options?.includes(t) ? { value: t } : { error: `one of ${knob.options?.join(', ')}` }
    default:
      // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
      if (!t || t.length > 200 || /[\x00-\x1f]/.test(t)) return { error: 'one line of 1–200 characters' }
      if (t.startsWith('-')) return { error: 'cannot start with a dash' }
      // A number or true/false would be written as one, and a text key would then refuse it.
      if (/^-?\d+$/.test(t) || t === 'true' || t === 'false') return { error: 'text, not a number or true/false' }
      return { value: t }
  }
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

/** Run `get` over every key, a few at a time; a key that fails reads as an error, not a hole. */
export async function readAll(keys: string[], get: (key: string) => Promise<ConfigValue>, width = 6): Promise<Record<string, ConfigValue | { error: string }>> {
  const out: Record<string, ConfigValue | { error: string }> = {}
  let next = 0
  const lane = async () => {
    while (next < keys.length) {
      const key = keys[next++]!
      try {
        out[key] = await get(key)
      } catch (e) {
        out[key] = { error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, keys.length) }, lane))
  return out
}
