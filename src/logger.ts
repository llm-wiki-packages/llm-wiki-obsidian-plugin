// The one console boundary.
let debugOn = false

export const log = {
  setDebug(on: boolean): void {
    debugOn = on
  },
  debug(...args: unknown[]): void {
    if (debugOn) console.debug('[llm-wiki]', ...args)
  },
  warn(...args: unknown[]): void {
    console.warn('[llm-wiki]', ...args)
  },
  error(...args: unknown[]): void {
    console.error('[llm-wiki]', ...args)
  },
}
