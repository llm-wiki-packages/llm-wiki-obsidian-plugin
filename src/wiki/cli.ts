// The CLI seam. Every argv the plugin ever runs is spelled here, keyed by verb,
// the way the reference dashboard does it: routes choose the verb, and nothing
// typed into Obsidian reaches a command line except as one validated argument.
import { spawn, type ChildProcess } from 'node:child_process'
import { log } from '../logger'

// The renderer's own timers where there is a window (popout-safe); node's own in the tests, which have none.
const timers = typeof window === 'undefined' ? global : window

export interface Args {
  wiki?: string
  text?: string
  k?: number
  skill?: string
  sandbox?: string
  agent?: string
  model?: string
  effort?: string
  /** `harness run`: keep the session alive for turns written to its stdin. */
  conversation?: boolean
  /** A job slug, a ticket id, or a page path, by verb. */
  slug?: string
  id?: string
  paths?: string[]
  reason?: string
  /** `op since`: an age like `1d`, `12h`. */
  since?: string
  /** `jobs request`: seconds to wait for the landing. */
  wait?: number
  /** A skill unit's name, a package, or a credential's name, by verb. */
  name?: string
  /** `credentials set`: `value` or `dir`. */
  kind?: 'value' | 'dir'
  /** `credentials set kind=dir`: the directory to adopt. */
  dir?: string
  /** `credentials bind`: the slot (`file`, `dir`, `env.NAME`, or a route) and what fills it. */
  slot?: string
  credential?: string
  /** `credentials bind`: a skill unit or a job slug. */
  subject?: 'skill' | 'job'
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
    /** The parsed answer when the CLI printed one beside a non-zero exit: a run that failed is still a run. */
    public readonly body?: unknown,
  ) {
    super(message)
  }

  /** The message without the `wiki.verb: ` prefix, for a Notice. */
  get short(): string {
    return this.message.replace(/^[a-z]+(\.[a-z]+)+: /, '')
  }
}

const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/
const TICKET = /^[A-Za-z0-9][A-Za-z0-9._#:-]{0,127}$/
const SINCE = /^\d{1,4}[hd]$/
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const REL = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\x00-\x1f]{1,512}$/
const WORD = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SKILL = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}(:[a-z0-9][a-z0-9-]{0,63})?$/
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CREDENTIAL = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const BIND_SLOT = /^[a-z][a-z0-9_]{0,31}(\.[A-Za-z_][A-Za-z0-9_]{0,63})?$/
const ABS_DIR = /^\/[^\x00-\x1f]{0,1023}$/ // eslint-disable-line no-control-regex -- rejecting control characters is the point
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const ONE_LINE = /^[^\x00-\x1f]{1,200}$/

function key(v: string | undefined): string {
  if (!v || !KEY.test(v)) throw new CliError(`bad wiki key: ${String(v)}`, 'args')
  return v
}

function word(v: string | undefined, what: string): string {
  if (!v || !WORD.test(v)) throw new CliError(`bad ${what}: ${String(v)}`, 'args')
  return v
}

function slug(v: string | undefined): string {
  if (!v || !SLUG.test(v)) throw new CliError(`bad job slug: ${String(v)}`, 'args')
  return v
}

function ticket(v: string | undefined): string {
  if (!v || !TICKET.test(v)) throw new CliError(`bad ticket id: ${String(v)}`, 'args')
  return v
}

function since(v: string | undefined, fallback: string): string {
  const t = v ?? fallback
  if (!SINCE.test(t)) throw new CliError(`bad since: ${String(v)}`, 'args')
  return `filter=since:${t}`
}

/** A vault-relative page path: no leading slash, no `..` segment. */
function rel(v: string): string {
  if (!REL.test(v)) throw new CliError(`bad page path: ${v}`, 'args')
  return v
}

function paths(v: string[] | undefined): string[] {
  if (!v?.length) throw new CliError('no paths', 'args')
  return v.map(rel)
}

/** A free-text reason is one line. */
function oneLine(v: string): string {
  const t = v.trim()
  if (!t || !ONE_LINE.test(t)) throw new CliError('a reason is one line of 1–200 characters', 'args')
  return t
}

function credential(v: string | undefined): string {
  if (!v || !CREDENTIAL.test(v)) throw new CliError(`bad credential name: ${String(v)}`, 'args')
  return v
}

