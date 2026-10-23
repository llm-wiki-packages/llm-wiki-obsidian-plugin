// The chat contract. The view speaks only this; a backend is one file that
// turns a harness's own protocol into these events. Adding a harness is
// adding a backend, not touching the view.

export interface WikiTarget {
  key: string
  name: string
  /** The wiki's root on disk, which is the vault. */
  root: string
}

export type ChatEvent =
  | { type: 'start'; detail?: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'status'; text: string }
  | { type: 'result'; ok: boolean; text?: string; detail?: string }
  | { type: 'error'; message: string }

export interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
  /** One line a person can judge: the command, the path, the URL. */
  summary: string
}

export type PermissionDecision = { allow: true } | { allow: false; reason?: string }

export interface TurnContext {
  wiki: WikiTarget
  signal: AbortSignal
  /** Asked only when the harness would prompt; resolves when the person clicks. */
  askPermission(req: PermissionRequest): Promise<PermissionDecision>
  onStderr?(chunk: string): void
}

export interface ChatBackend {
  readonly id: string
  readonly label: string
  /** Whether a second turn continues the first. */
  readonly multiTurn: boolean
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
