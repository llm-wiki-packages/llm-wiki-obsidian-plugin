// A page's Properties panel: the order rows take and what More says.
import { describe, expect, it } from 'vitest'
import { BOOKKEEPING_KEYS, FIRST_KEYS, keyOrder, moreText } from '../src/vault/properties'

describe('the properties panel', () => {
  it('leads with the keys a person writes, in their order, and puts bookkeeping last', () => {
    const keys = ['document_id', 'tags', 'source_url', 'title', 'verified', 'type']
    expect([...keys].sort((a, b) => keyOrder(a) - keyOrder(b))).toEqual(['title', 'type', 'tags', 'source_url', 'document_id', 'verified'])
    expect(FIRST_KEYS.every((k) => keyOrder(k) < 0)).toBe(true)
    expect(BOOKKEEPING_KEYS.every((k) => keyOrder(k) === 100)).toBe(true)
    // The pipeline's two objects from page shape 3 fold away with the rest.
    expect(keyOrder('ops')).toBe(100)
    expect(keyOrder('narrate')).toBe(100)
    expect(keyOrder('anything_else')).toBe(0)
  })
  it('counts what More folds away', () => {
    expect(moreText(3, false)).toBe('More (3)')
    expect(moreText(3, true)).toBe('Less')
  })
})
