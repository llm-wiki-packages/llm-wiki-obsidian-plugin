// Listen: a headphones icon in every wiki page's header (design-narrate-and-study.md §2).
// Its look says whether the page has audio, whether the audio is older than the
// text, or whether the last recording failed. A click opens a menu: play what
// there is, record it, or record it again. Recording is `narrate <page>`: this
// machine's narrate engine reads the page as written, no model. It takes a minute
// or more, so recordings wait in line, one at a time, and a Notice says when each
// is ready.
import { MarkdownView, Menu, Modal, Notice, TFile, type WorkspaceLeaf } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { slash } from '../chat/skills'
import { log } from '../logger'
import { CliError } from '../wiki/cli'
import { isContent } from '../wiki/layout'
import { MODE_NAMES, hasScript, pageState, rendersOf, setupCommand, stateOf, stateTitle, type AudioState, type Fm, type Mode, type Render } from '../vault/narration'
import { Player, type Track } from './player'

interface AudioRow {
  path: string
  audio?: Record<string, string>
}

const STATE_CLASSES = ['is-ready', 'is-stale', 'is-failed', 'is-working', 'is-playing']

export class Listen {
  readonly player: Player
  private readonly actions = new WeakMap<MarkdownView, HTMLElement>()
  /** The CLI's word on each page's modes (`done`, `stale`, `failed`), fetched when a page's records change. */
  private states = new Map<string, Record<string, string>>()
  private statesAt = 0
  private fetching: Promise<void> | null = null
  private fetchTimer: number | null = null
  /** Recordings asked for, in order; the first runs. */
  private readonly line: { path: string; mode: Mode }[] = []
  private running: { path: string; mode: Mode; started: number } | null = null
  /** The engine is not set up here: the command the CLI named, until a recording works. */
  private setup: string | null = null

  constructor(private readonly plugin: LlmWikiPlugin) {
    this.player = new Player(plugin.app)
  }

  register(): void {
    const p = this.plugin
    const each = () => p.app.workspace.iterateAllLeaves((leaf) => this.decorate(leaf))
    p.app.workspace.onLayoutReady(each)
    p.registerEvent(p.app.workspace.on('active-leaf-change', each))
    p.registerEvent(p.app.workspace.on('file-open', each))
    p.registerEvent(p.app.workspace.on('llm-wiki:snapshot' as 'layout-change', () => {
      this.refetch(0)
      each()
    }))
    p.registerEvent(p.app.metadataCache.on('changed', (file) => {
      // A new or changed record is the CLI's to judge again; the icon redraws from the record at once.
      if (rendersOf(this.fm(file)).length || this.states.has(file.path)) this.refetch(3000)
      each()
    }))
    p.register(this.player.onChange(each))
    p.register(() => {
      if (this.fetchTimer !== null) window.clearTimeout(this.fetchTimer)
      this.player.stop()
      // The views outlive the plugin: take the icon back, or a reload adds a second one.
      p.app.workspace.iterateAllLeaves((leaf) => leaf.view.containerEl.querySelectorAll('.llm-wiki-listen-action').forEach((el) => el.remove()))
    })
  }

  private fm(file: TFile): Fm | undefined {
    return this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
  }

  private title(file: TFile): string {
    const t = this.fm(file)?.title
    return typeof t === 'string' && t.trim() ? t.trim() : file.basename
  }

  /** Ask the CLI which pages' audio is stale or failed, after `delay` ms; calls close together make one. */
  private refetch(delay: number): void {
    if (!this.plugin.cli || !this.plugin.wiki) return
    if (this.fetchTimer !== null) window.clearTimeout(this.fetchTimer)
    this.fetchTimer = window.setTimeout(() => {
      this.fetchTimer = null
      void this.fetch()
    }, delay)
  }

  private fetch(): Promise<void> {
    const { cli, wiki } = this.plugin
    if (!cli || !wiki) return Promise.resolve()
    this.fetching ??= cli
      .run<{ pages?: AudioRow[] }>('wiki.page.audio', { wiki: wiki.key })
      .then((a) => {
        this.states = new Map((a.pages ?? []).filter((r) => r.audio).map((r) => [r.path, r.audio!]))
        this.statesAt = Date.now()
        this.plugin.app.workspace.iterateAllLeaves((leaf) => this.decorate(leaf))
      })
      .catch((e: unknown) => log.debug('listen', 'audio states', e))
      .finally(() => (this.fetching = null))
    return this.fetching
  }

