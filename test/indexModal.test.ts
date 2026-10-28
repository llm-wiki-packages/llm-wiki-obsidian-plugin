import { describe, expect, it } from 'vitest'
import { waitingFiles } from '../src/ui/indexModal'

describe('waitingFiles', () => {
  it('lists the paths search status counted as dirty, sorted', () => {
    expect(waitingFiles({ dirty: 2, dirty_paths: ['wiki/b.md', 'sources/a.md'] })).toEqual(['sources/a.md', 'wiki/b.md'])
  })

  it('is empty, not null, when the CLI names none dirty', () => {
    expect(waitingFiles({ dirty: 0, dirty_paths: [] })).toEqual([])
  })

  it('is null from a CLI that sends only the count, so the modal falls back to git', () => {
    expect(waitingFiles({ dirty: 1 })).toBeNull()
    expect(waitingFiles({ dirty: null, dirty_paths: null })).toBeNull()
    expect(waitingFiles(null)).toBeNull()
  })

  it('leaves the answer it read untouched', () => {
    const s = { dirty: 2, dirty_paths: ['b.md', 'a.md'] }
    waitingFiles(s)
    expect(s.dirty_paths).toEqual(['b.md', 'a.md'])
  })
})
