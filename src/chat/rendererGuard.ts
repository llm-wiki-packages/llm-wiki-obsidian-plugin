// Obsidian's renderer has the browser's AbortController as the global, and the
// Agent SDK hands its own signal to Node's events.setMaxListeners, which only
// accepts Node's EventTarget and throws ERR_INVALID_ARG_TYPE on the browser one.
import events from 'events'

let guarded = false

/** Lets Node's setMaxListeners ignore a target it cannot tune, once per process. */
export function tolerateRendererSignals(): void {
  if (guarded) return
  guarded = true
  const original = events.setMaxListeners.bind(events)
  // The probe calls the original, never the patched function: a probe through
  // the patch recursed until the stack ran out, and the answer depended on how deep.
  const tunable = (t: unknown): boolean => {
    if (t instanceof events.EventEmitter) return true
    try {
      original(1, t as EventTarget)
      return true
    } catch {
      return false
    }
  }
  events.setMaxListeners = (n?: number, ...targets: unknown[]): void => {
    const own = targets.filter(tunable)
    if (targets.length === 0 || own.length > 0) original(n, ...(own as EventTarget[]))
  }
}
