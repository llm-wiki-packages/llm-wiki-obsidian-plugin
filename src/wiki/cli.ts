// The CLI seam. Every argv the plugin ever runs is spelled here, keyed by verb,
// the way the reference dashboard does it: routes choose the verb, and nothing
// typed into Obsidian reaches a command line except as one validated argument.
import { spawn, type ChildProcess } from 'node:child_process'

// The renderer's own timers where there is a window (popout-safe); node's own in the tests, which have none.
const timers = typeof window === 'undefined' ? global : window

export interface Args {
  wiki?: string
  text?: string
  k?: number
  filters?: Record<string, string>
  skill?: string
  sandbox?: string
  agent?: string
  model?: string
  effort?: string
}

export interface CliConfig {
  /** Absolute path of `llm-wiki-cli`. */
  bin: string
  /** Argv placed before the verb, for a bin that is a launcher (`uv run llm-wiki-cli`). */
  prefix?: string[]
  /** The child's base environment; the read floor is layered on per verb. */
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly kind: 'args' | 'spawn' | 'timeout' | 'exit' | 'parse',
    public readonly rc?: number,
    public readonly stderr?: string,
  ) {
    super(message)
  }
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SKILL = /^[a-z0-9][a-z0-9-]{0,63}(:[a-z0-9][a-z0-9-]{0,63})?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const FILTER_VALUE = /^[^\x00-\x1f]{1,200}$/

export const SEARCH_KINDS = new Set([
  'author', 'group', 'group_type', 'type', 'source_host', 'area', 'tag', 'bundle_id', 'under', 'curation', 'captured_from', 'captured_to',
])

function key(v: string | undefined): string {
  if (!v || !KEY.test(v)) throw new CliError(`bad wiki key: ${String(v)}`, 'args')
  return v
}

function word(v: string | undefined, what: string): string {
  if (!v || !WORD.test(v)) throw new CliError(`bad ${what}: ${String(v)}`, 'args')
  return v
}

function skill(v: string | undefined): string {
  if (!v || !SKILL.test(v)) throw new CliError(`bad skill: ${String(v)}`, 'args')
  return v
}

/** Search text is one line. */
function text(v: string | undefined): string {
  const t = (v ?? '').trim()
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!t || t.length > 500 || /[\x00-\x1f]/.test(t)) throw new CliError('search text must be one line of 1–500 characters', 'args')
  return t
}

/** A question is one argv element: at most 8 KiB, and never dash-led, which the harness would read as a flag. */
export function question(v: string | undefined): string {
  const t = (v ?? '').trim()
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!t || /[\x00-\x08\x0b-\x1f]/.test(t) || Buffer.byteLength(t) > 8192)
    throw new CliError('a question is 1 to 8192 bytes of text', 'args')
  if (t.startsWith('-')) throw new CliError('a question cannot start with a dash', 'args')
  return t
}

function searchFilters(a: Args): string[] {
  const out: string[] = []
  const k = a.k ?? 20
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new CliError(`bad k: ${String(a.k)}`, 'args')
  out.push(`filter=k:${k}`)
  for (const [rawKind, value] of Object.entries(a.filters ?? {})) {
    const kind = rawKind.replace(/^-/, '')
    if (!SEARCH_KINDS.has(kind)) throw new CliError(`unknown filter: ${rawKind}`, 'args')
    if (!FILTER_VALUE.test(value)) throw new CliError(`bad value for ${kind}`, 'args')
    if ((kind === 'captured_from' || kind === 'captured_to') && !DATE.test(value)) throw new CliError(`${kind} must be YYYY-MM-DD`, 'args')
    out.push(`filter=${rawKind}:${value}`)
  }
  return out
}

/** The wiki-scoped prefix. `--read-only` sits before the selector, per the CLI grammar. */
const wiki = (a: Args, ...rest: string[]) => ['wiki', '--read-only', key(a.wiki), ...rest, '--json']

export const VERBS = {
  'machine.version': () => ['machine', 'version', '--json'],
  'machine.wikis.ls': () => ['machine', 'wikis', 'ls', '--json'],
  'wiki.status': (a: Args) => wiki(a, 'status'),
  'wiki.search.status': (a: Args) => wiki(a, 'search', 'status'),
  'wiki.sandboxes.ls': (a: Args) => wiki(a, 'sandboxes', 'ls', '--enabled'),
  // The text goes after `--`, so a query starting with a dash is never read as a flag.
  'wiki.search.query': (a: Args) => [
    'wiki', '--read-only', key(a.wiki), 'search', 'query', ...searchFilters(a), '--json', '--', text(a.text),
  ],
  // One question in a jailed harness session, streamed as JSON lines: the chat's safe mode.
  // The one verb without the read floor, since it spends model budget.
  'wiki.harness.run': (a: Args) => [
    'wiki', key(a.wiki), 'harness', 'run', `sandbox=${word(a.sandbox, 'sandbox')}`, `skill=${skill(a.skill)}`,
    ...(a.agent ? [`agent=${word(a.agent, 'agent')}`] : []),
    ...(a.model ? [`model=${word(a.model, 'model')}`] : []),
    ...(a.effort ? [`effort=${word(a.effort, 'effort')}`] : []),
    '--stream', '--', question(a.text),
  ],
} as const

export type Verb = keyof typeof VERBS

const WRITES: ReadonlySet<Verb> = new Set<Verb>(['wiki.harness.run'])

