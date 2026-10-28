// The reports and HTML artifacts: pairing a record with its brief, the order
// they read in, and what a brief is given before it is shown.
import { describe, expect, it } from 'vitest'
import { briefOf, collectReports, framePolicy, joinPath, nonce, otherHtml, seriesOf, trustsScripts, type FileRow } from '../src/vault/reports'

const rows: FileRow[] = [
  { path: 'wiki/reports/2026-10-27.md', mtime: 2, fm: { title: '2026-10-27', date: '2026-10-27', dashboard: '2026-10-27.html', lede: 'Renewals are the theme.', attention: '[{"title":"Reply to Acme"},{"detail":"no title"}]' } },
  { path: 'wiki/reports/2026-10-27.html', mtime: 2 },
  { path: 'wiki/reports/2026-10-28.md', mtime: 3, fm: { title: 'Monday', dashboard: './brief-28.html', description: 'Quiet day.', attention: [{ title: 'Renew the cert' }] } },
  { path: 'wiki/reports/brief-28.html', mtime: 3 },
  { path: 'wiki/reports/2026-10-26.md', mtime: 1, fm: {} },
  { path: 'wiki/reports/2026-10-25.html', mtime: 0 },
  { path: 'wiki/reports/2026-10-27.html.md', mtime: 2, fm: { source: '2026-10-27.html' } },
  { path: 'wiki/reports/_template.html', mtime: 9 },
  { path: 'wiki/reports/index.md', mtime: 9 },
  { path: 'wiki/reports/.trash/2026-10-01.md', mtime: 9 },
  { path: 'research/charts/usage.html', mtime: 5 },
  { path: 'notes/old.htm', mtime: 4 },
  { path: 'wiki/topics/x.md', mtime: 9 },
]

describe('the reports', () => {
  const reports = collectReports(rows)
  it('pair each record with the brief it names, or its sibling, newest first', () => {
    expect(reports.map((r) => [r.date, r.record, r.brief])).toEqual([
      ['2026-10-28', 'wiki/reports/2026-10-28.md', 'wiki/reports/brief-28.html'],
      ['2026-10-27', 'wiki/reports/2026-10-27.md', 'wiki/reports/2026-10-27.html'],
      ['2026-10-26', 'wiki/reports/2026-10-26.md', null],
      ['2026-10-25', null, 'wiki/reports/2026-10-25.html'],
    ])
  })
  it('carry the lede, a title only when it says more than the date, and the attention titles', () => {
    expect(reports[0]).toMatchObject({ title: 'Monday', summary: 'Quiet day.', attention: ['Renew the cert'] })
    expect(reports[1]).toMatchObject({ title: '', summary: 'Renewals are the theme.', attention: ['Reply to Acme'] })
  })
  it('leave the template, the index, adopt stubs and dot folders out', () => {
    const paths = reports.flatMap((r) => [r.record, r.brief])
    for (const p of ['wiki/reports/_template.html', 'wiki/reports/index.md', 'wiki/reports/2026-10-27.html.md', 'wiki/reports/.trash/2026-10-01.md']) expect(paths).not.toContain(p)
  })
  it('step between briefs: newer, older, and the record beside one', () => {
    expect(seriesOf(reports, 'wiki/reports/2026-10-27.html')).toEqual({ newer: 'wiki/reports/brief-28.html', older: 'wiki/reports/2026-10-25.html', record: 'wiki/reports/2026-10-27.md' })
    expect(seriesOf(reports, 'wiki/reports/brief-28.html')).toMatchObject({ newer: null })
    expect(seriesOf(reports, 'research/charts/usage.html')).toBeNull()
  })
  it('list the other HTML in the vault, newest first', () => {
    expect(otherHtml(rows).map((r) => r.path)).toEqual(['research/charts/usage.html', 'notes/old.htm'])
  })
})

describe('a record’s dashboard link', () => {
  it('resolves against the record’s folder, however it is written', () => {
    expect(briefOf('wiki/reports/a.md', 'a.html')).toBe('wiki/reports/a.html')
    expect(briefOf('wiki/reports/a.md', './briefs/a.html')).toBe('wiki/reports/briefs/a.html')
    expect(briefOf('wiki/reports/a.md', '[[a.html|brief]]')).toBe('wiki/reports/a.html')
    expect(briefOf('wiki/reports/a.md', 'my%20brief.html#top')).toBe('wiki/reports/my brief.html')
    expect(briefOf('wiki/reports/a.md', 'https://x.example/a.html')).toBeNull()
    expect(briefOf('wiki/reports/a.md', undefined)).toBeNull()
  })
  it('never climbs out of the vault', () => {
    expect(joinPath('wiki', '../../x.html')).toBeNull()
    expect(joinPath('wiki/reports', '../topics/x.md')).toBe('wiki/topics/x.md')
  })
})

// `framed` parses with DOMParser, which Node lacks; it is checked in a browser against probe pages (PR #15).
describe('the frame’s policy', () => {
  it('fetches nothing: no source but inline and data, so not the web, localhost or file:', () => {
    for (const p of [framePolicy(null), framePolicy('abc')]) {
      expect(p).toMatch(/default-src 'none'/)
      expect(p).not.toMatch(/https?:|file:|\*|'self'/)
      expect(p).toMatch(/form-action 'none'/)
    }
  })
  it('lets only the bridge run when the page’s own scripts are off', () => {
    expect(framePolicy('abc')).toMatch(/script-src 'nonce-abc'(;|$)/)
    expect(framePolicy('abc')).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(framePolicy(null)).toMatch(/script-src 'unsafe-inline'/)
    expect(nonce()).toMatch(/^[0-9a-f]{32}$/)
    expect(nonce()).not.toBe(nonce())
  })
  it('runs a page’s own scripts only for a brief in wiki/reports/', () => {
    expect(trustsScripts('wiki/reports/2026-10-28.html')).toBe(true)
    expect(trustsScripts('sources/web/acme/page.html')).toBe(false)
    expect(trustsScripts('research/charts/usage.html')).toBe(false)
  })
})
