// The sandboxed chat: one jailed `harness run --conversation` session in the
// chosen sandbox, whose profile decides what it may write, kept alive for the
// whole chat and fed each turn on stdin. A jailed session never prompts. A
// skill rides in the prompt as `/name`, which the harness reads the way it
// reads `skill=`.
import type { Cli, Conversation, StreamLine } from '../wiki/cli'
import type { ChatBackend, ChatEvent, TurnContext } from './types'

export interface HarnessRunConfig {
  sandbox: string
  /** Read at each turn's end, so a settings change applies without a new chat. */
  idleMinutes: () => number
}

export const RESTARTED = 'The sandboxed chat restarted; earlier turns are forgotten'

// The renderer's own timers where there is a window (popout-safe); node's own in the tests, which have none.
const timers = typeof window === 'undefined' ? global : window

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

/** One `turn_end` line into chat events: the end of a turn, not of the session. Pure, for the tests. */
export function mapTurnEnd(l: Record<string, unknown>): ChatEvent[] {
  const ctx = l.context as { used?: unknown; window?: unknown } | undefined
  const context: ChatEvent[] =
    ctx && typeof ctx.used === 'number' && typeof ctx.window === 'number' ? [{ type: 'context', used: ctx.used, window: ctx.window }] : []
  switch (l.outcome) {
    case 'interrupted':
      return [...context, { type: 'status', text: 'stopped' }, { type: 'result', ok: false, detail: 'interrupted' }]
    case 'failed':
      return [...context, { type: 'error', message: str(l.message, 'the turn failed') }]
    default:
      return [...context, { type: 'result', ok: true, detail: 'ok' }]
  }
}

/** One `harness run --stream` line into chat events. Pure, for the tests. */
export function mapLine(l: StreamLine, sawResult: boolean): ChatEvent[] {
  switch (l.type) {
    case 'start':
      return [{ type: 'start' }]
    case 'text':
      return typeof l.text === 'string' ? [{ type: 'text', text: l.text }] : []
    case 'tool':
      return [{ type: 'tool', name: str(l.name), detail: typeof l.detail === 'string' ? l.detail : undefined }]
    case 'retry':
      return [{ type: 'status', text: `retry ${str(l.attempt)}/${str(l.max)}: ${str(l.error, str(l.status))}` }]
    case 'result': {
      const outcome = typeof l.outcome === 'string' ? l.outcome : 'ok'
      return [{ type: 'result', ok: outcome === 'ok', detail: outcome }]
    }
    case 'error':
      return [{ type: 'error', message: str(l.message, str(l.error, 'error')) }]
    case '_exit': {
      if (sawResult) return []
      const x = l as Extract<StreamLine, { type: '_exit' }>
      if (x.spawnError) return [{ type: 'error', message: x.spawnError }]
      if (x.timedOut) return [{ type: 'error', message: 'timed out' }]
      if (x.rc !== 0) return [{ type: 'error', message: `harness run exited ${String(x.rc)}${x.stderr ? `: ${x.stderr}` : ''}` }]
      return []
    }
    default:
      return []
  }
}

export class HarnessRunBackend implements ChatBackend {
  private conv: Conversation | null = null
  /** A session has run since the last reset, so a fresh one after it means turns were lost. */
  private hadSession = false
  private idle: ReturnType<typeof timers.setTimeout> | null = null
  private running = false

  constructor(
    private readonly cli: Cli,
    private readonly config: HarnessRunConfig,
  ) {}

  /** End the session: the CLI finishes any turn, runs its closing steps and exits. */
  reset(): void {
    this.clearIdle()
    this.conv?.close()
    this.conv = null
    this.hadSession = false
  }

  /** Quitting: same as reset, named for the caller. */
  close(): void {
    this.reset()
  }

  private clearIdle(): void {
    if (this.idle !== null) timers.clearTimeout(this.idle)
    this.idle = null
  }

  private armIdle(conv: Conversation): void {
    this.clearIdle()
    const minutes = this.config.idleMinutes()
    if (!(minutes > 0)) return
    this.idle = timers.setTimeout(() => {
      if (this.running || this.conv !== conv) return
      conv.close()
      this.conv = null
    }, minutes * 60_000)
  }

  async *send(prompt: string, ctx: TurnContext): AsyncIterable<ChatEvent> {
    this.clearIdle()
    this.running = true
    let conv = this.conv
    if (conv?.exited) conv = null
    const restarted = !conv && this.hadSession
    const first = !conv
    if (!conv) {
      conv = this.conv = this.cli.conversation(
        'wiki.harness.run',
        { wiki: ctx.wiki.key, text: prompt, sandbox: this.config.sandbox, model: ctx.options.model, effort: ctx.options.effort, conversation: true },
      )
      this.hadSession = true
    } else {
      conv.write({ type: 'turn', text: prompt })
    }
    if (restarted) yield { type: 'status', text: RESTARTED }
    const interrupt = () => {
      conv.write({ type: 'interrupt' })
    }
    if (ctx.signal.aborted) interrupt()
    ctx.signal.addEventListener('abort', interrupt, { once: true })
    // Read by hand: a `for await` that ended early would kill the child the next turn needs.
    const it = conv.lines[Symbol.asyncIterator]()
    let sawResult = false
    let turnEnded = false
    let answered = false
    try {
      while (!turnEnded) {
        const r = await it.next()
        if (r.done) break
        const l = r.value
        if (l.type === 'input_refused') {
          // Our Stop reached the CLI after the turn had already ended.
          if (l.reason === 'idle') continue
          yield { type: 'error', message: str(l.message, 'the sandboxed chat refused the input') }
          return
        }
        if (l.type === 'turn_end') {
          turnEnded = true
          answered = true
          yield* mapTurnEnd(l)
          continue
        }
        // The session's own result or error, or its exit, is the end of the session too.
        if (l.type === 'result' || l.type === 'error' || l.type === '_exit') {
          for (const e of mapLine(l, sawResult)) yield e
          sawResult = true
          this.conv = null
          // A session refused before any turn ended has nothing to forget.
          if (!answered && first) this.hadSession = false
          return
        }
        yield* mapLine(l, sawResult)
      }
    } catch (e) {
      if (!ctx.signal.aborted) yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
    } finally {
      ctx.signal.removeEventListener('abort', interrupt)
      this.running = false
      if (this.conv === conv) this.armIdle(conv)
    }
  }
}
