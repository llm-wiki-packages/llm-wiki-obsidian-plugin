// Agent SDK messages into chat events. Pure, so a test can feed it frames.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ChatEvent } from './types'
import { summarizeTool } from './types'

interface Usage {
  input_tokens?: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  output_tokens?: number
}

export interface MappedTurn {
  sessionId?: string
  events: ChatEvent[]
}

export function mapMessage(m: SDKMessage): MappedTurn {
  const events: ChatEvent[] = []
  let sessionId: string | undefined
  switch (m.type) {
    case 'system':
      // The session's model and mode are not news; the first answer is.
      if (m.subtype === 'init') sessionId = m.session_id
      break
    case 'stream_event': {
      // Text arrives here as it is generated; a subagent's text is its own.
      if (m.parent_tool_use_id) break
      const ev = m.event as { type: string; delta?: { type?: string; text?: string } }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string')
        events.push({ type: 'text', text: ev.delta.text })
      break
    }
    case 'assistant': {
      // The complete message: tool calls with their whole input.
      if (m.parent_tool_use_id) break
      for (const block of m.message.content) {
        if (block.type === 'tool_use')
          events.push({ type: 'tool', name: block.name, detail: summarizeTool(block.name, (block.input ?? {}) as Record<string, unknown>) })
      }
      if (m.error) events.push({ type: 'error', message: `assistant: ${m.error}` })
      // The whole conversation is resent each request, so the last request's input is what the context holds.
      const u = (m.message as { usage?: Usage }).usage
      if (u) events.push({ type: 'context', used: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0) })
      break
    }
    case 'user': {
      // The harness echoes a tool's result as a user message: the change, if any, has happened by now.
      if (m.parent_tool_use_id) break
      const content = (m.message as { content?: unknown }).content
      if (Array.isArray(content) && content.some((b: { type?: string }) => b?.type === 'tool_result')) events.push({ type: 'tool-done' })
      break
    }
    case 'result':
      sessionId = m.session_id
      {
        // A helper model (a smaller one titling or classifying) rides in modelUsage too; the main one has the larger window.
        const windows = Object.values(m.modelUsage ?? {}).map((x) => x.contextWindow).filter((n) => n > 0)
        if (windows.length) events.push({ type: 'context', window: Math.max(...windows) })
      }
      if (m.subtype === 'success')
        events.push({ type: 'result', ok: !m.is_error, detail: `${(m.duration_ms / 1000).toFixed(1)}s` })
      else
        events.push({ type: 'result', ok: false, text: m.errors.join('\n') || m.subtype, detail: m.subtype })
      break
    default:
      break
  }
  return { sessionId, events }
}
