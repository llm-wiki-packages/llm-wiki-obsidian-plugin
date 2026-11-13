// A page's audio, read from its frontmatter: the `narrate.render.<mode>` records
// the CLI's narrate stage writes (`lib/page/narrated.py`), and what the Listen
// button says about them. No CLI call: the metadata cache has every record.
//
// A record is `{file, transcript, voice, engine, at, hash, by, stage}`, or
// `{error, ...}` where the engine failed. Whether the audio is older than the text
// is the CLI's to say (`page list filter=audio:any`); see `trustStale`.

export type Fm = Record<string, unknown>

/** The modes narrate renders: `read`, the page as written; `podcast`, its webvtt script voiced. */
export const MODES = ['read', 'podcast'] as const
export type Mode = (typeof MODES)[number]

export interface Render {
  mode: Mode
  /** The MP3, wiki-relative; null on a failed record. */
  file: string | null
  transcript: string | null
  voice: string | null
  at: string | null
  error: string | null
}

export type AudioState = 'none' | 'ready' | 'stale' | 'failed'

function obj(v: unknown): Fm | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Fm) : undefined
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/** Each mode's record on the page, in `MODES` order. */
export function rendersOf(fm: Fm | undefined): Render[] {
  const render = obj(obj(fm?.narrate)?.render)
  if (!render) return []
  const out: Render[] = []
  for (const mode of MODES) {
    const r = obj(render[mode])
    if (!r) continue
    const error = 'error' in r ? (str(r.error) ?? 'the engine failed') : null
    out.push({ mode, file: error ? null : str(r.file), transcript: str(r.transcript), voice: str(r.voice), at: str(r.at), error })
  }
  return out
}

/** Does the page carry a webvtt script for `podcast` mode to voice? */
export function hasScript(body: string): boolean {
  return /^```webvtt[ \t]*$/m.test(body)
}

/**
 * Whether to believe the CLI's `stale`. On 0.18 the narrate write itself makes the audio read stale: the record
 * keeps the hash from before the audio block went in, and the hash drops the block with the blank line after it
 * (llm-wiki-plugins #4721). So a stale is believed only once the file changed well after the recording.
 */
export const STALE_GRACE_MS = 2 * 60_000

export function trustStale(at: string | null, mtimeMs: number | null): boolean {
  const t = at ? Date.parse(at) : NaN
  if (Number.isNaN(t) || mtimeMs === null) return true
  return mtimeMs > t + STALE_GRACE_MS
}

/** One mode's state: a failed record, audio the CLI calls stale, or ready. */
export function stateOf(r: Render, cli: string | undefined, mtimeMs: number | null): AudioState {
  if (r.error) return 'failed'
  if (!r.file) return 'none'
  if (cli === 'stale' && trustStale(r.at, mtimeMs)) return 'stale'
  if (cli === 'failed') return 'failed'
  return 'ready'
}

/** The page's state for the header icon: the worst mode's, failed before stale before ready. */
export function pageState(states: AudioState[]): AudioState {
  for (const s of ['failed', 'stale', 'ready'] as const) if (states.includes(s)) return s
  return 'none'
}

/** The narrate refusal that names the setup command, or null: `config set --local …` or `doctor --fix`. */
export function setupCommand(message: string | undefined): string | null {
  const m = /(llm-wiki-(?:ops|cli)\b[^\n]*?(?:config set --local|doctor --fix)[^\n]*)/.exec(message ?? '')
  return m ? m[1]!.trim() : null
}

/** `m:ss`, or `h:mm:ss` past an hour. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The speeds the player steps through. */
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75]

export function nextSpeed(now: number): number {
  const i = SPEEDS.indexOf(now)
  return SPEEDS[(i + 1) % SPEEDS.length]!
}

/** What the header icon says on hover. */
export function stateTitle(state: AudioState, working: boolean): string {
  if (working) return 'Recording this page…'
  switch (state) {
    case 'ready': return 'Listen to this page'
    case 'stale': return 'Listen · the audio is older than the text'
    case 'failed': return 'Listen · the last recording failed'
    default: return 'Listen: read this page aloud'
  }
}

export const MODE_NAMES: Record<Mode, string> = { read: 'As written', podcast: 'Episode' }
