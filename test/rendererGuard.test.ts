import events from 'events'
import { afterEach, describe, expect, it } from 'vitest'
import { tolerateRendererSignals } from '../src/chat/rendererGuard'

const NodeAbortController = globalThis.AbortController

/** Stands in for Blink's AbortController, whose signal Node does not recognize. */
class BrowserAbortController {
  signal = { aborted: false, addEventListener() {} }
}

afterEach(() => {
  globalThis.AbortController = NodeAbortController
})

describe('tolerateRendererSignals', () => {
  it('lets the SDK tune a browser AbortSignal without throwing', () => {
    globalThis.AbortController = BrowserAbortController as unknown as typeof AbortController
    const signal = new AbortController().signal
    tolerateRendererSignals()
    expect(() => events.setMaxListeners(50, signal)).not.toThrow()
  })

  it('still tunes emitters and the default', () => {
    tolerateRendererSignals()
    const em = new events.EventEmitter()
    events.setMaxListeners(7, em)
    expect(em.getMaxListeners()).toBe(7)
    events.setMaxListeners(11)
    expect(events.defaultMaxListeners).toBe(11)
  })
})
