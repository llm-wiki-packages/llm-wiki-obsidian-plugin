import { afterEach, describe, expect, it } from 'vitest'
import { VERBS } from '../src/wiki/cli'
import { isContent, isFeed, isLifecycle, isSwept, neverIndexed, setLayout } from '../src/wiki/layout'
import { collapses, groupPages } from '../src/vault/groups'
import type { PageFacts } from '../src/vault/pages'
import { boxSet, hostOf } from '../src/vault/pages'
import { fillFor } from '../src/vault/templates'
import { dayOf, whoOf } from '../src/wiki/who'
import { rolesOf } from '../src/wiki/snapshot'

const page = (path: string, over: Partial<PageFacts> = {}): PageFacts => ({ path, title: path, job: null, blurb: '', host: null, mtime: 0, draft: false, archive: false, ...over })

describe('layout: the one place a tree is spelled', () => {
  afterEach(() => setLayout({}))
  it('answers for the seeded layout', () => {
    expect(isFeed('sources/web/a.md')).toBe(true)
    expect(isLifecycle('wiki/topics/x.md')).toBe(true)
    expect(isLifecycle('wiki/index.md')).toBe(false)
    expect(isLifecycle('sources/web/_versions/a.md')).toBe(false)
    expect(isLifecycle('research/run/notes.md')).toBe(false)
    expect(isContent('research/run/notes.md')).toBe(true)
    expect(isSwept('templates/Note.md')).toBe(true)
    expect(isSwept('_raw/job/page.md')).toBe(false)
    expect(neverIndexed('wiki/log.md')).toBe(true)
  })
  it('follows a custom layout', () => {
    setLayout({ feeds: ['inbox', 'clips'], wiki: ['kb'] })
    expect(isFeed('clips/a.md')).toBe(true)
    expect(isFeed('sources/a.md')).toBe(false)
    expect(neverIndexed('kb/index.md')).toBe(true)
  })
})

describe('groupPages: what came in, by source or folder', () => {
  const pages = [
    page('sources/youtube/lex/a.md', { job: 'yt-lex', mtime: 3 }),
    page('sources/youtube/lex/b.md', { job: 'yt-lex', mtime: 5 }),
    page('sources/notes/mine.md', { mtime: 4 }),
  ]
  it('groups by the job that brought a page, newest group first, folder kept when shared', () => {
    const g = groupPages(pages, 'source', (s) => (s === 'yt-lex' ? 'YouTube · Lex' : undefined))
    expect(g.map((x) => [x.label, x.folder, x.pages.map((p) => p.mtime)])).toEqual([
      ['YouTube · Lex', 'sources/youtube/lex', [5, 3]],
      ['sources/notes', 'sources/notes', [4]],
    ])
  })
  it('groups by folder, or not at all', () => {
    expect(groupPages(pages, 'folder').map((x) => x.label)).toEqual(['sources/youtube/lex', 'sources/notes'])
    expect(groupPages(pages, 'none')).toHaveLength(1)
    expect(groupPages([], 'none')).toEqual([])
  })
  it('folds a group past the threshold until it is opened', () => {
    const [g] = groupPages(pages, 'source')
    expect(collapses(g!, 1, false)).toBe(true)
    expect(collapses(g!, 1, true)).toBe(false)
    expect(collapses(g!, 0, false)).toBe(false)
  })
})

describe('page facts', () => {
  it('reads a box the way #3669 does', () => {
    expect(boxSet({ Draft: true }, 'Draft')).toBe(true)
    expect(boxSet({ Draft: 'true' }, 'Draft')).toBe(true)
    expect(boxSet({ Draft: false }, 'Draft')).toBe(false)
    expect(boxSet(undefined, 'Draft')).toBe(false)
  })
  it('names a host only for a web resource', () => {
    expect(hostOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(hostOf('gmail:day:2026-10-27')).toBeNull()
  })
})

describe('templates on a new note', () => {
  it('leaves the title empty while the note is still Untitled', () => {
    expect(fillFor({ add: { title: 'Untitled 2', type: 'note' } }, 'sources/notes/Untitled 2.md')).toEqual({ add: { title: '', type: 'note' }, body: null, waitsForName: true })
    expect(fillFor({ add: { title: 'Plans' }, body: '## Notes' }, 'sources/notes/Plans.md')).toEqual({ add: { title: 'Plans' }, body: '## Notes', waitsForName: false })
  })
})

describe('who made a commit', () => {
  it('reads the trailers in a person’s words', () => {
    expect(whoOf({ op: 'none', actor: 'user@mac' }, 'mac')).toEqual({ kind: 'you', label: 'You' })
    expect(whoOf({ op: 'none', actor: 'user@mini' }, 'mac')).toEqual({ kind: 'you', label: 'You · mini' })
    expect(whoOf({ op: 'dream', actor: 'agent@mini' }, 'mac')).toEqual({ kind: 'agent', label: 'Dream · mini' })
    expect(whoOf({ op: 'inbox-joe', actor: 'agent@mac' }, 'mac', (s) => (s === 'inbox-joe' ? 'Joe’s mailbox' : undefined))).toEqual({ kind: 'job', label: 'Joe’s mailbox' })
  })
  it('names the day', () => {
    const now = Date.parse('2026-10-27T15:00:00')
    expect(dayOf('2026-10-27T09:00:00', now)).toBe('Today')
    expect(dayOf('2026-10-26T23:00:00', now)).toBe('Yesterday')
  })
})

describe('fleet roles and the new verbs', () => {
  it('lists the stages a machine says are ready', () => {
    expect(rolesOf({ 'channel-youtube': { harvest: 'ready', process: 'sandbox-unbound' }, 'PLUGIN:transcribe': { transcribe: 'ready' }, x: 'disabled' })).toEqual(['harvest', 'transcribe'])
  })
  it('builds argv for the reads and writes', () => {
    expect(VERBS['wiki.status']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'status', '--peers', '--json'])
    expect(VERBS['wiki.git.log']({ wiki: 'kb', since: '7d' })).toEqual(['wiki', '--read-only', 'kb', 'git', 'log', 'filter=since:7d', '--json'])
    expect(VERBS['wiki.page.template']({ wiki: 'kb', path: 'sources/notes/Untitled.md' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'template', 'sources/notes/Untitled.md', '--json'])
    expect(VERBS['wiki.git.commit']({ wiki: 'kb' })).toEqual(['wiki', 'kb', 'git', 'commit', '--json'])
    expect(() => VERBS['wiki.page.history']({ wiki: 'kb', path: '-rf.md' })).toThrow()
  })
})
