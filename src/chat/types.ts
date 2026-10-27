// The chat contract. The view speaks only this; a backend is one file that
// turns a harness's own protocol into these events. Adding a harness is
// adding a backend, not touching the view.
import type { Effort, PermissionMode } from '../settings'

export interface WikiTarget {
  key: string
  name: string
  /** The wiki's root on disk, which is the vault. */
  root: string
}

export type ChatEvent =
  | { type: 'start'; detail?: string }
  | { type: 'text'; text: string }
  /** `input` is the call's own arguments, when the harness hands them over; `detail` its one-line summary; `id` pairs it with its result. */
  | { type: 'tool'; name: string; detail?: string; input?: Record<string, unknown>; id?: string }
  /** A tool finished; the wiki may have changed. `output` is what it answered, when the harness says. */
  | { type: 'tool-done'; name?: string; id?: string; output?: string; error?: boolean }
  | { type: 'status'; text: string }
  | { type: 'result'; ok: boolean; text?: string; detail?: string }
  | { type: 'error'; message: string }
  /** Tokens the conversation holds now, and the model's window, as each becomes known. */
  | { type: 'context'; used?: number; window?: number }

export interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
  /** One line a person can judge: the command, the path, the URL. */
  summary: string
}

export type PermissionDecision = { allow: true; forTurn?: boolean } | { allow: false; reason?: string }

export interface TurnContext {
  wiki: WikiTarget
  signal: AbortSignal
  /** Asked only when the harness would prompt; resolves when the person clicks. */
  askPermission(req: PermissionRequest): Promise<PermissionDecision>
  onStderr?(chunk: string): void
  /** The models the harness offers, once it says; a backend that cannot say never calls it. */
  onModels?(models: ModelChoice[]): void
  /** Read at each turn, so a change under the chat box applies to the next message. */
  options: TurnOptions
}

export interface ModelChoice {
  /** What the harness is handed: an alias or an id. */
  value: string
  name: string
  efforts?: Exclude<Effort, ''>[]
  auto?: boolean
}

export interface TurnOptions {
  permissionMode: PermissionMode
  readOnly: boolean
  model?: string
  effort?: Exclude<Effort, ''>
}

/** Claude at the wiki root, or a jailed `harness run` per turn. */
export type BackendKind = 'claude' | 'sandbox'

export interface ChatBackend {
  /** The session a backend can pick up again later, when it has one. */
  sessionId?: string
  /** One turn: the events as they land, ending in a `result` or an `error`. */
  send(prompt: string, ctx: TurnContext): AsyncIterable<ChatEvent>
  /** Forget the conversation. */
  reset(): void
}

/** One line for a tool call, for the transcript and the permission card. */
export function summarizeTool(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => {
    const v = input[k]
    return typeof v === 'string' ? v : undefined
  }
  const first = s('command') ?? s('file_path') ?? s('path') ?? s('url') ?? s('pattern') ?? s('query') ?? s('prompt') ?? s('description')
  const line = (first ?? JSON.stringify(input)).replace(/\s+/g, ' ').trim()
  return line.length > 240 ? `${line.slice(0, 239)}…` : line
}
