import { describe, expect, it } from 'vitest'
import { humanEvery, relativeTime } from '../src/ui/dom'

describe('relativeTime', () => {
  const now = Date.parse('2026-10-23T12:00:00Z')
  it('reads past and future in the coarsest unit that fits', () => {
    expect(relativeTime('2026-10-23T11:57:00Z', now)).toBe('3m ago')
    expect(relativeTime('2026-10-23T09:00:00Z', now)).toBe('3h ago')
    expect(relativeTime('2026-10-20T12:00:00Z', now)).toBe('3d ago')
    expect(relativeTime('2026-10-23T12:40:00Z', now)).toBe('in 40m')
    expect(relativeTime('2026-10-23T12:00:10Z', now)).toBe('now')
  })
  it('passes through what it cannot parse, and nothing for nothing', () => {
    expect(relativeTime(null)).toBe('')
    expect(relativeTime('soon')).toBe('soon')
  })
})

describe('humanEvery', () => {
  it('turns seconds into the largest whole unit', () => {
    expect(humanEvery(3600)).toBe('1h')
    expect(humanEvery(86400 * 2)).toBe('2d')
    expect(humanEvery(90)).toBe('90s')
    expect(humanEvery('daily 06:00')).toBe('daily 06:00')
    expect(humanEvery(null)).toBe('')
  })
})
