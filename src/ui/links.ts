// Links in rendered markdown: Obsidian wires them only inside its own markdown
// views, so a custom view opens them itself.
import type { App } from 'obsidian'
import { log } from '../logger'

export type LinkTarget = { kind: 'internal'; path: string } | { kind: 'external'; url: string } | null

/** What an anchor from MarkdownRenderer points at: a vault path, a URL, or nothing to open. */
export function linkOf(a: { className: string; dataset: { href?: string }; getAttribute(n: string): string | null }): LinkTarget {
  const internal = a.dataset.href ?? (a.className.split(/\s+/).includes('internal-link') ? a.getAttribute('href') : null)
  if (internal) return { kind: 'internal', path: internal }
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//.test(href)) return { kind: 'external', url: href }
  return null
}

/** One delegated click handler for every link rendered under `root`, now and later. */
export function wireLinks(root: HTMLElement, app: App, register: (el: HTMLElement, ev: 'click', fn: (e: MouseEvent) => void) => void): void {
  register(root, 'click', (e) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const target = linkOf(a)
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    log.debug('link', target)
    if (target.kind === 'internal') void app.workspace.openLinkText(target.path, '', e.metaKey || e.ctrlKey)
    else window.open(target.url)
  })
}
