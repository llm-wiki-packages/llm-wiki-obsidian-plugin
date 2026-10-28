// The wiki's reports and HTML artifacts. The daily-report skill writes a
// markdown record, `wiki/reports/YYYY-MM-DD.md`, and beside it a standalone
// brief, `YYYY-MM-DD.html`, which the record names in its `dashboard:`
// frontmatter. A report is the pair; either half alone is still a report.
// Underscored files are the wiki's own (`_template.html`), and a `.html.md`
// page is the adopt stub an older landing wrote for the brief, not a report.
import type { App, TFile } from 'obsidian'

export const REPORTS_DIR = 'wiki/reports'
export const HTML_EXTENSIONS = ['html', 'htm']
export const TEMPLATE_PATH = `${REPORTS_DIR}/_template.html`

/** A file as the lists need it: what the vault and metadata cache hold. */
export interface FileRow {
  path: string
  mtime: number
  fm?: Record<string, unknown> | null
}

export interface Report {
  /** The day it is for, `YYYY-MM-DD`: frontmatter `date`, else the name's. */
  date: string | null
  /** The record's title when it names more than the date. */
  title: string
  /** The record's `lede`, else its `description`. */
  summary: string
  /** The titles of the items it says need attention. */
  attention: string[]
  /** The markdown record, by path. */
  record: string | null
  /** The HTML brief, by path. */
  brief: string | null
  mtime: number
}

const DATE = /(\d{4}-\d{2}-\d{2})/
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v instanceof Date ? v.toISOString().slice(0, 10) : '')
const name = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folder = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const extension = (path: string) => name(path).split('.').pop()?.toLowerCase() ?? ''
export const isHtml = (path: string): boolean => HTML_EXTENSIONS.includes(extension(path))

/** A path relative to a folder, with `.` and `..` walked; null when it climbs out of the vault. */
export function joinPath(dir: string, rel: string): string | null {
  const parts = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean)
  for (const p of rel.split('/')) {
    if (!p || p === '.') continue
    if (p === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(p)
  }
  return parts.join('/')
}