  /** Each mode's record on the page, with its state. */
  private modes(file: TFile): { r: Render; state: AudioState }[] {
    const cli = this.states.get(file.path)
    return rendersOf(this.fm(file)).map((r) => ({ r, state: stateOf(r, cli?.[r.mode], file.stat.mtime) }))
  }

  private isWorking(path: string): boolean {
    return this.running?.path === path || this.line.some((l) => l.path === path)
  }

  /** Add the icon once per view, then keep its look current. */
  private decorate(leaf: WorkspaceLeaf): void {
    const view = leaf.view
    if (!(view instanceof MarkdownView)) return
    let el = this.actions.get(view)
    if (!el) {
      el = view.addAction('headphones', 'Listen', (e) => this.menu(view, e))
      el.addClass('llm-wiki-listen-action')
      this.actions.set(view, el)
      if (this.statesAt === 0) this.refetch(500)
    }
    const file = view.file
    const shown = Boolean(file && isContent(file.path) && this.plugin.wiki)
    el.toggle(shown)
    if (!file || !shown) return
    const state = pageState(this.modes(file).map((m) => m.state))
    const working = this.isWorking(file.path)
    const playing = this.player.playing && this.player.current?.page === file.path
    const want = working ? 'is-working' : playing ? 'is-playing' : state === 'none' ? '' : `is-${state}`
    for (const c of STATE_CLASSES) if (el.hasClass(c) !== (c === want)) el.toggleClass(c, c === want)
    const title = playing ? 'Listen · playing' : stateTitle(state, working)
    if (el.getAttr('aria-label') !== title) el.setAttr('aria-label', title)
  }

  private menu(view: MarkdownView, e: MouseEvent): void {
    const file = view.file
    if (!file) return
    const menu = new Menu()
    const modes = this.modes(file)
    const now = this.player.current
    for (const { r, state } of modes) {
      if (!r.file) continue
      const isThis = now?.file === r.file
      menu.addItem((i) => i
        .setTitle(isThis && this.player.playing ? 'Pause' : `Play · ${MODE_NAMES[r.mode]}${r.voice ? ` · ${r.voice}` : ''}`)
        .setIcon(isThis && this.player.playing ? 'pause' : 'play')
        .onClick(() => (isThis ? this.player.toggle() : this.play(file, r))))
      if (state === 'stale') menu.addItem((i) => i.setTitle('The audio is older than the text').setIcon('alert-triangle').setDisabled(true))
    }
    for (const { r } of modes) {
      if (r.error) menu.addItem((i) => i.setTitle(`The last recording failed: ${oneLine(r.error!)}`).setIcon('alert-circle').setDisabled(true))
    }
    menu.addSeparator()
    if (this.running?.path === file.path) {
      const s = Math.round((Date.now() - this.running.started) / 1000)
      menu.addItem((i) => i.setTitle(`Recording… ${s}s so far`).setIcon('loader').setDisabled(true))
    } else if (this.line.some((l) => l.path === file.path)) {
      menu.addItem((i) => i.setTitle('Waiting for the recording before it').setIcon('clock').setDisabled(true))
    } else if (this.setup) {
      menu.addItem((i) => i.setTitle('Set up reading aloud on this machine…').setIcon('settings').onClick(() => this.showSetup()))
    } else {
      const read = modes.find((m) => m.r.mode === 'read')
      menu.addItem((i) => i
        .setTitle(read ? (read.state === 'stale' ? 'Record again: the text changed' : 'Record again, as written') : 'Read it aloud, as written')
        .setIcon(read ? 'refresh-cw' : 'mic')
        .onClick(() => this.record(file, 'read')))
      if (modes.some((m) => m.r.mode === 'podcast') || this.scripted(view)) {
        const pod = modes.find((m) => m.r.mode === 'podcast')
        menu.addItem((i) => i.setTitle(pod ? 'Voice the episode script again' : 'Voice the episode script').setIcon('mic').onClick(() => this.record(file, 'podcast')))
      }
      menu.addItem((i) => i.setTitle('On this machine, no model · a minute or more').setDisabled(true))
    }
    if (now && now.page !== file.path) {
      menu.addSeparator()
      menu.addItem((i) => i.setTitle(`Stop ${now.title}`).setIcon('square').onClick(() => this.player.stop()))
    }
    // Under the icon, not at the pointer: a key press on the icon has no pointer position.
    const at = (e.currentTarget instanceof HTMLElement ? e.currentTarget : this.actions.get(view))?.getBoundingClientRect()
    if (at) menu.showAtPosition({ x: at.right, y: at.bottom, left: true })
    else menu.showAtMouseEvent(e)
  }

