// A page's frontmatter `sources` drawn as lines in the graph. The paths there
// are bare and nested in objects, so Obsidian never counts them as links; this
// adds a page → source entry to `metadataCache.resolvedLinks`, the table the
// global and local graphs draw from. The table is public, writing to it is
// not: everything that touches it is fenced, so a change in Obsidian degrades
// to "no extra lines". The file and its cache are never touched.
import type { TFile } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { log } from '../logger'

/** `resolvedLinks`' shape: source path → target path → how many links. */
export type LinkTable = Record<string, Record<string, number>>

/** The `resource` paths a page's frontmatter cites, once each; anything malformed is skipped. */
export function sourcePathsOf(frontmatter: unknown): string[] {
  if (!frontmatter || typeof frontmatter !== 'object') return []
  const sources = (frontmatter as { sources?: unknown }).sources
  if (!Array.isArray(sources)) return []
  const out = new Set<string>()
  for (const item of sources) {
    const path = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as { resource?: unknown }).resource : undefined
    if (typeof path === 'string' && path.trim()) out.add(path.trim())
  }
  return [...out]
}

/**
 * What this plugin added to a link table, so adding is idempotent and removal
 * restores the counts Obsidian had. Obsidian rebuilds a file's row as a new
 * object when it re-resolves the file, dropping what was added; a row that is
 * no longer the one written to holds none of ours.
 */
export class SourceEdges {
  private readonly added = new Map<string, { row: Record<string, number>; targets: Set<string>; made: boolean }>()

  constructor(private readonly table: () => LinkTable) {}

  /** Make `source`'s added edges exactly `targets`; true when the table changed. */
  set(source: string, targets: Iterable<string>): boolean {
    const links = this.table()
    const prev = this.added.get(source)
    const live = prev && links[source] === prev.row ? prev.targets : new Set<string>()
    const next = new Set([...targets].filter((t) => t && t !== source))
    let changed = false
    const row = links[source]
    for (const t of live) {
      if (next.has(t) || !row) continue
      const n = (row[t] ?? 0) - 1
      if (n > 0) row[t] = n
      else delete row[t]
      changed = true
    }
    if (next.size === 0) {
      // A row this made for a page Obsidian had none for goes again once it is empty.
      if (prev && row === prev.row && prev.made && Object.keys(row).length === 0) delete links[source]
      this.added.delete(source)
      return changed
    }
    const made = live.size > 0 && prev ? prev.made : !links[source]
    const into = links[source] ?? (links[source] = {})
    for (const t of next) {
      if (live.has(t)) continue
      into[t] = (into[t] ?? 0) + 1
      changed = true
    }
    this.added.set(source, { row: into, targets: next, made })
    return changed
  }

  /** Take every added edge back out; true when the table changed. */
  clearAll(): boolean {
    let changed = false
    for (const source of [...this.added.keys()]) changed = this.set(source, []) || changed
    return changed
  }

  sources(): string[] {
    return [...this.added.keys()]
  }
}

/** A graph view's internal engine; not in Obsidian's typings. */
interface GraphEngine {
  render?: () => void
}

export class SourceLinks {
  private readonly edges: SourceEdges
  /** Set while this triggers `resolved` itself, so its own handler does not answer. */
  private triggering = false
  private ready = false

  constructor(private readonly plugin: LlmWikiPlugin) {
    this.edges = new SourceEdges(() => plugin.app.metadataCache.resolvedLinks)
  }

  register(): void {
    const p = this.plugin
    const cache = p.app.metadataCache
    p.app.workspace.onLayoutReady(() => {
      this.ready = true
      // `resolve` fires per file right after Obsidian rebuilt its row (which wiped ours);
      // `resolved` fires when the queue empties, after the first full pass and later batches.
      p.registerEvent(cache.on('resolve', (file) => this.guard(() => {
        if (p.settings.sourceLinksInGraph) this.applyFile(file)
      })))
      p.registerEvent(cache.on('resolved', () => {
        if (this.triggering || !p.settings.sourceLinksInGraph) return
        this.guard(() => {
          if (this.applyAll()) this.refresh()
        })
      }))
      // The first full resolve may already be over by the time the layout is ready.
      if (Object.keys(cache.resolvedLinks).length > 0) this.apply()
    })
    p.register(() => this.guard(() => {
      if (this.edges.clearAll()) this.refresh()
    }))
  }

  /** The setting changed, or the plugin is ready: add or remove every edge, then redraw. */
  apply(): void {
    if (!this.ready) return
    this.guard(() => {
      const changed = this.plugin.settings.sourceLinksInGraph ? this.applyAll() : this.edges.clearAll()
      if (changed) this.refresh()
    })
  }

  private applyAll(): boolean {
    const vault = this.plugin.app.vault
    let changed = false
    for (const file of vault.getMarkdownFiles()) changed = this.applyFile(file) || changed
    // A page deleted or renamed since leaves a row that is no longer ours to keep.
    for (const source of this.edges.sources()) {
      if (!vault.getFileByPath(source)) changed = this.edges.set(source, []) || changed
    }
    return changed
  }

  private applyFile(file: TFile): boolean {
    if (file.extension !== 'md') return false
    const { vault, metadataCache } = this.plugin.app
    const targets: string[] = []
    for (const path of sourcePathsOf(metadataCache.getFileCache(file)?.frontmatter)) {
      const target = vault.getFileByPath(path) ?? metadataCache.getFirstLinkpathDest(path.replace(/\.md$/, ''), file.path)
      if (target && target.path !== file.path) targets.push(target.path)
    }
    return this.edges.set(file.path, targets)
  }

  /**
   * Redraw open graphs. Internal: a global graph view keeps its engine at `dataEngine`,
   * a local graph at `engine`, and `render()` rereads `resolvedLinks`. A graph without
   * one gets a `resolved` event instead, which every graph answers by redrawing.
   */
  private refresh(): void {
    const ws = this.plugin.app.workspace
    let missed = false
    for (const type of ['graph', 'localgraph']) {
      for (const leaf of ws.getLeavesOfType(type)) {
        const view = leaf.view as unknown as { dataEngine?: GraphEngine; engine?: GraphEngine }
        const engine = view.dataEngine ?? view.engine
        if (typeof engine?.render === 'function') engine.render()
        else missed = true
      }
    }
    if (!missed) return
    log.debug('source links: a graph view had no engine to render; triggering resolved')
    this.triggering = true
    try {
      this.plugin.app.metadataCache.trigger('resolved')
    } finally {
      this.triggering = false
    }
  }

  private guard(run: () => void): void {
    try {
      run()
    } catch (e) {
      log.warn('source links in the graph:', e)
    }
  }
}
