import { describe, expect, it, vi } from 'vitest'
import { DestRename } from '../src/vault/destRename'
import { destChecks } from '../src/wiki/dest'
import type LlmWikiPlugin from '../src/main'

vi.mock('obsidian', async (orig) => {
  const real = await orig<typeof import('obsidian')>()
  class Notice {
    static shown: unknown[] = []
    constructor(frag: unknown) {
      Notice.shown.push(frag)
    }
    hide(): void {}
  }
  return { ...real, Notice }
})
;(globalThis as { createFragment?: unknown }).createFragment = (fill: (f: unknown) => void) => {
  const el = { createDiv: () => el, createEl: () => el, createSpan: () => el, addEventListener: () => undefined, appendChild: () => undefined, setAttribute: () => undefined }
  fill(el)
  return el
}

const checks = destChecks({ jobs: [{ slug: 'acme', dest: 'sources/acme', state: 'ok' }, { slug: 'news', dest: 'sources/acme/news', state: 'fresh' }] })

function plugin(over: Partial<LlmWikiPlugin> = {}): LlmWikiPlugin & { refreshes: number } {
  const p = { actions: {}, snapshot: { dests: checks, jobs: [] }, refreshes: 0, refreshSnapshot() { p.refreshes++; return Promise.resolve() }, ...over }
  return p as unknown as LlmWikiPlugin & { refreshes: number }
}

describe('DestRename', () => {
  it('offers each job once, though a parent rename also renames the folders under it, and re-reads the wiki', async () => {
    const { Notice } = (await import('obsidian')) as unknown as { Notice: { shown: unknown[] } }
    Notice.shown.length = 0
    const p = plugin()
    const d = new DestRename(p)
    d.renamed('sources/acme', 'sources/blogs')
    d.renamed('sources/acme/news', 'sources/blogs/news')
    expect(Notice.shown).toHaveLength(2)
    expect(p.refreshes).toBe(2)
    d.renamed('sources/other', 'sources/x')
    expect(Notice.shown).toHaveLength(2)
    expect(p.refreshes).toBe(2)
  })
  it('offers nothing before the wiki is read', async () => {
    const { Notice } = (await import('obsidian')) as unknown as { Notice: { shown: unknown[] } }
    Notice.shown.length = 0
    new DestRename(plugin({ actions: null })).renamed('sources/acme', 'x')
    expect(Notice.shown).toHaveLength(0)
  })
})
