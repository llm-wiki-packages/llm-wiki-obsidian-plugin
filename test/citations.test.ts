// The Sources panel's logic: what a page cites, who cites a source, grouping, finding the quoted passage, and placement.
import { describe, expect, it } from 'vitest'
import { CiteIndex, citesOf, grouped, kindLabel, kindOf, locate, placeIn, sideWidth, sourceRows } from '../src/vault/citations'

describe('citesOf', () => {
  it('keeps every entry with its span and quote, in order', () => {
    const fm = { sources: [
      { resource: 'sources/documents/Org chart.md', id: 'x', span: 'Reporting lines', quote: 'CS reports to the VP' },
      { resource: 'sources/documents/Org chart.md', span: 'Teams' },
      'sources/Testing.md',
    ] }
    expect(citesOf(fm)).toEqual([
      { resource: 'sources/documents/Org chart.md', span: 'Reporting lines', quote: 'CS reports to the VP' },
      { resource: 'sources/documents/Org chart.md', span: 'Teams' },
      { resource: 'sources/Testing.md' },
    ])
  })
  it('skips what is malformed, and drops an empty span or quote', () => {
    expect(citesOf({ sources: [null, 3, {}, { resource: ' ' }, { resource: 'a.md', span: '', quote: 4 }] })).toEqual([{ resource: 'a.md' }])
    for (const fm of [undefined, null, 'x', {}, { sources: 'a.md' }]) expect(citesOf(fm)).toEqual([])
  })
})

describe('grouping', () => {
  it('takes the kind from the folder under the top one', () => {
    expect(kindOf('sources/slack/cs/2026-06-04.md')).toBe('slack')
    expect(kindOf('wiki/answers/Test Answer.md')).toBe('answers')
    expect(kindOf('sources/Testing.md')).toBe('')
    expect(kindLabel('meeting_notes')).toBe('Meeting notes')
    expect(kindLabel('')).toBe('Other')
  })
  it('groups by kind and sorts, Other last', () => {
    const row = (path: string) => ({ path, name: path.split('/').pop() ?? '', exists: true, cites: [] })
    const g = grouped([row('sources/Testing.md'), row('sources/slack/b.md'), row('sources/documents/z.md'), row('sources/slack/a.md')])
    expect(g.map((x) => [x.label, x.rows.map((r) => r.name)])).toEqual([
      ['Documents', ['z.md']],
      ['Slack', ['a.md', 'b.md']],
      ['Other', ['Testing.md']],
    ])
  })
})

describe('sourceRows', () => {
  it('gives each file one row with its passages, and keeps a missing one marked', () => {
    const resolve = (r: string) => (r === 'missing.md' ? null : r.startsWith('sources/') ? r : `sources/notes/${r}`)
    const rows = sourceRows([
      { resource: 'sources/a.md', span: 'One', quote: 'q1' },
      { resource: 'sources/a.md', span: 'Two' },
      { resource: 'b.md' },
      { resource: 'missing.md', quote: 'q' },
    ], resolve)
    expect(rows).toEqual([
      { path: 'sources/a.md', name: 'a', exists: true, cites: [{ span: 'One', quote: 'q1' }, { span: 'Two', quote: undefined }] },
      { path: 'sources/notes/b.md', name: 'b', exists: true, cites: [] },
      { path: 'missing.md', name: 'missing', exists: false, cites: [{ span: undefined, quote: 'q' }] },
    ])
  })
})

describe('CiteIndex', () => {
  it('lists the pages citing a source, by title, with what each took from it', () => {
    const idx = new CiteIndex()
    idx.rebuild([
      { path: 'wiki/answers/A.md', title: 'Answer A', frontmatter: { sources: [{ resource: 'sources/s.md', span: 'Intro', quote: 'hello' }, { resource: 'sources/t.md' }] } },
      { path: 'wiki/concepts/B.md', frontmatter: { sources: ['sources/s.md', { resource: 'wiki/concepts/B.md' }] } },
      { path: 'wiki/C.md', frontmatter: { title: 'no sources' } },
    ], (r) => (r === 'nowhere.md' ? null : r))
    expect(idx.citing('sources/s.md')).toEqual([
      { path: 'wiki/answers/A.md', name: 'Answer A', exists: true, cites: [{ span: 'Intro', quote: 'hello' }] },
      { path: 'wiki/concepts/B.md', name: 'B', exists: true, cites: [] },
    ])
    expect(idx.citing('wiki/concepts/B.md')).toEqual([])
    expect(idx.citing('sources/none.md')).toEqual([])
  })
})

describe('locate', () => {
  const text = '# Title\n\n## Reporting lines\n\nCustomer Success reports to\nthe VP of Customer as of June.\n'
  it('finds the exact quote', () => {
    const at = text.indexOf('Customer Success')
    expect(locate(text, 'Customer Success reports to')).toEqual({ from: at, to: at + 'Customer Success reports to'.length, line: 4 })
  })
  it('finds the quote however the source wraps it', () => {
    const spot = locate(text, 'reports to the VP of Customer')
    expect(spot && 'from' in spot ? text.slice(spot.from, spot.to) : null).toBe('reports to\nthe VP of Customer')
  })
  it('falls back to the opening words, then the span heading', () => {
    expect(locate(text, 'Customer Success reports to the VP of Sales, said nobody')).toMatchObject({ line: 4 })
    expect(locate(text, 'not here at all', 'reporting lines')).toEqual({ line: 2 })
    expect(locate(text, undefined, 'nothing')).toBeNull()
  })
})

describe('placement', () => {
  it('fits the side panel in the free margin, or not at all', () => {
    expect(sideWidth(500)).toBe(320)
    expect(sideWidth(260)).toBe(228)
    expect(sideWidth(220)).toBeNull()
  })
  it('falls back to the bottom when beside does not fit', () => {
    expect(placeIn('side', 300)).toEqual({ side: true, bottom: false })
    expect(placeIn('side', null)).toEqual({ side: false, bottom: true })
    expect(placeIn('both', 300)).toEqual({ side: true, bottom: true })
    expect(placeIn('both', null)).toEqual({ side: false, bottom: true })
    expect(placeIn('bottom', 300)).toEqual({ side: false, bottom: true })
    expect(placeIn('off', 300)).toEqual({ side: false, bottom: false })
  })
})
