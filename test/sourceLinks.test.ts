// A page's frontmatter sources as graph edges: which paths count, and what is added to and taken from the link table.
import { describe, expect, it } from 'vitest'
import { SourceEdges, sourcePathsOf, type LinkTable } from '../src/vault/sourceLinks'

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
