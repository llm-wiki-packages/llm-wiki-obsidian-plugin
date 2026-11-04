// A page's frontmatter sources as graph edges: which paths count, and what is added to and taken from the link table.
import { describe, expect, it } from 'vitest'
import type LlmWikiPlugin from '../src/main'
import { SourceEdges, SourceLinks, sourcePathsOf, type LinkTable } from '../src/vault/sourceLinks'

describe('sourcePathsOf', () => {
  it('reads each resource of a good list', () => {
    const fm = { sources: [
      { resource: 'sources/documents/company/Org chart.md', id: '1e76', span: 'Reporting lines' },
      { resource: 'sources/slack/cs/2026-06-04.md', id: 'x' },
    ] }
    expect(sourcePathsOf(fm)).toEqual(['sources/documents/company/Org chart.md', 'sources/slack/cs/2026-06-04.md'])
  })
  it('keeps a path once', () => {
    expect(sourcePathsOf({ sources: [{ resource: 'a.md' }, { resource: 'a.md', span: 'other' }, 'a.md'] })).toEqual(['a.md'])
  })
  it('skips odd shapes and takes a plain string', () => {
    const fm = { sources: [null, 3, [], {}, { resource: '' }, { resource: '   ' }, { resource: 7 }, { id: 'x' }, 'plain.md', { resource: 'ok.md' }] }
    expect(sourcePathsOf(fm)).toEqual(['plain.md', 'ok.md'])
  })
  it('is empty when there is no list', () => {
    for (const fm of [undefined, null, 'x', 3, {}, { sources: 'a.md' }, { sources: { resource: 'a.md' } }, { sources: null }]) {
      expect(sourcePathsOf(fm)).toEqual([])
    }
  })
})

describe('SourceEdges', () => {
  const make = (): { table: LinkTable; edges: SourceEdges } => {
    const table: LinkTable = { 'wiki/p.md': { 'wiki/q.md': 2, 's/a.md': 1 }, 'wiki/q.md': {} }
    return { table, edges: new SourceEdges(() => table) }
  }

  it('adds an edge, and applying twice does not count it twice', () => {
    const { table, edges } = make()
    expect(edges.set('wiki/p.md', ['s/a.md', 's/b.md'])).toBe(true)
    expect(edges.set('wiki/p.md', ['s/a.md', 's/b.md'])).toBe(false)
    expect(table['wiki/p.md']).toEqual({ 'wiki/q.md': 2, 's/a.md': 2, 's/b.md': 1 })
  })
  it('drops an edge when its source leaves the list', () => {
    const { table, edges } = make()
    edges.set('wiki/p.md', ['s/a.md', 's/b.md'])
    expect(edges.set('wiki/p.md', ['s/a.md'])).toBe(true)
    expect(table['wiki/p.md']).toEqual({ 'wiki/q.md': 2, 's/a.md': 2 })
  })
  it('never links a page to itself', () => {
    const { table, edges } = make()
    expect(edges.set('wiki/q.md', ['wiki/q.md'])).toBe(false)
    expect(table['wiki/q.md']).toEqual({})
  })
  it('makes a row for a page Obsidian has none for, and adds nothing for an empty list', () => {
    const { table, edges } = make()
    expect(edges.set('wiki/none.md', [])).toBe(false)
    expect('wiki/none.md' in table).toBe(false)
    edges.set('wiki/new.md', ['s/a.md'])
    expect(table['wiki/new.md']).toEqual({ 's/a.md': 1 })
  })
  it('disabling restores the original counts exactly', () => {
    const { table, edges } = make()
    const before = structuredClone(table)
    edges.set('wiki/p.md', ['s/a.md', 's/b.md'])
    edges.set('wiki/q.md', ['s/c.md'])
    edges.set('wiki/new.md', ['s/a.md'])
    expect(edges.clearAll()).toBe(true)
    expect(table).toEqual(before)
    expect(edges.clearAll()).toBe(false)
  })
  it('re-adds after Obsidian rebuilds a row, and takes nothing from the rebuilt one', () => {
    const { table, edges } = make()
    edges.set('wiki/p.md', ['s/a.md', 's/b.md'])
    table['wiki/p.md'] = { 'wiki/q.md': 2, 's/a.md': 1 }
    expect(edges.set('wiki/p.md', ['s/a.md', 's/b.md'])).toBe(true)
    expect(table['wiki/p.md']).toEqual({ 'wiki/q.md': 2, 's/a.md': 2, 's/b.md': 1 })
    table['wiki/p.md'] = { 'wiki/q.md': 2, 's/a.md': 1 }
    expect(edges.clearAll()).toBe(false)
    expect(table['wiki/p.md']).toEqual({ 'wiki/q.md': 2, 's/a.md': 1 })
  })
  it('forgets a page whose row is gone', () => {
    const { table, edges } = make()
    edges.set('wiki/p.md', ['s/b.md'])
    delete table['wiki/p.md']
    expect(edges.set('wiki/p.md', [])).toBe(false)
    expect(edges.sources()).toEqual([])
    expect('wiki/p.md' in table).toBe(false)
  })
})

type Handler = (...a: unknown[]) => void
interface FakeFile { path: string; extension: string }

