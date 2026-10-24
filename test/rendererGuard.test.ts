import events from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NodeAbortController = globalThis.AbortController
const nodeSetMaxListeners = events.setMaxListeners

/** Stands in for Blink's AbortController, whose signal Node does not recognize. */
class BrowserAbortController {
  signal = { aborted: false, addEventListener() {} }
}

let calls = 0

beforeEach(() => {
  vi.resetModules()
  calls = 0
  // Counts what reaches Node, so a guard that loops through itself shows as a flood.
  events.setMaxListeners = ((n?: number, ...t: EventTarget[]) => {
    calls++
    return nodeSetMaxListeners(n, ...t)
  }) as typeof events.setMaxListeners
})

afterEach(() => {
  globalThis.AbortController = NodeAbortController
  events.setMaxListeners = nodeSetMaxListeners
})

async function guard(): Promise<void> {
  const { tolerateRendererSignals } = await import('../src/chat/rendererGuard')
  tolerateRendererSignals()
}

describe('tolerateRendererSignals', () => {
  it('lets the SDK tune a browser AbortSignal without throwing, and asks Node once', async () => {
    globalThis.AbortController = BrowserAbortController as unknown as typeof AbortController
    const signal = new AbortController().signal
    await guard()
    calls = 0
    expect(() => events.setMaxListeners(50, signal)).not.toThrow()
    expect(calls).toBe(1)
  })

  it('still tunes emitters and the default', async () => {
    await guard()
    const em = new events.EventEmitter()
    events.setMaxListeners(7, em)
    expect(em.getMaxListeners()).toBe(7)
    events.setMaxListeners(11)
    expect(events.defaultMaxListeners).toBe(11)
  })
})
