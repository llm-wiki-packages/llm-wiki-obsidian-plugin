// The sandboxed chat: each turn one jailed `harness run` session in the
// chosen sandbox, whose profile decides what it may write. Each turn is a
// fresh session, and a jailed session never prompts. A skill rides in the
// prompt as `/name`, which the harness reads the way it reads `skill=`.
import type { Cli, StreamLine } from '../wiki/cli'
import type { ChatBackend, ChatEvent, TurnContext } from './types'

export interface HarnessRunConfig {
  sandbox: string
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

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
  constructor(
    private readonly cli: Cli,
    private readonly config: HarnessRunConfig,
  ) {}

  reset(): void {
    // Nothing to forget: every turn is its own session.
  }

  async *send(prompt: string, ctx: TurnContext): AsyncIterable<ChatEvent> {
    let sawResult = false
    try {
      const lines = this.cli.stream(
        'wiki.harness.run',
        { wiki: ctx.wiki.key, text: prompt, sandbox: this.config.sandbox, model: ctx.options.model, effort: ctx.options.effort },
        { signal: ctx.signal, timeoutMs: 10 * 60 * 1000 },
      )
      for await (const l of lines) {
        for (const e of mapLine(l, sawResult)) {
          if (e.type === 'result' || e.type === 'error') sawResult = true
          yield e
        }
      }
    } catch (e) {
      if (!ctx.signal.aborted) yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }
}
