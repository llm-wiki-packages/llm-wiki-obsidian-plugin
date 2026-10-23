import { describe, expect, it } from 'vitest'
import { relativeTime } from '../src/ui/dom'

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

import { toolSentence } from '../src/views/chat'
import { sorted } from '../src/views/dashboard/jobs'
import type { JobView } from '../src/wiki/model'

describe('toolSentence: an llm-wiki command in words', () => {
  it('names the job a request runs, and leaves other commands alone', () => {
    expect(toolSentence('Bash', 'llm-wiki-ops jobs request inbox-joe wait=60s --json')).toBe('Running inbox-joe')
    expect(toolSentence('Bash', 'LLM_WIKI_PERMISSIONS=read llm-wiki-cli wiki --read-only kb jobs ls --verbose --json')).toBe('Reading the job list')
    expect(toolSentence('Bash', 'llm-wiki-ops doctor --json')).toBe('Running the doctor')
    expect(toolSentence('Bash', 'ls -la')).toBeNull()
    expect(toolSentence('Read', 'wiki/x.md')).toBeNull()
  })
})

describe('sorted: needs you, running, due, soonest, manual, paused', () => {
  const j = (slug: string, kind: JobView['next']['kind'], at?: string): JobView => ({ slug, name: slug, kind: 'pipeline', skill: null, schedule: '', paused: kind === 'paused', last: { at: null, outcome: null }, next: { kind, at }, running: null, credential: null, reasons: [], tickets: [] })
  it('orders by state then time', () => {
    expect(sorted([j('p', 'paused'), j('b', 'at', '2026-10-24T00:00:00Z'), j('a', 'at', '2026-10-23T13:00:00Z'), j('d', 'due'), j('u', 'unbound'), j('m', 'manual'), j('r', 'running')]).map((x) => x.slug)).toEqual(['u', 'r', 'd', 'a', 'b', 'm', 'p'])
  })
})