function bindSlot(v: string | undefined): string {
  if (!v || !BIND_SLOT.test(v)) throw new CliError(`bad binding slot: ${String(v)}`, 'args')
  return v
}

function unit(v: string | undefined): string {
  if (!v || !SLUG.test(v)) throw new CliError(`bad skill name: ${String(v)}`, 'args')
  return v
}

function pkg(v: string | undefined): string {
  if (!v || !PACKAGE.test(v)) throw new CliError(`bad package: ${String(v)}`, 'args')
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

function absDir(v: string): string {
  if (!ABS_DIR.test(v)) throw new CliError('a directory is an absolute path', 'args')
  return v
}

function topK(a: Args): string {
  const k = a.k ?? 20
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new CliError(`bad k: ${String(a.k)}`, 'args')
  return `filter=k:${k}`
}

/** The wiki-scoped prefix. `--read-only` sits before the selector, per the CLI grammar. */
const wiki = (a: Args, ...rest: string[]) => ['wiki', '--read-only', key(a.wiki), ...rest, '--json']

/** A wiki-scoped write: no floor flag; the verb spends or changes something the person asked for. */
const write = (a: Args, ...rest: string[]) => ['wiki', key(a.wiki), ...rest, '--json']

export const VERBS = {
  'machine.wikis.ls': () => ['machine', 'wikis', 'ls', '--json'],
  'machine.runner.ls': () => ['machine', 'runner', 'ls', '--json'],
  'wiki.doctor': (a: Args) => wiki(a, 'doctor'),
  'wiki.search.status': (a: Args) => wiki(a, 'search', 'status'),
  'wiki.jobs.ls': (a: Args) => wiki(a, 'jobs', 'ls', '--verbose'),
  'wiki.jobs.due': (a: Args) => wiki(a, 'jobs', 'due'),
  'wiki.tickets.ls': (a: Args) => wiki(a, 'tickets', 'ls'),
  'wiki.page.ls': (a: Args) => wiki(a, 'page', 'ls'),
  'wiki.git.conflicts': (a: Args) => wiki(a, 'git', 'conflicts'),
  'wiki.op.since': (a: Args) => wiki(a, 'op', 'since', since(a.since, '1d')),
  'wiki.skills.ls': (a: Args) => wiki(a, 'skills', 'ls'),
  // An exact name carries the manifest: what the unit needs and how it is used.
  'wiki.skills.show': (a: Args) => wiki(a, 'skills', 'ls', unit(a.name)),
  'wiki.skills.doctor': (a: Args) => wiki(a, 'skills', 'doctor'),
  'wiki.packages.ls': (a: Args) => wiki(a, 'packages', 'ls'),
  'wiki.packages.show': (a: Args) => wiki(a, 'packages', 'show', pkg(a.name)),
  // The CLI counts these as writes (they refresh the status store), so they run without the floor; they still show no value.
  'wiki.credentials.ls': (a: Args) => write(a, 'credentials', 'ls'),
  'wiki.credentials.bindings': (a: Args) => write(a, 'credentials', 'bindings'),
  // Writes a click asks for. None is a protected write under the attendance rule.
  'wiki.jobs.request': (a: Args) => write(a, 'jobs', 'request', slug(a.slug), ...(a.wait ? [`wait=${Math.max(1, Math.min(600, Math.trunc(a.wait)))}s`] : [])),
  'wiki.jobs.pause': (a: Args) => write(a, 'jobs', 'pause', slug(a.slug)),
  'wiki.jobs.resume': (a: Args) => write(a, 'jobs', 'resume', slug(a.slug)),
  'wiki.tickets.retry': (a: Args) => write(a, 'tickets', 'retry', ticket(a.id)),
  // Accept, or reject with a reason: `reject=` is the whole rejection.
  'wiki.page.curate': (a: Args) => write(a, 'page', 'curate', ...paths(a.paths), ...(a.reason === undefined ? [] : [`reject=${oneLine(a.reason)}`])),
  'wiki.search.index': (a: Args) => write(a, 'search', 'index'),
  // Protected writes: a person clicked, so the child is marked attended. A value arrives on stdin, never here.
  'wiki.credentials.set': (a: Args) => write(a, 'credentials', 'set', credential(a.name), `kind=${a.kind === 'dir' ? 'dir' : 'value'}`,
    ...(a.kind === 'dir' && a.dir ? [`path=${absDir(a.dir)}`] : [])),
  'wiki.credentials.bind': (a: Args) => write(a, 'credentials', 'bind', a.subject === 'job' ? 'job' : 'skill',
    a.subject === 'job' ? slug(a.slug) : unit(a.name), `${bindSlot(a.slot)}=${credential(a.credential)}`),
  'wiki.credentials.login': (a: Args) => write(a, 'credentials', 'login', credential(a.name)),
  'wiki.credentials.remove': (a: Args) => write(a, 'credentials', 'remove', credential(a.name)),
  // Mint identity into pages the wiki does not know yet.
  'wiki.page.adopt': (a: Args) => write(a, 'page', 'adopt', ...paths(a.paths)),
  // The text goes after `--`, so a query starting with a dash is never read as a flag.
  'wiki.search.query': (a: Args) => [
    'wiki', '--read-only', key(a.wiki), 'search', 'query', topK(a), '--json', '--', text(a.text),
  ],
  // One question in a jailed harness session, streamed as JSON lines: the sandboxed chat. With
  // `--conversation` the question is the first turn and later turns arrive as JSON lines on stdin.
  // The one verb without the read floor, since it spends model budget.
  'wiki.harness.run': (a: Args) => [
    'wiki', key(a.wiki), 'harness', 'run', `sandbox=${word(a.sandbox, 'sandbox')}`,
    ...(a.skill ? [`skill=${skill(a.skill)}`] : []),
    ...(a.agent ? [`agent=${word(a.agent, 'agent')}`] : []),
    ...(a.model ? [`model=${word(a.model, 'model')}`] : []),
    ...(a.effort ? [`effort=${word(a.effort, 'effort')}`] : []),
    '--stream', ...(a.conversation ? ['--conversation'] : []), '--', question(a.text),
  ],
} as const

export type Verb = keyof typeof VERBS

/** Writes a person asked for by clicking; the ones the CLI would otherwise ask a terminal to confirm are marked attended. */
const ATTENDED: ReadonlySet<Verb> = new Set<Verb>(['wiki.credentials.set', 'wiki.credentials.bind', 'wiki.credentials.login', 'wiki.credentials.remove'])

const WRITES: ReadonlySet<Verb> = new Set<Verb>([
  'wiki.harness.run', 'wiki.jobs.request', 'wiki.jobs.pause', 'wiki.jobs.resume', 'wiki.tickets.retry', 'wiki.page.curate', 'wiki.page.adopt', 'wiki.search.index',
  'wiki.credentials.ls', 'wiki.credentials.bindings', ...ATTENDED,
])

/** The child's environment: the read floor unless the verb writes, and the attendance mark on a protected write. */
export function childEnv(base: NodeJS.ProcessEnv, verb: Verb): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  if (WRITES.has(verb)) delete env.LLM_WIKI_PERMISSIONS
  else env.LLM_WIKI_PERMISSIONS = 'read'
  if (ATTENDED.has(verb)) env.LLM_WIKI_SESSION_ATTENDED = '1'
  else delete env.LLM_WIKI_SESSION_ATTENDED
  return env
}