/** Just enough of Obsidian's app for the wiring: a link table, frontmatter per file, events and graph leaves. */
function fakeVault(opts: { pages: Record<string, unknown>; files: string[]; table: LinkTable; leaves?: Record<string, unknown[]>; on?: boolean }) {
  const handlers = new Map<string, Handler[]>()
  const unloads: (() => void)[] = []
  const triggered: string[] = []
  const file = (path: string): FakeFile => ({ path, extension: path.split('.').pop() ?? '' })
  const all = [...new Set([...Object.keys(opts.pages), ...opts.files])]
  const metadataCache = {
    resolvedLinks: opts.table,
    getFileCache: (f: FakeFile) => (f.path in opts.pages ? { frontmatter: opts.pages[f.path] } : null),
    getFirstLinkpathDest: (link: string) => {
      const hit = all.find((p) => p.replace(/\.md$/, '').endsWith(link.split('/').pop() ?? '\0'))
      return hit ? file(hit) : null
    },
    on: (name: string, fn: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), fn])
      return { name }
    },
    trigger: (name: string, ...a: unknown[]) => {
      triggered.push(name)
      for (const fn of handlers.get(name) ?? []) fn(...a)
    },
  }
  const plugin = {
    settings: { sourceLinksInGraph: opts.on ?? true },
    registerEvent: () => undefined,
    register: (fn: () => void) => unloads.push(fn),
    app: {
      metadataCache,
      vault: {
        getMarkdownFiles: () => all.filter((p) => p.endsWith('.md')).map(file),
        getFileByPath: (p: string) => (all.includes(p) ? file(p) : null),
      },
      workspace: {
        onLayoutReady: (fn: () => void) => fn(),
        getLeavesOfType: (type: string) => (opts.leaves?.[type] ?? []).map((view) => ({ view })),
      },
    },
  }
  const links = new SourceLinks(plugin as unknown as LlmWikiPlugin)
  return { plugin, links, triggered, fire: (name: string, f?: string) => metadataCache.trigger(name, f ? file(f) : undefined), unload: () => unloads.forEach((fn) => fn()) }
}

describe('SourceLinks', () => {
  const pages = (): Record<string, unknown> => ({
    'wiki/e.md': { sources: [{ resource: 'sources/a.md' }, { resource: 'sources/b.md' }, { resource: 'sources/missing.md' }, { resource: 'wiki/e.md' }] },
    'wiki/f.md': { sources: [{ resource: 'notes/c.md' }] },
  })
  const files = ['sources/a.md', 'sources/b.md', 'sources/deep/c.md']
  const table = (): LinkTable => ({ 'wiki/e.md': { 'wiki/f.md': 1 }, 'wiki/f.md': {}, 'sources/a.md': {} })

  it('adds the edges at layout ready and redraws the open graphs', () => {
    let global = 0
    let local = 0
    const t = table()
    const v = fakeVault({ pages: pages(), files, table: t, leaves: { graph: [{ dataEngine: { render: () => global++ } }], localgraph: [{ engine: { render: () => local++ } }] } })
    v.links.register()
    expect(t['wiki/e.md']).toEqual({ 'wiki/f.md': 1, 'sources/a.md': 1, 'sources/b.md': 1 })
    // An exact path that misses falls back to Obsidian's link resolution.
    expect(t['wiki/f.md']).toEqual({ 'sources/deep/c.md': 1 })
    expect([global, local]).toEqual([1, 1])
    expect(v.triggered).toEqual([])
  })

  it('re-adds a page’s edges after Obsidian rebuilds its row, and follows its frontmatter', () => {
    const p = pages()
    const t = table()
    const v = fakeVault({ pages: p, files, table: t })
    v.links.register()
    t['wiki/e.md'] = { 'wiki/f.md': 1 }
    p['wiki/e.md'] = { sources: [{ resource: 'sources/a.md' }] }
    v.fire('resolve', 'wiki/e.md')
    expect(t['wiki/e.md']).toEqual({ 'wiki/f.md': 1, 'sources/a.md': 1 })
    v.fire('resolved')
    expect(t['wiki/e.md']).toEqual({ 'wiki/f.md': 1, 'sources/a.md': 1 })
  })

  it('turning the setting off restores the table, and on adds the edges back', () => {
    const t = table()
    const before = structuredClone(t)
    const v = fakeVault({ pages: pages(), files, table: t })
    v.links.register()
    v.plugin.settings.sourceLinksInGraph = false
    v.links.apply()
    expect(t).toEqual(before)
    v.fire('resolve', 'wiki/e.md')
    v.fire('resolved')
    expect(t).toEqual(before)
    v.plugin.settings.sourceLinksInGraph = true
    v.links.apply()
    expect(t['wiki/e.md']).toEqual({ 'wiki/f.md': 1, 'sources/a.md': 1, 'sources/b.md': 1 })
  })

  it('takes every edge back out on unload', () => {
    const t = table()
    const before = structuredClone(t)
    const v = fakeVault({ pages: pages(), files, table: t })
    v.links.register()
    v.unload()
    expect(t).toEqual(before)
  })

  it('adds nothing while the setting is off', () => {
    const t = table()
    const before = structuredClone(t)
    const v = fakeVault({ pages: pages(), files, table: t, on: false })
    v.links.register()
    v.fire('resolve', 'wiki/e.md')
    expect(t).toEqual(before)
  })

  it('a graph with no engine gets one resolved event, which this does not answer itself', () => {
    const v = fakeVault({ pages: pages(), files, table: table(), leaves: { graph: [{}] } })
    v.links.register()
    expect(v.triggered).toEqual(['resolved'])
  })

  it('an engine that throws is logged, not thrown', () => {
    const v = fakeVault({ pages: pages(), files, table: table(), leaves: { graph: [{ dataEngine: { render: () => { throw new Error('internal') } } }] } })
    expect(() => v.links.register()).not.toThrow()
  })

  it('drops the edges of a page deleted since', () => {
    const p = pages()
    const t = table()
    const v = fakeVault({ pages: p, files, table: t })
    v.links.register()
    const row = t['wiki/f.md']
    delete p['wiki/f.md']
    delete t['wiki/f.md']
    v.fire('resolved')
    expect(row).toEqual({ 'sources/deep/c.md': 1 })
    expect('wiki/f.md' in t).toBe(false)
  })
})
