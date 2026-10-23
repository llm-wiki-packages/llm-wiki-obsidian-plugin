// Safe mode: one question in a jailed `harness run` session, read-only,
// exactly what the reference dashboard's Ask runs. Each turn is a fresh
// session; the jail cannot start a job, so this backend never prompts.
import type { Cli, StreamLine } from '../wiki/cli'
import type { ChatBackend, ChatEvent, TurnContext } from './types'

export interface HarnessRunConfig {
  sandbox: string
  skill: string
  model?: string
  effort?: string
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback)

/** One `harness run --stream` line into chat events. Pure, for the tests. */
export function mapLine(l: StreamLine, sawResult: boolean): ChatEvent[] {
  switch (l.type) {
    case 'start':
      return [{ type: 'start', detail: [l.harness, l.model, l.sandbox].filter((x) => typeof x === 'string').join(' · ') }]
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
  readonly id = 'harness-run'
  readonly label = 'Safe (jailed, read-only)'
  readonly multiTurn = false

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
        { wiki: ctx.wiki.key, text: prompt, sandbox: this.config.sandbox, skill: this.config.skill, model: this.config.model, effort: this.config.effort },
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