/** One JSON line a streaming verb printed. The runner ends every stream with its own `_exit` line. */
export type StreamLine =
  | { type: '_exit'; rc: number | null; stderr: string; timedOut: boolean; spawnError?: string }
  | { type: string; [k: string]: unknown }

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  /** Bytes for the child's stdin, closed after; a secret travels this way and never through argv. */
  stdin?: string
}

/** A running streaming child whose stdin stays open: write turns, read lines, close to end it. */
export interface Conversation {
  /** Every JSON line the child prints, then its own `_exit`. Leaving the loop early kills the child. */
  lines: AsyncGenerator<StreamLine>
  /** One JSON line to the child's stdin. */
  write(obj: Record<string, unknown>): void
  /** End of input: the child finishes the turn it is on and exits. */
  close(): void
  /** The child is gone, whether or not its `_exit` line has been read. */
  readonly exited: boolean
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

  /** Every child still running, taken down together on unload. */
  killAll(): void {
    for (const c of this.live) killGroup(c)
  }

  run<T = unknown>(verb: Verb, args: Args = {}, opts: RunOptions = {}): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs
    const argv = [...(this.config.prefix ?? []), ...VERBS[verb](args)]
    const started = Date.now()
    return new Promise<T>((resolve, reject) => {
      const child = spawn(this.config.bin, argv, {
        env: childEnv(this.config.env, verb),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
      this.live.add(child)
      // Closed at once, empty or with the secret: no verb here waits on a terminal. A child that exits first makes EPIPE, not news.
      child.stdin.on('error', () => undefined)
      child.stdin.end(opts.stdin ?? '')
      const onAbort = () => {
        killGroup(child)
        reject(new CliError(`${verb}: cancelled`, 'exit'))
      }
      if (opts.signal?.aborted) onAbort()
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      let out = ''
      let err = ''
      const timer = timers.setTimeout(() => {
        killGroup(child)
        reject(new CliError(`${verb}: timed out after ${timeoutMs}ms`, 'timeout'))
      }, timeoutMs)
      child.stdout.on('data', (d: Buffer) => (out += d.toString()))
      child.stderr.on('data', (d: Buffer) => (err += d.toString()))
      child.on('error', (e) => {
        timers.clearTimeout(timer)
        this.live.delete(child)
        reject(new CliError(`${verb}: ${e.message}`, 'spawn'))
      })
      child.on('close', (rc) => {
        timers.clearTimeout(timer)
        this.live.delete(child)
        opts.signal?.removeEventListener('abort', onAbort)
        log.debug('cli', verb, `rc ${String(rc)}`, `${Date.now() - started}ms`, err.trim() ? tail(err) : '')
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
          reject(new CliError(`${verb}: ${errorKey ?? `rc ${rc}`}${detail ? ` — ${detail}` : ''}`, 'exit', rc ?? undefined, tail(err), parsed))
          return
        }
        resolve(parsed as T)
      })
    })
  }