/** The child's environment: the read floor unless the verb writes. */
export function childEnv(base: NodeJS.ProcessEnv, verb: Verb): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  if (WRITES.has(verb)) delete env.LLM_WIKI_PERMISSIONS
  else env.LLM_WIKI_PERMISSIONS = 'read'
  return env
}

/** One JSON line a streaming verb printed. The runner ends every stream with its own `_exit` line. */
export type StreamLine =
  | { type: '_exit'; rc: number | null; stderr: string; timedOut: boolean; spawnError?: string }
  | { type: string; [k: string]: unknown }

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

function tail(s: string, n = 600): string {
  return s.length > n ? s.slice(-n) : s
}

/** SIGTERM to the child's whole process group (the CLI, the jail and the harness), then SIGKILL. */
function killGroup(child: ChildProcess): void {
  const sig = (s: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, s)
    } catch {
      // already gone
    }
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  sig('SIGTERM')
  timers.setTimeout(() => sig('SIGKILL'), 5000).unref()
}

export class Cli {
  private readonly live = new Set<ChildProcess>()

  constructor(readonly config: CliConfig) {}

  /** Every streaming child still running, taken down together on unload. */
  killStreams(): void {
    for (const c of this.live) killGroup(c)
  }

  run<T = unknown>(verb: Verb, args: Args = {}, opts: RunOptions = {}): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs
    const argv = [...(this.config.prefix ?? []), ...VERBS[verb](args)]
    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.config.bin, argv, {
        env: childEnv(this.config.env, verb),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      let err = ''
      const timer = timers.setTimeout(() => {
        child.kill('SIGTERM')
        reject(new CliError(`${verb}: timed out after ${timeoutMs}ms`, 'timeout'))
      }, timeoutMs)
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.stderr.on('data', (d: Buffer) => (err += d.toString()))
      child.on('error', (e) => {
        timers.clearTimeout(timer)
        reject(new CliError(`${verb}: ${e.message}`, 'spawn'))
      })
      child.on('close', (rc) => {
        timers.clearTimeout(timer)
        let parsed: unknown
        try {
          parsed = out.trim() ? JSON.parse(out) : undefined
        } catch {
          reject(new CliError(`${verb}: not JSON (rc ${rc}): ${tail(err || out)}`, 'parse', rc ?? undefined, tail(err)))
          return
        }
        const errorKey = (parsed as { error?: string } | undefined)?.error
        if (rc !== 0 || errorKey) {
          const detail = (parsed as { message?: string } | undefined)?.message
          reject(new CliError(`${verb}: ${errorKey ?? `rc ${rc}`}${detail ? ` — ${detail}` : ''}`, 'exit', rc ?? undefined, tail(err)))
          return
        }
        resolve(parsed as T)
      })
    })
  }

  /** Runs a verb that prints JSON lines, yielding each as it lands. Leaving the loop early kills the child. */
  async *stream(verb: Verb, args: Args = {}, opts: RunOptions = {}): AsyncGenerator<StreamLine> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs
    const argv = [...(this.config.prefix ?? []), ...VERBS[verb](args)]
    // Its own process group, so one signal reaches everything it started.
    const child = spawn(this.config.bin, argv, {
      env: childEnv(this.config.env, verb),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    this.live.add(child)
    const queue: StreamLine[] = []
    let wake: (() => void) | null = null
    const push = (l: StreamLine) => {
      queue.push(l)
      wake?.()
      wake = null
    }
    let buf = ''
    let err = ''
    let ended = false
    let timedOut = false
    const line = (raw: string) => {
      const t = raw.trim()
      if (!t) return
      try {
        const j = JSON.parse(t) as { type?: unknown }
        if (j && typeof j.type === 'string' && j.type !== '_exit') push(j as StreamLine)
      } catch {
        // not a JSON line: the CLI's own prose; stderr carries the diagnostics
      }
    }
    const end = (rc: number | null, spawnError?: string) => {
      if (ended) return
      ended = true
      this.live.delete(child)
      timers.clearTimeout(timer)
      line(buf)
      buf = ''
      push({ type: '_exit', rc, stderr: tail(err), timedOut, ...(spawnError ? { spawnError } : {}) })
    }
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        line(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr.on('data', (d: Buffer) => (err = tail(err + d.toString(), 4000)))
    child.on('error', (e) => end(null, e.message))
    child.on('close', (rc) => end(rc))
    const timer = timers.setTimeout(() => {
      timedOut = true
      killGroup(child)
    }, timeoutMs)
    const onAbort = () => killGroup(child)
    if (opts.signal?.aborted) onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (;;) {
        const next = queue.shift()
        if (next) {
          yield next
          if (next.type === '_exit') return
          continue
        }
        await new Promise<void>((r) => (wake = r))
      }
    } finally {
      timers.clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (!ended) killGroup(child)
    }
  }
}

/** What `machine wikis ls` answers, one row per registered wiki. */
export interface WikiRow {
  key: string
  name: string
  path: string
}

/** What `search query --json` answers. */
export interface SearchAnswer {
  backend?: string
  count?: number
  degraded?: boolean
  emulated_filters?: string[]
  degradations?: { kind?: string; detail?: string }[]
  hits?: {
    rank: number
    score: number | null
    locator?: string
    title?: string
    snippet?: string
    document_id?: string | null
    source_path?: string
    line?: number | null
  }[]
}
