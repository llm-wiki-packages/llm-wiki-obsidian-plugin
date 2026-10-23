// The one console boundary. Debug lines are console.debug, which Obsidian's
// developer console shows only with its Verbose level on; the setting says so.
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
