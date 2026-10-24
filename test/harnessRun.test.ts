import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessRunBackend, mapTurnEnd } from '../src/chat/harnessRun'
import type { ChatEvent, TurnContext } from '../src/chat/types'
import type { Args, Cli, StreamLine } from '../src/wiki/cli'

/** A stand-in for the live `harness run --conversation` child: lines pushed by the test, writes recorded. */
class FakeConv {
  written: Record<string, unknown>[] = []
  closed = false
  exited = false
  private queue: StreamLine[] = []
  private wake: (() => void) | null = null
  push(...ls: StreamLine[]): void {
    this.queue.push(...ls)
    this.wake?.()
    this.wake = null
  }
  write(o: Record<string, unknown>): void {
    this.written.push(o)
  }
  close(): void {
    this.closed = true
  }
  lines: AsyncGenerator<StreamLine> = (async function* (self: FakeConv) {
    for (;;) {
      const n = self.queue.shift()
      if (n) yield n
      else await new Promise<void>((r) => (self.wake = r))
    }
  })(this)
}

function setup(idleMinutes = 60) {
  const convs: FakeConv[] = []
  const started: Args[] = []
  const cli = {
    conversation: (_verb: string, args: Args) => {
      started.push(args)
      const c = new FakeConv()
      convs.push(c)
      return c
    },
  } as unknown as Cli
  const backend = new HarnessRunBackend(cli, { sandbox: 'read-search', idleMinutes: () => idleMinutes })
  return { backend, convs, started }
}

const ctx = (signal = new AbortController().signal): TurnContext =>
  ({ wiki: { key: 'kb', name: 'KB', root: '/kb' }, signal, askPermission: () => Promise.resolve({ allow: true }), options: { permissionMode: 'default', readOnly: false } })

