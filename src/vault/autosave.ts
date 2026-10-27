// Edits made in Obsidian become history when no runner on this machine does
// it: the CLI's sweep (`git commit`) a couple of minutes after the vault goes
// quiet, at startup, and on Save now, then `git sync` when the person chose to
// sync. The sweep runs under the `editor` origin, so the CLI's settle window
// does not hold what was typed here; an older CLI still holds a page edited
// inside it, and such a page is tried again once the window has passed.
import { Notice, TAbstractFile } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { isSwept } from '../wiki/layout'

/** Quiet this long after the last save before sweeping: one commit per burst of editing. */
const QUIET_MS = 2 * 60_000
/** The CLI's default settle window, plus a margin: a page the sweep held is ready after it. */
const SETTLE_RETRY_MS = 10.5 * 60_000
/** Back from elsewhere after this long: pull what the other machines did. */
const STALE_FOCUS_MS = 10 * 60_000

export type SaveState = 'off' | 'runner' | 'idle' | 'waiting' | 'saving'

export class AutoSave {
  /** Paths changed in this vault since the last sweep that took them. */
  private readonly dirty = new Set<string>()
  private timer: number | null = null
  private running: Promise<void> | null = null
  private lastSync = 0
  state: SaveState = 'idle'

  constructor(private readonly plugin: LlmWikiPlugin) {}

  /** Wires the vault and window events; call once from onload. */
  register(): void {
    const p = this.plugin
    const touched = (f: TAbstractFile, old?: string) => {
      if (old && isSwept(old)) this.touch(old)
      if (isSwept(f.path)) this.touch(f.path)
    }
    p.app.workspace.onLayoutReady(() => {
      // Registered once the vault has loaded, so the startup scan is not a burst of edits.
      p.registerEvent(p.app.vault.on('modify', (f) => touched(f)))
      p.registerEvent(p.app.vault.on('create', (f) => touched(f)))
      p.registerEvent(p.app.vault.on('delete', (f) => touched(f)))
      p.registerEvent(p.app.vault.on('rename', (f, old) => touched(f, old)))
    })
    // Whoever committed (the runner, a terminal, another sweep), a clean tree means nothing here is unsaved.
    p.registerEvent(p.app.workspace.on('llm-wiki:snapshot' as 'layout-change', () => {
      const s = p.snapshot?.sync
      if (s && s.dirty === 0 && s.untracked === 0 && this.dirty.size && !this.running) {
        this.dirty.clear()
        this.changed()
      }
    }))
    p.registerDomEvent(window, 'focus', () => {
      if (this.mode() === 'sync' && Date.now() - this.lastSync > STALE_FOCUS_MS) void this.saveNow({ quiet: true })
    })
  }

  /** What this machine does with edits: nothing, defer to the runner, commit, or commit and sync. */
  mode(): 'off' | 'runner' | 'commit' | 'sync' {
    const p = this.plugin
    if (p.settings.saveHistory === 'off' || !p.actions) return 'off'
    if (p.snapshot?.runner) return 'runner'
    return p.settings.saveHistory === 'sync' && !this.syncBlocked() ? 'sync' : 'commit'
  }

  /** Why syncing would fight another sync, or null when it would not. */
  syncBlocked(): string | null {
    const app = this.plugin.app as unknown as { internalPlugins?: { plugins?: Record<string, { enabled?: boolean }> } }
    if (app.internalPlugins?.plugins?.sync?.enabled) return 'Obsidian Sync also syncs this vault'
    if ((this.plugin.vaultPath() ?? '').includes('/Library/Mobile Documents/')) return 'iCloud also syncs this vault'
    return null
  }

  isUnsaved(path: string): boolean {
    return this.dirty.has(path)
  }

  unsaved(): string[] {
    return [...this.dirty].sort()
  }

  /** The detect finished: catch up on whatever was left unsaved, and pull. */
  onReady(): void {
    if (this.mode() === 'commit' || this.mode() === 'sync') void this.saveNow({ quiet: true })
  }

  private touch(path: string): void {
    this.dirty.add(path)
    const m = this.mode()
    if (m !== 'commit' && m !== 'sync') return
    this.schedule(QUIET_MS)
    this.state = 'waiting'
    this.changed()
  }

  private schedule(ms: number): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.saveNow({ quiet: true })
    }, ms)
  }

  /** Sweep, then sync when chosen. `quiet` keeps a good outcome out of the Notices; a failure always says so. */
  saveNow(opts: { quiet?: boolean } = {}): Promise<void> {
    if (this.running) return this.running
    const actions = this.plugin.actions
    const m = this.mode()
    if (!actions || m === 'off') return Promise.resolve()
    this.running = (async () => {
      this.state = 'saving'
      this.changed()
      const taken = new Set(this.dirty)
      const out = await actions.commit()
      if (out.ok) {
        for (const path of taken) if (!out.settling.includes(path)) this.dirty.delete(path)
        // A page the sweep held is still being written; try it again once the window has passed.
        if (out.settling.length) this.schedule(SETTLE_RETRY_MS)
      }
      let message = out.message
      let ok = out.ok
      if (ok && m === 'sync') {
        const synced = await actions.sync()
        this.lastSync = Date.now()
        message = `${message}; ${synced.message}`
        ok = synced.ok
      }
      if (!ok || !opts.quiet) new Notice(message, ok ? 4000 : 8000)
      this.state = this.timer !== null ? 'waiting' : 'idle'
      await this.plugin.refreshSnapshot()
    })().finally(() => {
      this.running = null
      this.changed()
    })
    return this.running
  }

  /** The runner, a setting or a detect moved things; the status line follows. */
  private changed(): void {
    this.plugin.app.workspace.trigger('llm-wiki:saved')
  }

  unload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer)
  }
}
