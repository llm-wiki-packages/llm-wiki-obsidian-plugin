// An HTML file, shown as it would be in a browser: the morning brief, a chart
// an agent drew, any standalone page in the vault. Obsidian opens none of
// these by itself.
//
// The page may have been scraped off the web, so it runs in a sandboxed frame
// cut off from Obsidian, the vault and Node, under a policy that fetches
// nothing, localhost and `file:` included (`framed` says how). Its own scripts
// run only for a brief in `wiki/reports/`, or when a person turns them on for
// the page in hand. A link it shows is followed here: a vault path opens in
// Obsidian, a web address in the browser. A brief steps to the one before and
// after it, and to its markdown record.
import { FileView, Notice, type TFile, type WorkspaceLeaf } from 'obsidian'
import { FRAME_MESSAGE, HTML_EXTENSIONS, REPORTS_DIR, collectReports, framePolicy, framed, joinPath, nonce, seriesOf, trustsScripts, vaultRows } from '../vault/reports'

export const VIEW_HTML = 'llm-wiki-html'

/** Obsidian's own "open in default app", which its typings leave out. */
type WithDefaultApp = { openWithDefaultApp?: (path: string) => void }

export class HtmlView extends FileView {
  private frame: HTMLIFrameElement | null = null
  private older!: HTMLElement
  private newer!: HTMLElement
  private record!: HTMLElement
  private series: ReturnType<typeof seriesOf> = null
  /** Whether this page's own scripts run: null until a person chooses, then their choice for this file. */
  private scripts: boolean | null = null
  private scriptsAction!: HTMLElement

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_HTML
  }

  getIcon(): string {
    return 'file-code'
  }

  canAcceptExtension(extension: string): boolean {
    return HTML_EXTENSIONS.includes(extension)
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('llm-wiki-html-view')
    // Each action is placed before the last, so they are added right to left.
    if ((this.app as unknown as WithDefaultApp).openWithDefaultApp)
      this.addAction('external-link', 'Open in the default app', () => this.file && (this.app as unknown as WithDefaultApp).openWithDefaultApp?.(this.file.path))
    this.scriptsAction = this.addAction('code', '', () => {
      this.scripts = !this.runsScripts()
      void this.show()
    })
    this.record = this.addAction('file-text', 'Read the report’s record', () => this.go(this.series?.record))
    this.newer = this.addAction('chevron-right', 'Newer report', () => this.go(this.series?.newer))
    this.older = this.addAction('chevron-left', 'Older report', () => this.go(this.series?.older))
    this.registerDomEvent(window, 'message', (e) => this.onMessage(e))
    this.registerEvent(this.app.vault.on('modify', (f) => f === this.file && void this.show()))
    await super.onOpen()
  }

  private runsScripts(): boolean {
    return this.scripts ?? (this.file ? trustsScripts(this.file.path) : false)
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.scripts = null
    await super.onLoadFile(file)
    await this.show()
  }

  async onUnloadFile(file: TFile): Promise<void> {
    this.contentEl.empty()
    this.frame = null
    await super.onUnloadFile(file)
  }

  private async show(): Promise<void> {
    const file = this.file
    if (!file) return
    const text = await this.app.vault.read(file)
    if (file !== this.file) return
    this.contentEl.empty()
    const scripts = this.runsScripts()
    const once = nonce()
    const frame = this.contentEl.createEl('iframe', { cls: 'llm-wiki-html-frame' })
    // Scripts, and nothing else: no same origin, so no reach into Obsidian; no popups, forms or top navigation.
    // With the page's own scripts off, the policy lets only the bridge run.
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('csp', framePolicy(scripts ? null : once))
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('title', file.basename)
    frame.srcdoc = framed(text, { scripts, nonce: once })
    this.scriptsAction.toggleClass('is-active', scripts)
    this.scriptsAction.setAttribute('aria-label', scripts ? 'The page’s own scripts run; click to stop them' : 'The page’s own scripts are off; click to run them')
    // The frame may still send itself elsewhere (`location = …`, a meta refresh), which neither the sandbox nor the
    // policy stops. Any load after the first is that: the page is put back, and the person told.
    let loads = 0
    frame.addEventListener('load', () => {
      if (++loads < 2 || frame !== this.frame) return
      new Notice(`${file.name} tried to leave for another address; it was put back.`)
      void this.show()
    })
    this.frame = frame
    this.series = file.path.startsWith(`${REPORTS_DIR}/`) ? seriesOf(collectReports(vaultRows(this.app)), file.path) : null
    const step = (el: HTMLElement, to: string | null | undefined) => {
      el.toggle(Boolean(this.series))
      el.toggleClass('is-disabled', !to)
      el.setAttribute('aria-disabled', String(!to))
    }
    step(this.older, this.series?.older)
    step(this.newer, this.series?.newer)
    step(this.record, this.series?.record)
  }

  private go(path: string | null | undefined): void {
    const file = path ? this.app.vault.getFileByPath(path) : null
    if (file) void this.leaf.openFile(file)
  }

  /** What the bridge in the frame sends: a link followed, or a copy a click asked for. */
  private onMessage(e: MessageEvent): void {
    if (!this.frame || e.source !== this.frame.contentWindow) return
    const m = e.data as { from?: unknown; kind?: unknown; href?: unknown; text?: unknown; newTab?: unknown } | null
    if (!m || m.from !== FRAME_MESSAGE) return
    if (m.kind === 'copy' && typeof m.text === 'string')
      void navigator.clipboard.writeText(m.text.slice(0, 200_000)).then(() => new Notice('Copied to the clipboard.'))
    if (m.kind === 'open' && typeof m.href === 'string') this.follow(m.href, m.newTab === true)
  }

  /** A web or mail link goes to the browser; a vault path opens here; anything else is left alone. */
  private follow(href: string, newTab: boolean): void {
    if (/^(https?|mailto):/i.test(href)) {
      window.open(href)
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || !this.file) return
    let rel = href.replace(/[?#].*$/, '')
    try {
      rel = decodeURI(rel)
    } catch {
      return
    }
    const here = this.file.parent?.path ?? ''
    const at = joinPath(here === '/' ? '' : here, rel)
    const target = (at ? this.app.vault.getFileByPath(at) : null) ?? this.app.metadataCache.getFirstLinkpathDest(rel, this.file.path)
    if (!target) {
      new Notice(`${href} is not in the vault.`)
      return
    }
    void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(target)
  }
}