async function collect(it: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const at = (a: FakeConv[], i: number): FakeConv => a[i] as FakeConv
const end = (outcome: string, extra: Record<string, unknown> = {}): StreamLine => ({ type: 'turn_end', outcome, ...extra })

afterEach(() => vi.useRealTimers())

describe('turn_end into chat events', () => {
  it('ok is a result, with the context ahead of it', () => {
    expect(mapTurnEnd({ type: 'turn_end', outcome: 'ok', context: { used: 10, window: 100 } })).toEqual([
      { type: 'context', used: 10, window: 100 },
      { type: 'result', ok: true, detail: 'ok' },
    ])
  })
  it('interrupted is a stopped status, then a result', () => {
    expect(mapTurnEnd({ type: 'turn_end', outcome: 'interrupted' })).toEqual([
      { type: 'status', text: 'stopped' },
      { type: 'result', ok: false, detail: 'interrupted' },
    ])
  })
  it('failed is an error carrying the message', () => {
    expect(mapTurnEnd({ type: 'turn_end', outcome: 'failed', message: 'boom' })).toEqual([{ type: 'error', message: 'boom' }])
  })
})

describe('the sandboxed chat holds one session', () => {
  it('starts with the prompt as the first turn and ends the send at turn_end', async () => {
    const { backend, convs, started } = setup()
    const run = collect(backend.send('hello', ctx()))
    at(convs, 0).push({ type: 'start' }, { type: 'text', text: 'hi' }, end('ok', { context: { used: 5, window: 50 } }))
    expect(await run).toEqual([
      { type: 'start' },
      { type: 'text', text: 'hi' },
      { type: 'context', used: 5, window: 50 },
      { type: 'result', ok: true, detail: 'ok' },
    ])
    expect(started).toEqual([expect.objectContaining({ wiki: 'kb', text: 'hello', sandbox: 'read-search', conversation: true })])
    expect(at(convs, 0).written).toEqual([])
  })

  it('writes a turn line for the next send and does not start another child', async () => {
    const { backend, convs } = setup()
    const first = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('ok'))
    await first
    const second = collect(backend.send('two', ctx()))
    at(convs, 0).push({ type: 'text', text: 'b' }, end('ok'))
    expect(await second).toEqual([{ type: 'text', text: 'b' }, { type: 'result', ok: true, detail: 'ok' }])
    expect(convs).toHaveLength(1)
    expect(at(convs, 0).written).toEqual([{ type: 'turn', text: 'two' }])
  })

  it('stop sends an interrupt and leaves the session open', async () => {
    const { backend, convs } = setup()
    const ac = new AbortController()
    const run = collect(backend.send('one', ctx(ac.signal)))
    await Promise.resolve()
    ac.abort()
    expect(at(convs, 0).written).toEqual([{ type: 'interrupt' }])
    expect(at(convs, 0).closed).toBe(false)
    at(convs, 0).push(end('interrupted'))
    expect(await run).toEqual([{ type: 'status', text: 'stopped' }, { type: 'result', ok: false, detail: 'interrupted' }])
    const next = collect(backend.send('two', ctx()))
    at(convs, 0).push(end('ok'))
    await next
    expect(convs).toHaveLength(1)
  })

  it('swallows an idle refusal: the interrupt came after its turn had ended', async () => {
    const { backend, convs } = setup()
    const ac = new AbortController()
    const run = collect(backend.send('one', ctx(ac.signal)))
    await Promise.resolve()
    ac.abort()
    at(convs, 0).push({ type: 'input_refused', reason: 'idle', message: 'nothing is running' }, end('ok'))
    expect(await run).toEqual([{ type: 'result', ok: true, detail: 'ok' }])
  })

  it('surfaces every other refusal, known reason or not, with the CLI message', async () => {
    for (const reason of ['busy', 'bad_prompt', 'bad_line', 'some_future_reason']) {
      const { backend, convs } = setup()
      const first = collect(backend.send('one', ctx()))
      at(convs, 0).push(end('ok'))
      await first
      const next = collect(backend.send('two', ctx()))
      at(convs, 0).push({ type: 'input_refused', reason, message: `no: ${reason}` })
      expect(await next).toEqual([{ type: 'error', message: `no: ${reason}` }])
    }
  })

  it('a no_conversation refusal reads as a note and the next send does not claim a restart', async () => {
    const { backend, convs } = setup()
    const run = collect(backend.send('one', ctx()))
    at(convs, 0).push({ type: 'error', error: 'no_conversation', message: 'sandbox writes in the wiki' })
    expect(await run).toEqual([{ type: 'error', message: 'sandbox writes in the wiki' }])
    const next = collect(backend.send('two', ctx()))
    at(convs, 1).push({ type: 'error', error: 'no_conversation', message: 'sandbox writes in the wiki' })
    expect(await next).toEqual([{ type: 'error', message: 'sandbox writes in the wiki' }])
  })

  it('a refused turn ends the send with the CLI message', async () => {
    const { backend, convs } = setup()
    const first = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('ok'))
    await first
    const next = collect(backend.send('two', ctx()))
    at(convs, 0).push({ type: 'input_refused', message: 'a turn is running' })
    expect(await next).toEqual([{ type: 'error', message: 'a turn is running' }])
  })

  it('a failed turn is an error and the session lives', async () => {
    const { backend, convs } = setup()
    const run = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('failed', { message: 'boom' }))
    expect(await run).toEqual([{ type: 'error', message: 'boom' }])
    const next = collect(backend.send('two', ctx()))
    at(convs, 0).push(end('ok'))
    await next
    expect(convs).toHaveLength(1)
  })

  it('reset closes stdin and the next send starts fresh without a note', async () => {
    const { backend, convs } = setup()
    const first = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('ok'))
    await first
    backend.reset()
    expect(at(convs, 0).closed).toBe(true)
    const next = collect(backend.send('two', ctx()))
    at(convs, 1).push(end('ok'))
    expect((await next)[0]).toEqual({ type: 'result', ok: true, detail: 'ok' })
  })

  it('a session that died restarts on the next send and says earlier turns are forgotten', async () => {
    const { backend, convs } = setup()
    const first = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('ok'))
    await first
    at(convs, 0).exited = true
    const next = collect(backend.send('two', ctx()))
    at(convs, 1).push(end('ok'))
    expect(await next).toEqual([
      { type: 'status', text: 'The sandboxed chat restarted; earlier turns are forgotten' },
      { type: 'result', ok: true, detail: 'ok' },
    ])
    expect(convs).toHaveLength(2)
  })

  it('the stream ending mid-turn ends the send with the exit, and the session is gone', async () => {
    const { backend, convs } = setup()
    const run = collect(backend.send('one', ctx()))
    at(convs, 0).push({ type: '_exit', rc: 2, stderr: 'refused', timedOut: false })
    expect(await run).toEqual([{ type: 'error', message: 'harness run exited 2: refused' }])
    const next = collect(backend.send('two', ctx()))
    at(convs, 1).push(end('ok'))
    await next
    expect(convs).toHaveLength(2)
  })

  it('a stream error ends the send', async () => {
    const { backend, convs } = setup()
    const run = collect(backend.send('one', ctx()))
    at(convs, 0).push({ type: 'error', message: 'timeout' })
    expect(await run).toEqual([{ type: 'error', message: 'timeout' }])
  })
})

describe('idle close', () => {
  it('closes stdin after the idle minutes with no turn running, not during one', async () => {
    vi.useFakeTimers()
    const { backend, convs } = setup(5)
    const run = collect(backend.send('one', ctx()))
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(at(convs, 0).closed).toBe(false)
    at(convs, 0).push(end('ok'))
    await run
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(at(convs, 0).closed).toBe(false)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(at(convs, 0).closed).toBe(true)
  })

  it('a new turn restarts the idle clock', async () => {
    vi.useFakeTimers()
    const { backend, convs } = setup(5)
    const a = collect(backend.send('one', ctx()))
    at(convs, 0).push(end('ok'))
    await a
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    const b = collect(backend.send('two', ctx()))
    at(convs, 0).push(end('ok'))
    await b
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(at(convs, 0).closed).toBe(false)
  })
})
