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
 * What an artifact's page is given before it is shown, at the top of its head:
 * - a policy that lets its own inline styles and scripts run and fetches
 *   nothing, since what an agent wrote may carry a tracking pixel;
 * - a bridge that hands a clicked link, and a copy a click asked for, to
 *   Obsidian, since the frame itself can neither navigate nor reach the clipboard.
 */
export const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' data:",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export const FRAME_MESSAGE = 'llm-wiki-frame'

const BRIDGE = `(function () {
  function send(m) { m.from = '${FRAME_MESSAGE}'; parent.postMessage(m, '*') }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || !e.target || !e.target.closest) return
    var a = e.target.closest('a[href]')
    if (!a) return
    var href = a.getAttribute('href') || ''
    if (!href || /^javascript:/i.test(href)) return
    e.preventDefault()
    // A page shown from srcdoc has its host's address, so '#x' would load the host in the frame: scroll instead.
    if (href.charAt(0) === '#') {
      var id = href.slice(1)
      try { id = decodeURIComponent(id) } catch (err) {}
      var to = id ? document.getElementById(id) || document.getElementsByName(id)[0] : document.body
      if (to) to.scrollIntoView()
      return
    }
    send({ kind: 'open', href: href, newTab: !!(e.metaKey || e.ctrlKey) })
  })
  function copy(text) {
    if (navigator.userActivation && !navigator.userActivation.isActive) return Promise.reject(new Error('A copy needs a click.'))
    send({ kind: 'copy', text: String(text) })
    return Promise.resolve()
  }
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } }) } catch (e) {}
})()`

export function framed(html: string): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><script>${BRIDGE}</script>`
  // A tag named inside a comment is not the tag; the policy would land in the comment and do nothing.
  const bare = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (c) => ' '.repeat(c.length))
  for (const tag of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = tag.exec(bare)
    if (m) return html.slice(0, m.index + m[0].length) + head + html.slice(m.index + m[0].length)
  }
  return head + html
}
