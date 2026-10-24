import { describe, expect, it } from 'vitest'
import { linkOf } from '../src/ui/links'

const anchor = (className: string, attrs: Record<string, string>) => ({
  className,
  dataset: { href: attrs['data-href'] },
  getAttribute: (n: string) => attrs[n] ?? null,
})

describe('linkOf', () => {
  it('reads a wikilink from data-href', () => {
    expect(linkOf(anchor('internal-link', { href: 'AGENTS.md', 'data-href': 'AGENTS.md' }))).toEqual({ kind: 'internal', path: 'AGENTS.md' })
  })
  it('falls back to href on an internal link', () => {
    expect(linkOf(anchor('internal-link is-unresolved', { href: 'wiki/money-models' }))).toEqual({ kind: 'internal', path: 'wiki/money-models' })
  })
  it('opens http links outside', () => {
    expect(linkOf(anchor('external-link', { href: 'https://example.com/x' }))).toEqual({ kind: 'external', url: 'https://example.com/x' })
  })
  it('ignores anything else', () => {
    expect(linkOf(anchor('', { href: '#top' }))).toBeNull()
    expect(linkOf(anchor('', { href: 'javascript:alert(1)' }))).toBeNull()
  })
})
