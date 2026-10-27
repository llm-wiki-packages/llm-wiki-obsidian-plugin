// The plugin side of llm-wiki-plugins #3675 and #3687: the CLI's layout,
// `git status`, `page diff`, `page ls id=` and `page fix`, and the editor origin.
// The answers below are real ones, captured from a scratch wiki on the CLI
// branch (#3689 over main at bca44b6fe).
import { afterEach, describe, expect, it } from 'vitest'
import { VERBS, childEnv } from '../src/wiki/cli'
import { DEFAULT_LAYOUT, isFeed, isLifecycle, isWikiPage, layout, layoutFrom, setLayout } from '../src/wiki/layout'
import { diffSummary, fileChange, pageEvent, valueText, type DiffAnswer } from '../src/wiki/diff'
import { documentIdOf, isFreshCopy } from '../src/vault/copies'
import { titleAfterRename } from '../src/vault/titles'

describe('layout from whereami', () => {
  afterEach(() => setLayout({}))
  it('reads the seeded answer as the seeded layout: the wiki is not a feed of itself', () => {
    setLayout(layoutFrom({ feeds: ['wiki/', 'sources/'], pages: 'wiki/', raw: '_raw/', templates: 'templates/' }))
    expect(layout()).toEqual(DEFAULT_LAYOUT)
  })
  it('follows a moved layout, nested trees included', () => {
    setLayout(layoutFrom({ feeds: ['kb/', 'notes/inbox/', 'clips/'], pages: 'kb/', raw: '.raw/', templates: 'tpl/' }))
    expect(layout()).toMatchObject({ feeds: ['notes/inbox', 'clips'], wiki: ['kb'], raw: '.raw', templates: 'tpl' })
    expect(isFeed('notes/inbox/a.md')).toBe(true)
    expect(isFeed('notes/other/a.md')).toBe(false)
    expect(isWikiPage('kb/topic.md')).toBe(true)
    expect(isLifecycle('kb/index.md')).toBe(false)
  })
  it('keeps the defaults for a CLI that does not say', () => {
    setLayout(layoutFrom(undefined))
    expect(layout()).toEqual(DEFAULT_LAYOUT)
  })
})

describe('the new verbs', () => {
  it('spells the reads with the floor', () => {
    expect(VERBS['wiki.whereami']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'whereami', '--json'])
    expect(VERBS['wiki.git.status']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'git', 'status', '--json'])
    expect(VERBS['wiki.page.diff']({ wiki: 'kb', path: 'sources/notes/Alpha note.md' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'diff', 'sources/notes/Alpha note.md', '--json'])
    expect(VERBS['wiki.page.diff']({ wiki: 'kb', path: 'a.md', commit: '2619488fa93d' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'diff', 'a.md', 'commit=2619488fa93d', '--json'])
    expect(VERBS['wiki.page.find']({ wiki: 'kb', id: '6f3f9a11-8783-46bf-a9bd-ce76d7a814a1' })).toEqual(['wiki', '--read-only', 'kb', 'page', 'ls', 'id=6f3f9a11-8783-46bf-a9bd-ce76d7a814a1', '--json'])
  })
  it('refuses what would not be one clean argument', () => {
    expect(() => VERBS['wiki.page.diff']({ wiki: 'kb', path: 'a.md', commit: 'HEAD~1' })).toThrow(/bad commit/)
    expect(() => VERBS['wiki.page.find']({ wiki: 'kb', id: 'x y' })).toThrow(/bad document id/)
    expect(() => VERBS['wiki.page.find']({ wiki: 'kb', id: '-rf' })).toThrow(/bad document id/)
  })
  it('passes --force to page fix only when asked', () => {
    expect(VERBS['wiki.page.fix']({ wiki: 'kb', paths: ['a 1.md'], force: true })).toEqual(['wiki', 'kb', 'page', 'fix', 'a 1.md', '--force', '--json'])
    expect(VERBS['wiki.page.fix']({ wiki: 'kb', paths: ['a 1.md'] })).toEqual(['wiki', 'kb', 'page', 'fix', 'a 1.md', '--json'])
  })
})

describe('the editor origin', () => {
  it('marks the page writes a click or the sweep makes, and lifts the read floor for them', () => {
    for (const v of ['wiki.page.curate', 'wiki.page.adopt', 'wiki.page.fix', 'wiki.git.commit'] as const) {
      const env = childEnv({ PATH: '/bin' }, v)
      expect(env.LLM_WIKI_SESSION_ORIGIN).toBe('editor')
      expect(env.LLM_WIKI_PERMISSIONS).toBeUndefined()
    }
  })
  it('strips an inherited origin from everything else: a job run or the agent is not the editor', () => {
    for (const v of ['wiki.jobs.request', 'wiki.harness.run', 'wiki.git.sync', 'wiki.page.diff'] as const)
      expect(childEnv({ PATH: '/bin', LLM_WIKI_SESSION_ORIGIN: 'editor' }, v).LLM_WIKI_SESSION_ORIGIN).toBeUndefined()
  })
})

