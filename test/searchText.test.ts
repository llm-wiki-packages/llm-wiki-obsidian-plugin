import { describe, expect, it } from 'vitest'
import { corpusTrees, excerpt, holdsPassage, inCorpus, lineOf, passageOf, queryTerms } from '../src/wiki/searchText'

describe('the winning passage', () => {
  it('is the window inside the chunk, or the whole snippet without one', () => {
    expect(passageOf({ rank: 1, score: 1, snippet: 'aaa WINDOW bbb', passage_start: 4, passage_end: 10 })).toBe('WINDOW')
    expect(passageOf({ rank: 1, score: 1, snippet: 'whole chunk' })).toBe('whole chunk')
  })
})

describe('whether the page still holds it', () => {
  const page = '---\ntitle: x\n---\n# Pricing\n\nThe value equation says   price follows\nperceived value, not cost.\n\n> [!note]\n> Callouts fold too, line by line.\n'
  it('finds a passage across the whitespace the chunker and the file disagree about', () => {
    expect(holdsPassage(page, 'The value equation says price follows perceived value, not cost.')).toBe(true)
    expect(holdsPassage(page, '[!note] Callouts fold too, line by line.')).toBe(true)
  })
  it('misses text the page no longer has', () => {
    expect(holdsPassage(page, 'The value equation was replaced by a pricing ladder in 2025.')).toBe(false)
  })
  it('will not judge a passage too short to prove anything', () => {
    expect(holdsPassage(page, 'price')).toBeNull()
  })
  it('names the line the passage starts on', () => {
    expect(lineOf(page, 'The value equation says price follows')).toBe(6)
  })
})

describe('two lines worth reading', () => {
  it('marks the query words, longest first and case-blind', () => {
    const segs = excerpt('Models of pricing: a model prices value.', queryTerms('pricing model models'))
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(['Models', 'pricing', 'model'])
    expect(segs.map((s) => s.text).join('')).toBe('Models of pricing: a model prices value.')
  })
  it('starts near the first match when it sits past the lead', () => {
    const text = `${'filler words here '.repeat(10)}the hormozi offer`
    const out = excerpt(text, ['hormozi']).map((s) => s.text).join('')
    expect(out.startsWith('…')).toBe(true)
    expect(out.indexOf('hormozi')).toBeLessThan(60)
  })
  it('drops filler and short words from the terms', () => {
    expect(queryTerms('what is the value of an offer?')).toEqual(['value', 'offer'])
  })
})

describe('the corpus', () => {
  it('follows the paths, the exclusions and the files the CLI never indexes', () => {
    expect(inCorpus('wiki/a.md', ['wiki/', 'sources/'])).toBe(true)
    expect(inCorpus('wiki/index.md', ['wiki/'])).toBe(false)
    expect(inCorpus('wiki/.hidden/a.md', ['wiki/'])).toBe(false)
    expect(inCorpus('sources/web/a.md', ['wiki/', 'sources/'], ['sources/web/'])).toBe(false)
    expect(inCorpus('research/r.md', ['wiki/', 'sources/'])).toBe(false)
    expect(inCorpus('wiki/a.png', ['wiki/'])).toBe(false)
  })
  it('names the trees to ask git about', () => {
    expect(corpusTrees(['wiki/', 'sources/web/', 'sources/'])).toEqual(['wiki', 'sources'])
  })
})