/** Where a record's `dashboard:` points, as a vault path: `2026-09-05.html`, `./…`, or `[[…]]`. */
export function briefOf(recordPath: string, dashboard: unknown): string | null {
  let v = str(dashboard)
  const wiki = /^\[\[([^\]|#]+)/.exec(v)
  if (wiki?.[1]) v = wiki[1]
  v = v.replace(/[?#].*$/, '')
  if (!v || /^[a-z][a-z0-9+.-]*:/i.test(v)) return null
  try {
    v = decodeURI(v)
  } catch {
    return null
  }
  return joinPath(folder(recordPath), v)
}

/** The attention list a record states: YAML as written, or the one JSON string `page edit` stores. */
function attentionOf(fm: Record<string, unknown> | null | undefined): string[] {
  let v = fm?.attention
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (!Array.isArray(v)) return []
  return v.map((x) => (x && typeof x === 'object' ? str((x as Record<string, unknown>).title) : '')).filter(Boolean)
}

/** Every report under `wiki/reports/`, newest first, each record paired with its brief. */
export function collectReports(rows: FileRow[]): Report[] {
  const inside = rows.filter((r) => r.path.startsWith(`${REPORTS_DIR}/`) && !/^[._]/.test(name(r.path)) && !r.path.slice(REPORTS_DIR.length + 1).split('/').some((p) => /^[._]/.test(p)))
  const htmlPaths = new Set(inside.filter((r) => isHtml(r.path)).map((r) => r.path))
  const claimed = new Set<string>()
  const out: Report[] = []
  for (const r of inside) {
    const n = name(r.path)
    if (!n.endsWith('.md') || n === 'index.md' || /\.html?\.md$/i.test(n)) continue
    const stated = briefOf(r.path, r.fm?.dashboard)
    const sibling = r.path.replace(/\.md$/, '.html')
    const brief = stated && htmlPaths.has(stated) ? stated : htmlPaths.has(sibling) ? sibling : null
    if (brief) claimed.add(brief)
    const date = str(r.fm?.date).match(DATE)?.[1] ?? DATE.exec(n)?.[1] ?? null
    const title = str(r.fm?.title)
    out.push({
      date,
      title: title && title !== date ? title : '',
      summary: str(r.fm?.lede) || str(r.fm?.description),
      attention: attentionOf(r.fm),
      record: r.path,
      brief,
      mtime: r.mtime,
    })
  }
  for (const r of inside) {
    if (!htmlPaths.has(r.path) || claimed.has(r.path)) continue
    const date = DATE.exec(name(r.path))?.[1] ?? null
    const stem = name(r.path).replace(/\.html?$/i, '')
    out.push({ date, title: stem === date ? '' : stem, summary: '', attention: [], record: null, brief: r.path, mtime: r.mtime })
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.mtime - a.mtime)
}

/** Every HTML file outside the reports, newest first. */
export function otherHtml(rows: FileRow[]): FileRow[] {
  return rows.filter((r) => isHtml(r.path) && !r.path.startsWith(`${REPORTS_DIR}/`)).sort((a, b) => b.mtime - a.mtime)
}

/** The briefs in date order, newest first, and where this one sits among them. */
export function seriesOf(reports: Report[], path: string): { newer: string | null; older: string | null; record: string | null } | null {
  const briefs = reports.filter((r) => r.brief)
  const at = briefs.findIndex((r) => r.brief === path)
  if (at < 0) return null
  return { newer: briefs[at - 1]?.brief ?? null, older: briefs[at + 1]?.brief ?? null, record: briefs[at]!.record }
}

/** The vault's files with the frontmatter Obsidian has read for them. */
export function vaultRows(app: App): FileRow[] {
  return app.vault.getFiles().map((f: TFile) => ({
    path: f.path,
    mtime: f.stat.mtime,
    fm: f.extension === 'md' ? app.metadataCache.getFileCache(f)?.frontmatter : null,
  }))
}

/**
 * How an HTML file is shown. The page may be anything: a capture scraped off
 * the web, or a brief an agent wrote after reading scraped text. Two layers
 * keep it from reading this machine or reaching it:
 * - the frame's sandbox, `allow-scripts` and nothing else: an opaque origin,
 *   so no reach into Obsidian, its storage, the vault or Node; no popups,
 *   forms or navigating Obsidian itself;
 * - a policy, the first thing in its head, that fetches nothing: not the
 *   web, not localhost, not `file:`. Only inline styles and `data:` images.
 *
 * A page's own scripts are off unless it is trusted to run them (a brief in
 * `wiki/reports/`, or a person saying so for one page). Off, only the bridge
 * runs, by a nonce the page cannot know. That matters because two things
 * get past any policy, and both need a script, or a meta refresh, which is
 * removed before the page is shown:
 * - navigating the frame (`location = …`): one GET to any address,
 *   localhost included. It cannot read the answer, and the view puts the
 *   page back, but the request has gone. (The Navigation API cannot cancel
 *   it: its events are off in an opaque origin.);
 * - WebRTC, whose STUN and TURN packets no policy covers. With scripts on,
 *   the bridge removes its constructors first.
 */
export function framePolicy(nonce: string | null): string {
  return [
    "default-src 'none'",
    nonce ? `script-src 'nonce-${nonce}'` : "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline' data:",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

export const FRAME_MESSAGE = 'llm-wiki-frame'

/** What hands a clicked link, and a copy a click asked for, to Obsidian: the frame can neither navigate nor reach the clipboard. */
const BRIDGE = `(function () {
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription', 'RTCRtpSender', 'RTCRtpReceiver'].forEach(function (n) {
    try { Object.defineProperty(window, n, { value: undefined, writable: false, configurable: false }) } catch (e) {}
  })
  function send(m) { m.from = '${FRAME_MESSAGE}'; parent.postMessage(m, '*') }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || !e.target || !e.target.closest) return
    var a = e.target.closest('a[href], area[href]')
    if (!a) return
    var href = a.getAttribute('href') || ''
    e.preventDefault()
    if (!href || /^javascript:/i.test(href)) return
    // A page shown from srcdoc has its host's address, so '#x' would load the host in the frame: scroll instead.
    if (href.charAt(0) === '#') {
      var id = href.slice(1)
      try { id = decodeURIComponent(id) } catch (err) {}
      var to = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body
      if (to) to.scrollIntoView()
      return
    }
    send({ kind: 'open', href: href, newTab: !!(e.metaKey || e.ctrlKey) })
  }, true)
  function copy(text) {
    if (navigator.userActivation && !navigator.userActivation.isActive) return Promise.reject(new Error('A copy needs a click.'))
    send({ kind: 'copy', text: String(text) })
    return Promise.resolve()
  }
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } }) } catch (e) {}
})()`

/** A nonce for one showing. */
export function nonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The page as the frame is given it. Parsed with DOMParser, which runs no
 * script and loads nothing, so the policy lands first in the real head
 * however the page is written, and what the page says is read as a browser
 * would read it, not by a pattern.
 */
export function framed(html: string, opts: { scripts: boolean; nonce: string }): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // A meta refresh navigates with no script at all.
  for (const m of Array.from(doc.querySelectorAll('meta[http-equiv]'))) if (/^\s*refresh\s*$/i.test(m.getAttribute('http-equiv') ?? '')) m.remove()
  if (!opts.scripts) {
    // Its scripts will not run, so what it says to show instead is shown.
    for (const n of Array.from(doc.querySelectorAll('noscript'))) n.replaceWith(...Array.from(n.childNodes))
  }
  // What goes first in its head, parsed the same way and moved across. Every value is fixed text or the hex nonce.
  const lead = new DOMParser().parseFromString(
    `<meta http-equiv="Content-Security-Policy" content="${framePolicy(opts.scripts ? null : opts.nonce)}">` +
      '<meta http-equiv="x-dns-prefetch-control" content="off"><meta name="referrer" content="no-referrer">' +
      `<script nonce="${opts.nonce}">${BRIDGE}</script>`,
    'text/html',
  ).head
  // Copied first: adopting a node takes it out of the live list being walked.
  doc.head.prepend(...Array.from(lead.childNodes).map((n) => doc.adoptNode(n)))
  return `${doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : ''}${doc.documentElement.outerHTML}`
}

/** Whether a file's own scripts run unless a person says otherwise: a brief the wiki's reports job wrote. */
export function trustsScripts(path: string): boolean {
  return path.startsWith(`${REPORTS_DIR}/`)
}