const DIFF: DiffAnswer = {
  path: 'sources/notes/Alpha note.md',
  old: { at: 'saved', sha: '155661166ef961051f8f44c94907770180673527', path: 'sources/notes/Alpha note.md', revision: 2, exists: true, frontmatter: 'ok' },
  new: { at: 'working', sha: null, path: 'sources/notes/Alpha note.md', revision: 2, exists: true, frontmatter: 'ok' },
  frontmatter: [
    { key: 'tags', change: 'changed', old: ['demo'], new: ['demo', 'more'] },
    { key: 'Draft', change: 'added', old: null, new: 'true' },
  ],
  hunks: [{ old_start: 18, old_count: 2, new_start: 18, new_count: 2, lines: [
    { kind: 'removed', old: 18, new: null, text: 'First line.' },
    { kind: 'added', old: null, new: 18, text: 'First line, again.' },
    { kind: 'context', old: 19, new: 19, text: 'Second line, edited.Third.' },
  ] }],
  identical: false,
}

describe('page diff in words', () => {
  it('counts properties apart from lines', () => {
    expect(diffSummary(DIFF)).toBe('2 properties · +1 −1 lines')
    expect(diffSummary({ ...DIFF, frontmatter: [], hunks: [], identical: true })).toBe('No changes')
  })
  it('puts a value on one line', () => {
    expect(valueText(['demo', 'more'])).toBe('demo, more')
    expect(valueText(null)).toBe('—')
    expect(valueText([])).toBe('—')
    expect(valueText({ by: 'ops' })).toBe('{"by":"ops"}')
    expect(valueText(3)).toBe('3')
  })
  it('names what happened to the page as a whole', () => {
    expect(pageEvent(DIFF)).toBeNull()
    expect(pageEvent({ old: { ...DIFF.old, exists: false }, new: DIFF.new })).toBe('A new page, not saved to history yet')
    expect(pageEvent({ old: { ...DIFF.old, exists: false }, new: { ...DIFF.new, at: 'sha:2619488' } })).toBe('The page begins here')
    expect(pageEvent({ old: DIFF.old, new: { ...DIFF.new, exists: false } })).toBe('The page was deleted')
    expect(pageEvent({ old: { ...DIFF.old, path: 'sources/notes/Old.md' }, new: DIFF.new })).toBe('Renamed from sources/notes/Old.md')
  })
  it('reads git log letters as words', () => {
    expect(['A', 'M', 'D', 'R100'].map(fileChange)).toEqual(['added', 'edited', 'deleted', 'renamed'])
  })
})

describe('a copy Obsidian made', () => {
  const ID = '6f3f9a11-8783-46bf-a9bd-ce76d7a814a1'
  const carriers = [
    { path: 'sources/notes/Alpha note 1.md', duplicate_of: ['sources/notes/Alpha note.md'] },
    { path: 'sources/notes/Alpha note.md', duplicate_of: ['sources/notes/Alpha note 1.md'] },
  ]
  it('reads the id off the text, quoted or not, and only from the frontmatter', () => {
    expect(documentIdOf(`---\ntype: note\ndocument_id: ${ID}\n---\nbody`)).toBe(ID)
    expect(documentIdOf(`---\ndocument_id: '${ID}'\n---\n`)).toBe(ID)
    expect(documentIdOf(`no frontmatter\ndocument_id: ${ID}\n`)).toBeNull()
    expect(documentIdOf('---\ntitle: x\n---\ndocument_id: y\n')).toBeNull()
  })
  it('is a new file sharing its id with a committed page', () => {
    expect(isFreshCopy('sources/notes/Alpha note 1.md', carriers, [{ path: 'sources/notes/Alpha note 1.md', status: 'untracked' }])).toBe(true)
  })
  it('is not the original, nor a page alone with its id, nor two new files (lint names those)', () => {
    const status = [{ path: 'sources/notes/Alpha note 1.md', status: 'untracked' }]
    expect(isFreshCopy('sources/notes/Alpha note.md', carriers, status)).toBe(false)
    expect(isFreshCopy('sources/notes/Alpha note 1.md', [{ path: 'sources/notes/Alpha note 1.md', duplicate_of: [] }], status)).toBe(false)
    expect(isFreshCopy('sources/notes/Alpha note 1.md', carriers, [...status, { path: 'sources/notes/Alpha note.md', status: 'untracked' }])).toBe(false)
    expect(isFreshCopy('sources/notes/Alpha note 1.md', carriers, [])).toBe(false)
  })
})

describe('the title follows a rename', () => {
  it('takes the new name', () => {
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/notes/Beta.md', 'Alpha')).toBe('Beta')
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/notes/Beta.md', 'Something else')).toBe('Beta')
  })
  it('leaves a move, an untitled note, a page with no title, and one already right', () => {
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/web/Alpha.md', 'Alpha')).toBeNull()
    expect(titleAfterRename('sources/notes/Untitled.md', 'sources/notes/Beta.md', '')).toBeNull()
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/notes/Untitled 2.md', 'Alpha')).toBeNull()
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/notes/Beta.md', undefined)).toBeNull()
    expect(titleAfterRename('sources/notes/Alpha.md', 'sources/notes/Beta.md', 'Beta')).toBeNull()
  })
})
