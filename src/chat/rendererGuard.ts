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
  events.setMaxListeners = (n?: number, ...targets: unknown[]): void => {
    const own = targets.filter((t) => t instanceof events.EventEmitter || isNodeTarget(t))
    if (targets.length === 0 || own.length > 0) original(n, ...(own as Parameters<typeof original>[1][]))
  }
}

function isNodeTarget(t: unknown): boolean {
  try {
    events.setMaxListeners(1, t as EventTarget)
    return true
  } catch {
    return false
  }
}