  /** The editor's text has a webvtt script for podcast mode to voice. */
  private scripted(view: MarkdownView): boolean {
    return hasScript(view.editor?.getValue() ?? '')
  }

  private play(file: TFile, r: Render): void {
    if (!r.file) return
    const track: Track = { page: file.path, title: this.title(file), file: r.file, label: MODE_NAMES[r.mode] }
    try {
      this.player.play(track)
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e), 8000)
    }
  }

  /** Put a recording in line; it starts at once when nothing else records. */
  record(file: TFile, mode: Mode): void {
    if (this.isWorking(file.path)) return
    this.line.push({ path: file.path, mode })
    const ahead = this.line.length - 1 + (this.running ? 1 : 0)
    new Notice(ahead ? `${this.title(file)} waits for ${ahead} recording${ahead === 1 ? '' : 's'} before it.` : `Recording ${this.title(file)}. It takes a minute or more; keep working.`)
    this.redraw()
    void this.next()
  }

  private redraw(): void {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => this.decorate(leaf))
  }

  private async next(): Promise<void> {
    if (this.running) return
    const job = this.line.shift()
    if (!job) return
    const { cli, wiki } = this.plugin
    if (!cli || !wiki) {
      this.line.length = 0
      this.redraw()
      return
    }
    this.running = { ...job, started: Date.now() }
    this.redraw()
    const file = this.plugin.app.vault.getFileByPath(job.path)
    const name = file ? this.title(file) : job.path
    try {
      await cli.run<{ page: string; audio: string }>('wiki.narrate', { wiki: wiki.key, path: job.path, mode: job.mode }, { timeoutMs: 30 * 60_000 })
      this.setup = null
      const words = createFragment()
      const box = words.createDiv({ cls: 'llm-wiki-listen-notice' })
      box.createSpan({ text: `${name} is ready to listen to.` })
      const play = box.createEl('button', { text: 'Play', cls: 'mod-cta' })
      const note = new Notice(words, 10_000)
      play.addEventListener('click', (ev) => {
        ev.stopPropagation()
        note.hide()
        // The record is in the file now; the cache may lag a moment behind it.
        window.setTimeout(() => this.playLatest(job.path, job.mode), 300)
      })
    } catch (e) {
      const said = e instanceof CliError ? e.short : String(e)
      const setup = setupCommand(said)
      if (setup) {
        this.setup = setup
        this.line.length = 0
        this.showSetup()
      } else new Notice(`Could not record ${name}: ${oneLine(said)}`, 10_000)
    } finally {
      this.running = null
      this.refetch(500)
      this.redraw()
      void this.next()
    }
  }

  private playLatest(path: string, mode: Mode): void {
    const file = this.plugin.app.vault.getFileByPath(path)
    const r = file ? rendersOf(this.fm(file)).find((x) => x.mode === mode) : undefined
    if (file && r?.file) this.play(file, r)
    else new Notice('The audio is not in the page yet. Click the headphones again in a moment.')
  }

  private showSetup(): void {
    if (this.setup) new SetupModal(this.plugin, this.setup, () => (this.setup = null)).open()
  }
}

function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 140 ? `${t.slice(0, 139)}…` : t
}

/** Reading aloud is not set up on this machine: what it needs, and the command the CLI named. */
class SetupModal extends Modal {
  constructor(private readonly plugin: LlmWikiPlugin, private readonly command: string, private readonly retry: () => void) {
    super(plugin.app)
    this.modalEl.addClass('llm-wiki', 'llm-wiki-listen-setup')
  }

  onOpen(): void {
    this.setTitle('Set up reading aloud')
    const el = this.contentEl
    el.createEl('p', { text: 'This machine has no narrate engine yet. Reading aloud runs here, with no model: it needs pocket-tts and ffmpeg installed, then the wiki told to use them.' })
    el.createEl('p', { text: 'Run this in a terminal, in the wiki:' })
    el.createEl('pre').createEl('code', { text: this.command })
    el.createEl('p', { cls: 'llm-wiki-muted', text: `Or ask the agent: ${slash('narrate')} walks through it, voices included.` })
    const bar = el.createDiv({ cls: 'modal-button-container' })
    bar.createEl('button', { text: 'Copy the command' }).addEventListener('click', () => {
      void navigator.clipboard.writeText(this.command).then(() => new Notice('Copied'))
    })
    bar.createEl('button', { text: 'I set it up', cls: 'mod-cta' }).addEventListener('click', () => {
      this.retry()
      this.close()
      new Notice('Click the headphones on the page again.')
    })
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
