import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { mapMessage } from '../src/chat/claudeMap'
import { mapLine } from '../src/chat/harnessRun'
import { summarizeTool } from '../src/chat/types'

describe('Agent SDK frames into chat events', () => {
  it('reads the session id off init and says nothing else about it', () => {
    const m = { type: 'system', subtype: 'init', session_id: 's1', claude_code_version: '2.1.309', model: 'm', permissionMode: 'default' } as unknown as SDKMessage
    const r = mapMessage(m)
    expect(r.sessionId).toBe('s1')
    expect(r.events).toEqual([])
  })

  it('streams a text delta and drops a subagent delta', () => {
    const delta = (parent: string | null) =>
      ({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }) as unknown as SDKMessage
    expect(mapMessage(delta(null)).events).toEqual([{ type: 'text', text: 'hi' }])
    expect(mapMessage(delta('tool1')).events).toEqual([])
  })

  it('turns a tool_use block into a tool row with its command', () => {
    const m = { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'llm-wiki-ops jobs due' } }] } } as unknown as SDKMessage
    expect(mapMessage(m).events).toEqual([{ type: 'tool', name: 'Bash', detail: 'llm-wiki-ops jobs due' }])
  })

  it('maps success and error results', () => {
    const ok = { type: 'result', subtype: 'success', session_id: 's1', is_error: false, duration_ms: 1500, total_cost_usd: 0.01, num_turns: 2, result: 'done' } as unknown as SDKMessage
    expect(mapMessage(ok).events[0]).toMatchObject({ type: 'result', ok: true })
    const bad = { type: 'result', subtype: 'error_during_execution', session_id: 's1', is_error: true, errors: ['boom'] } as unknown as SDKMessage
    expect(mapMessage(bad).events[0]).toMatchObject({ type: 'result', ok: false, text: 'boom' })
  })
})

describe('harness run lines into chat events', () => {
  it('maps the five dashboard event types', () => {
    expect(mapLine({ type: 'start', harness: 'claude', model: 'm', sandbox: 'read-search' }, false)).toEqual([{ type: 'start', detail: 'claude · m · read-search' }])
    expect(mapLine({ type: 'text', text: 'x' }, false)).toEqual([{ type: 'text', text: 'x' }])
    expect(mapLine({ type: 'tool', name: 'Read', detail: 'wiki/a.md' }, false)).toEqual([{ type: 'tool', name: 'Read', detail: 'wiki/a.md' }])
    expect(mapLine({ type: 'result', outcome: 'ok' }, false)).toEqual([{ type: 'result', ok: true, detail: 'ok' }])
    expect(mapLine({ type: 'error', message: 'no_output_adapter' }, false)).toEqual([{ type: 'error', message: 'no_output_adapter' }])
  })

  it('reports a non-zero exit only when no result landed', () => {
    expect(mapLine({ type: '_exit', rc: 2, stderr: 'refused', timedOut: false }, false)).toEqual([{ type: 'error', message: 'harness run exited 2: refused' }])
    expect(mapLine({ type: '_exit', rc: 2, stderr: 'refused', timedOut: false }, true)).toEqual([])
  })
})

describe('summarizeTool', () => {
  it('picks the command, collapses whitespace and caps the line', () => {
    expect(summarizeTool('Bash', { command: 'ls\n  -la' })).toBe('ls -la')
    expect(summarizeTool('Read', { file_path: 'wiki/a.md' })).toBe('wiki/a.md')
    expect(summarizeTool('X', { command: 'y'.repeat(300) })).toHaveLength(240)
  })
})
