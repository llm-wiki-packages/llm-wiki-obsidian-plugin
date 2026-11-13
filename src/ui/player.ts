// The Listen player: one bar for the whole window, docked above the status bar.
// It keeps playing when the person opens another note, so they can read along
// or move on. The title opens the page it is reading. Media keys work through
// the browser's media session.
import { Keymap, setIcon, type App } from 'obsidian'
import { clock, nextSpeed } from '../vault/narration'

export interface Track {
  /** The page the audio reads. */
  page: string
  title: string
  /** The MP3, wiki-relative. */
  file: string
  /** What is read, for the bar: `As written`, `Episode`. */
  label: string
}

const SKIP = 15

export class Player {
  private bar: HTMLElement | null = null
  private audio: HTMLAudioElement | null = null
  private track: Track | null = null
  private speed = 1
  private readonly listeners = new Set<() => void>()

  constructor(private readonly app: App) {}

  /** What is loaded, playing or paused; null with no bar. */
  get current(): Track | null {
    return this.track
  }

  get playing(): boolean {
    return !!this.audio && !this.audio.paused
  }

  /** Told on every play, pause and close, so the header icons can say what plays. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    for (const fn of this.listeners) fn()
  }

  /** Play a track from the start, or resume it where it paused if it is the one loaded. */
  play(t: Track): void {
    const file = this.app.vault.getFileByPath(t.file)
    if (!file) throw new Error(`the audio file is missing: ${t.file}`)
    if (this.track?.file === t.file && this.audio) {
      void this.audio.play()
      return
    }
    this.stop()
    const audio = new Audio(this.app.vault.getResourcePath(file))
    audio.playbackRate = this.speed
    this.audio = audio
    this.track = t
    this.draw()
    for (const ev of ['play', 'pause', 'ended']) audio.addEventListener(ev, () => {
      this.sync()
      this.changed()
    })
    audio.addEventListener('timeupdate', () => this.sync())
    audio.addEventListener('loadedmetadata', () => this.sync())
    audio.addEventListener('error', () => {
      this.bar?.querySelector('.llm-wiki-player-time')?.setText('Could not play this file')
    })
    this.mediaSession(t)
    void audio.play().catch(() => this.sync())
  }

  toggle(): void {
    if (!this.audio) return
    if (this.audio.paused) void this.audio.play()
    else this.audio.pause()
  }

  /** Close the bar and let the audio go. */
  stop(): void {
    if (this.audio) {
      this.audio.pause()
      this.audio.removeAttribute('src')
      this.audio.load()
    }
    this.audio = null
    this.track = null
    this.bar?.remove()
    this.bar = null
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null
    this.changed()
  }

  private skip(by: number): void {
    const a = this.audio
    if (!a) return
    a.currentTime = Math.max(0, Math.min(Number.isFinite(a.duration) ? a.duration : Infinity, a.currentTime + by))
  }

  private draw(): void {
    this.bar?.remove()
    const t = this.track
    if (!t) return
    const bar = document.body.createDiv({ cls: 'llm-wiki-player', attr: { role: 'region', 'aria-label': 'Listen player' } })
    this.bar = bar
    const btn = (icon: string, label: string, fn: () => void, cls = '') => {
      const b = bar.createEl('button', { cls: `clickable-icon llm-wiki-player-btn ${cls}`.trim(), attr: { 'aria-label': label } })
      setIcon(b, icon)
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        fn()
      })
      return b
    }
    btn('rotate-ccw', `Back ${SKIP} seconds`, () => this.skip(-SKIP))
    btn('play', 'Play', () => this.toggle(), 'llm-wiki-player-play')
    btn('rotate-cw', `Forward ${SKIP} seconds`, () => this.skip(SKIP))
    const words = bar.createDiv({ cls: 'llm-wiki-player-words' })
    const title = words.createEl('a', { cls: 'llm-wiki-player-title', text: t.title, attr: { href: '#', 'aria-label': `Open ${t.page}` } })
    title.addEventListener('click', (e) => {
      e.preventDefault()
      const page = this.app.vault.getFileByPath(t.page)
      if (page) void this.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(page)
    })
    words.createSpan({ cls: 'llm-wiki-player-label', text: t.label })
    const seek = bar.createEl('input', { cls: 'llm-wiki-player-seek', attr: { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': 'Position' } })
    seek.addEventListener('input', () => {
      const a = this.audio
      if (a && Number.isFinite(a.duration)) a.currentTime = (Number(seek.value) / 1000) * a.duration
    })
    bar.createSpan({ cls: 'llm-wiki-player-time', text: '0:00' })
    const speed = bar.createEl('button', { cls: 'llm-wiki-player-speed', text: `${this.speed}×`, attr: { 'aria-label': 'Speed' } })
    speed.addEventListener('click', () => {
      this.speed = nextSpeed(this.speed)
      if (this.audio) this.audio.playbackRate = this.speed
      speed.setText(`${this.speed}×`)
    })
    btn('x', 'Close the player', () => this.stop())
  }

  /** The play button, the position and the time, kept to the audio. */
  private sync(): void {
    const a = this.audio
    const bar = this.bar
    if (!a || !bar) return
    const play = bar.querySelector<HTMLElement>('.llm-wiki-player-play')
    if (play) {
      const icon = a.paused ? 'play' : 'pause'
      if (play.dataset.icon !== icon) {
        play.dataset.icon = icon
        setIcon(play, icon)
        play.setAttr('aria-label', a.paused ? 'Play' : 'Pause')
      }
    }
    const d = Number.isFinite(a.duration) ? a.duration : 0
    const seek = bar.querySelector<HTMLInputElement>('.llm-wiki-player-seek')
    if (seek && document.activeElement !== seek) seek.value = d ? String(Math.round((a.currentTime / d) * 1000)) : '0'
    bar.querySelector('.llm-wiki-player-time')?.setText(`${clock(a.currentTime)} / ${clock(d)}`)
  }

  private mediaSession(t: Track): void {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.metadata = new MediaMetadata({ title: t.title, artist: t.label, album: 'LLM wiki' })
    ms.setActionHandler('play', () => this.toggle())
    ms.setActionHandler('pause', () => this.toggle())
    ms.setActionHandler('seekbackward', () => this.skip(-SKIP))
    ms.setActionHandler('seekforward', () => this.skip(SKIP))
  }
}