  /** Runs a verb that prints JSON lines, yielding each as it lands. Leaving the loop early kills the child. */
  stream(verb: Verb, args: Args = {}, opts: RunOptions = {}): AsyncGenerator<StreamLine> {
    return this.open(verb, args, opts, false, opts.timeoutMs ?? this.config.timeoutMs).lines
  }

  /**
   * A streaming verb whose stdin stays open for lines. No overall timeout: the CLI caps each turn itself,
   * and the caller ends the session by closing stdin.
   */
  conversation(verb: Verb, args: Args = {}, opts: RunOptions = {}): Conversation {
    return this.open(verb, args, opts, true, opts.timeoutMs)
  }

  private open(verb: Verb, args: Args, opts: RunOptions, keepStdin: boolean, timeoutMs: number | undefined): Conversation {
    const argv = [...(this.config.prefix ?? []), ...VERBS[verb](args)]
    const started = Date.now()
    // Its own process group, so one signal reaches everything it started.
    const child = spawn(this.config.bin, argv, {
      env: childEnv(this.config.env, verb),
      stdio: [keepStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      detached: true,
    })
    this.live.add(child)
    // A child that exits first makes EPIPE on a late write, not news.
    child.stdin?.on('error', () => undefined)
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
      if (timer) timers.clearTimeout(timer)
      line(buf)
      buf = ''
      log.debug('cli', verb, `rc ${String(rc)}`, `${Date.now() - started}ms`, err.trim() ? tail(err) : '')
      push({ type: '_exit', rc, stderr: tail(err), timedOut, ...(spawnError ? { spawnError } : {}) })
    }
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        line(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr?.on('data', (d: Buffer) => (err = tail(err + d.toString(), 4000)))
    child.on('error', (e) => end(null, e.message))
    child.on('close', (rc) => end(rc))
    const timer =
      timeoutMs === undefined
        ? undefined
        : timers.setTimeout(() => {
            timedOut = true
            killGroup(child)
          }, timeoutMs)
    const onAbort = () => killGroup(child)
    if (opts.signal?.aborted) onAbort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const lines = (async function* (): AsyncGenerator<StreamLine> {
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
        if (timer) timers.clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        if (!ended) killGroup(child)
      }
    })()
    return {
      lines,
      write: (obj) => {
        if (ended || !child.stdin || child.stdin.destroyed || !child.stdin.writable) return
        log.debug('cli', verb, 'stdin', String(obj.type))
        child.stdin.write(`${JSON.stringify(obj)}\n`)
      },
      close: () => {
        if (child.stdin && !child.stdin.destroyed) child.stdin.end()
      },
      get exited() {
        return ended
      },
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
