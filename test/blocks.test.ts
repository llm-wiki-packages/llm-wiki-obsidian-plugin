import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { editorInfoField } from 'obsidian'
import { blockExtension, blocksField, ownerWords } from '../src/ui/blockEditor'
import { blockAtLine, blockText, bodyOf, frontmatterEnd, lineDiff, parseBlocks, setAsideByBlock, setAsideOf } from '../src/vault/blocks'
import type LlmWikiPlugin from '../src/main'

const PAGE = [
  '# Course', //                                   0
  '<!-- ops course-summary:s1 -->', //              1
  'The summary.', //                                2
  '<!-- ops course-summary:n1 edits=discard -->', // 3
  'A generated note.[^1]', //                       4
  '<!-- /ops course-summary:n1 -->', //             5
  '<!-- /ops course-summary:s1 -->', //             6
  'My own line.', //                                7
].join('\n')

describe('parseBlocks: the CLI’s markers', () => {
  it('reads nested blocks, their attributes and parents, in order', () => {
    const blocks = parseBlocks(PAGE)
    expect(blocks.map((b) => [b.address, b.first, b.last, b.parent, b.discard])).toEqual([
      ['course-summary:s1', 1, 6, null, false],
      ['course-summary:n1', 3, 5, 'course-summary:s1', true],
    ])
    expect(blocks[1]!.attrs).toEqual({ edits: 'discard' })
    expect(blockText(PAGE, blocks[1]!)).toBe('A generated note.[^1]')
    expect(blockAtLine(blocks, 4)?.address).toBe('course-summary:n1')
    expect(blockAtLine(blocks, 2)?.address).toBe('course-summary:s1')
    expect(blockAtLine(blocks, 7)).toBeNull()
  })
  it('splits the address at the last colon, as a writer may carry colons', () => {
    expect(parseBlocks('<!-- ops job:acme/blog:x-1 -->\nt\n<!-- /ops job:acme/blog:x-1 -->')[0]).toMatchObject({ writer: 'job:acme/blog', id: 'x-1' })
  })
  it('leaves malformed markers as text: crossing, unclosed, repeated, a close of nothing', () => {
    expect(parseBlocks('<!-- ops a:1 -->\n<!-- ops b:2 -->\n<!-- /ops a:1 -->\n<!-- /ops b:2 -->')).toEqual([])
    expect(parseBlocks('<!-- ops a:1 -->\ntext')).toEqual([])
    expect(parseBlocks('<!-- ops a:1 -->\n<!-- /ops a:1 -->\n<!-- ops a:1 -->\n<!-- /ops a:1 -->')).toEqual([])
    expect(parseBlocks('<!-- /ops a:1 -->\n<!-- ops b:2 -->\nx\n<!-- /ops b:2 -->').map((b) => b.address)).toEqual(['b:2'])
    expect(parseBlocks('<!-- ops A:1 -->\nx\n<!-- /ops A:1 -->')).toEqual([])
    expect(parseBlocks('text <!-- ops a:1 -->\nx\n<!-- /ops a:1 -->')).toEqual([])
  })
  it('a marker inside a code fence is an example', () => {
    expect(parseBlocks('```md\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->\n```')).toEqual([])
    expect(parseBlocks('~~~~\n<!-- ops a:1 -->\n~~~\n<!-- /ops a:1 -->\n~~~~\n<!-- ops b:1 -->\n<!-- /ops b:1 -->').map((b) => b.address)).toEqual(['b:1'])
    expect(parseBlocks('> ```\n> <!-- ops a:1 -->\n> <!-- /ops a:1 -->\n> ```')).toEqual([])
  })
})

describe('ops.set_aside', () => {
  const fm = { ops: { set_aside: [
    { path: 'wiki/_versions/page.2026-11-01.course-summary-s1.md', at: '2026-11-01T10:00:00Z', from: 'course-summary:s1' },
    { path: 'wiki/_versions/page.2026-11-07.course-summary-s1.md', at: '2026-11-07T10:00:00Z', from: 'course-summary:s1' },
    { path: 'wiki/_versions/page.2026-11-07.md', at: '2026-11-07T10:00:00Z', from: 'wiki/page.md' },
    { path: 7, from: 'x:1' }, 'junk',
  ] } }
  it('reads the entries, nested or dotted, and drops what is not one', () => {
    expect(setAsideOf(fm)).toHaveLength(3)
    expect(setAsideOf({ 'ops.set_aside': [{ path: 'p.md', from: 'a:1' }] })).toEqual([{ path: 'p.md', from: 'a:1', at: null }])
    expect(setAsideOf({ ops: { set_aside: 'x' } })).toEqual([])
    expect(setAsideOf(undefined)).toEqual([])
  })
  it('keeps the newest entry per block on the page; a whole-page entry names no block', () => {
    const by = setAsideByBlock(setAsideOf(fm), parseBlocks(PAGE))
    expect([...by.keys()]).toEqual(['course-summary:s1'])
    expect(by.get('course-summary:s1')?.path).toBe('wiki/_versions/page.2026-11-07.course-summary-s1.md')
  })
  it('a copy’s text is its body', () => {
    expect(bodyOf('---\ntitle: x\nstatus: deprecated\n---\nmine\n')).toBe('mine\n')
    expect(bodyOf('no frontmatter')).toBe('no frontmatter')
  })
})

describe('lineDiff', () => {
  it('marks the person’s lines and the writer’s, keeping what both have', () => {
    expect(lineDiff('a\nmine\nc\n', 'a\ntheirs\nc')).toEqual([
      { kind: 'same', text: 'a' }, { kind: 'mine', text: 'mine' }, { kind: 'theirs', text: 'theirs' }, { kind: 'same', text: 'c' },
    ])
    expect(lineDiff('x', 'x')).toEqual([{ kind: 'same', text: 'x' }])
  })
})

describe('the editor rules', () => {
  const plugin = { app: { metadataCache: { getFileCache: () => null } } } as unknown as LlmWikiPlugin
  const state = () => EditorState.create({ doc: PAGE, extensions: [editorInfoField, blockExtension(plugin)] })
  const pos = (s: EditorState, line: number, ch = 0) => s.doc.line(line + 1).from + ch

  it('keeps an edits=discard block read-only against a person’s typing, and lets the file’s own reload through', () => {
    const s = state()
    const typed = s.update({ changes: { from: pos(s, 4, 2), insert: 'x' }, userEvent: 'input.type' })
    expect(typed.state.doc.toString()).toBe(PAGE)
    const deleted = s.update({ changes: { from: pos(s, 3), to: pos(s, 6) }, userEvent: 'delete.backward' })
    expect(deleted.state.doc.toString()).toBe(PAGE)
    const reload = s.update({ changes: { from: pos(s, 4), to: s.doc.line(5).to, insert: 'A new note.' } })
    expect(reload.state.doc.line(5).text).toBe('A new note.')
    expect(reload.state.field(blocksField).map((b) => b.address)).toEqual(['course-summary:s1', 'course-summary:n1'])
  })
  it('lets a person type in a block a writer owns, and around a read-only one', () => {
    const s = state()
    expect(s.update({ changes: { from: pos(s, 2), insert: 'Edited: ' }, userEvent: 'input.type' }).state.doc.line(3).text).toBe('Edited: The summary.')
    // Right before the read-only block's opening marker, and right after its closing one: outside it.
    expect(s.update({ changes: { from: pos(s, 3), insert: 'before\n' }, userEvent: 'input.type' }).state.doc.line(4).text).toBe('before')
    expect(s.update({ changes: { from: s.doc.line(6).to, insert: '\nafter' }, userEvent: 'input.type' }).state.doc.line(7).text).toBe('after')
    expect(s.update({ changes: { from: pos(s, 7), insert: '!' }, userEvent: 'input.type' }).state.doc.line(8).text).toBe('!My own line.')
  })
  it('says what the owner does to an edit', () => {
    expect(ownerWords({ writer: 'course-summary', discard: false })).toContain('your edit is set aside in _versions/')
    expect(ownerWords({ writer: 'course-summary', discard: true })).toContain('read-only')
  })
})

describe('review: the edges of a read-only block, partial edits, fences and the diff text', () => {
  const plugin = { app: { metadataCache: { getFileCache: () => null } } } as unknown as LlmWikiPlugin
  const state = () => EditorState.create({ doc: PAGE, extensions: [EditorState.allowMultipleSelections.of(true), editorInfoField, blockExtension(plugin)] })
  const line = (s: EditorState, n: number) => s.doc.line(n + 1)
  const type = (s: EditorState, changes: { from: number; to?: number; insert?: string } | { from: number; to?: number; insert?: string }[], userEvent = 'input.type') => s.update({ changes, userEvent }).state

  it('refuses a keystroke onto a marker line or one that joins a marker to its neighbour', () => {
    const s = state()
    // The read-only block is lines 3..5.
    expect(type(s, { from: line(s, 5).to, insert: 'x' }).doc.toString()).toBe(PAGE)
    expect(type(s, { from: line(s, 3).from, insert: 'x' }).doc.toString()).toBe(PAGE)
    expect(type(s, { from: line(s, 5).to, to: line(s, 5).to + 1 }, 'delete.forward').doc.toString()).toBe(PAGE)
    expect(type(s, { from: line(s, 3).from - 1, to: line(s, 3).from }, 'delete.backward').doc.toString()).toBe(PAGE)
    expect(type(s, { from: line(s, 3).from - 1, insert: '!' }).doc.line(3).text).toBe('The summary.!')
  })
  it('keeps the changes outside a read-only block when one of several reaches into it', () => {
    const s = state()
    const out = type(s, [{ from: line(s, 7).from, insert: '> ' }, { from: line(s, 4).from, insert: '> ' }])
    expect(out.doc.line(8).text).toBe('> My own line.')
    expect(out.doc.line(5).text).toBe('A generated note.[^1]')
    const replaced = type(s, [{ from: line(s, 2).from, to: line(s, 2).from + 3, insert: 'A' }, { from: line(s, 4).from, to: line(s, 4).from + 1, insert: 'B' }], 'input.replace.all')
    expect(replaced.doc.line(3).text).toBe('A summary.')
    expect(replaced.doc.line(5).text).toBe('A generated note.[^1]')
  })
  it('lets undo and redo through, so the history never jams', () => {
    const s = state()
    expect(type(s, { from: line(s, 4).from, insert: 'u' }, 'undo').doc.line(5).text).toBe('uA generated note.[^1]')
  })
  it('keeps the parsed blocks on plain typing and parses again when a line or a marker moves', () => {
    let s = state()
    const before = s.field(blocksField)
    s = type(s, { from: line(s, 7).from, insert: 'abc' })
    expect(s.field(blocksField)).toBe(before)
    s = type(s, { from: line(s, 0).to, insert: '\nnew line' })
    expect(s.field(blocksField)).not.toBe(before)
    expect(s.field(blocksField).map((b) => b.first)).toEqual([2, 4])
  })
  it('quoted fences end with the quote and close only in it, as the CLI reads them', () => {
    expect(parseBlocks('> ```\n> code\ntext\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->').map((b) => b.address)).toEqual(['a:1'])
    expect(parseBlocks('```\n> ```\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->')).toEqual([])
    expect(parseBlocks('> ```\n```\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->')).toEqual([])
  })
  it('frontmatter is never body: a fence-looking value opens nothing', () => {
    expect(parseBlocks('---\nnote: |\n  ```\n---\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->').map((b) => [b.address, b.first])).toEqual([['a:1', 4]])
  })
  it('the diff compares the block’s own text, children cut out, as the CLI set it aside', () => {
    const blocks = parseBlocks(PAGE)
    expect(blockText(PAGE, blocks[0]!, blocks)).toBe('The summary.')
    const crlf = '<!-- ops a:1 -->\n\nline one  \n\n<!-- /ops a:1 -->'
    expect(blockText(crlf, parseBlocks(crlf)[0]!)).toBe('line one')
  })
  it('takes the last set-aside entry listed for a block, the one the CLI appended last', () => {
    const blocks = parseBlocks(PAGE)
    const by = setAsideByBlock([{ path: 'b.md', from: 'course-summary:s1', at: '2026-11-07T10:00:00+00:00' }, { path: 'a.md', from: 'course-summary:s1', at: null }], blocks)
    expect(by.get('course-summary:s1')?.path).toBe('a.md')
  })
})

describe('review 2: cursors, frontmatter, and deletes beside a block', () => {
  const plugin = { app: { metadataCache: { getFileCache: () => null } } } as unknown as LlmWikiPlugin
  const make = (doc: string) => EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true), editorInfoField, blockExtension(plugin)] })

  it('each surviving cursor ends after the text it typed, so multi-cursor typing comes out in order', () => {
    let s = make(PAGE)
    const at = [s.doc.line(1).to, s.doc.line(5).from, s.doc.line(8).to]
    s = s.update({ selection: EditorSelection.create(at.map((p) => EditorSelection.cursor(p))) }).state
    for (const ch of 'xyz') s = s.update({ ...s.changeByRange((r) => ({ changes: { from: r.head, insert: ch }, range: EditorSelection.cursor(r.head + 1) })), userEvent: 'input.type' }).state
    expect(s.doc.line(1).text).toBe('# Coursexyz')
    expect(s.doc.line(8).text).toBe('My own line.xyz')
    expect(s.doc.line(5).text).toBe('A generated note.[^1]')
  })
  it('frontmatter is the CLI’s: a bare --- pair, a delimiter with a trailing space, and no reach past its close', () => {
    expect(frontmatterEnd(['---', '---', 'x'])).toBe(1)
    expect(frontmatterEnd(['﻿---', 'k: v', '--- '])).toBe(2)
    expect(frontmatterEnd(['---', 'never closed'])).toBe(-1)
    expect(frontmatterEnd(['text', '---'])).toBe(-1)
    expect(parseBlocks('---\n---\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->\n\n---\nmore').map((b) => b.first)).toEqual([2])
    expect(parseBlocks('---\nk: v\n--- \n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->\n\n---\nmore').map((b) => b.first)).toEqual([3])
  })
  it('parses again when a frontmatter delimiter is completed by one keystroke', () => {
    let s = make('---\nk: v\n<!-- ops a:1 -->\nx\n<!-- /ops a:1 -->\n--')
    expect(s.field(blocksField)).toHaveLength(1)
    s = s.update({ changes: { from: s.doc.length, insert: '-' }, userEvent: 'input.type' }).state
    expect(s.field(blocksField)).toEqual([])
  })
  it('lets a person delete an empty line beside a read-only block, or a whole line above it', () => {
    const doc = 'top\n\n<!-- ops w:n edits=discard -->\ngen\n<!-- /ops w:n -->\n\nend'
    const s = make(doc)
    const open = s.doc.line(3).from
    const close = s.doc.line(5).to
    expect(s.update({ changes: { from: open - 1, to: open }, userEvent: 'delete.forward' }).state.doc.toString()).toBe('top\n<!-- ops w:n edits=discard -->\ngen\n<!-- /ops w:n -->\n\nend')
    expect(s.update({ changes: { from: close, to: close + 1 }, userEvent: 'delete.backward' }).state.doc.toString()).toBe('top\n\n<!-- ops w:n edits=discard -->\ngen\n<!-- /ops w:n -->\nend')
    expect(s.update({ changes: { from: 0, to: s.doc.line(2).from }, userEvent: 'delete.line' }).state.doc.toString()).toBe('\n<!-- ops w:n edits=discard -->\ngen\n<!-- /ops w:n -->\n\nend')
    // Joining a line with text onto a marker is still refused.
    const t = make('top\n<!-- ops w:n edits=discard -->\ngen\n<!-- /ops w:n -->\nend')
    const o = t.doc.line(2).from
    expect(t.update({ changes: { from: o - 1, to: o }, userEvent: 'delete.forward' }).state.doc.toString()).toBe(t.doc.toString())
  })
})

describe('review 3: typing over several selections', () => {
  const plugin = { app: { metadataCache: { getFileCache: () => null } } } as unknown as LlmWikiPlugin
  it('keeps every typed character when one selection lies in a read-only block', () => {
    const doc = 'foo a\n<!-- ops w:n edits=discard -->\nfoo gen\n<!-- /ops w:n -->\nfoo b'
    let s = EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true), editorInfoField, blockExtension(plugin)] })
    const at = [0, s.doc.line(3).from, s.doc.line(5).from]
    s = s.update({ selection: EditorSelection.create(at.map((p) => EditorSelection.range(p, p + 3))) }).state
    for (const ch of 'xy') s = s.update({ ...s.replaceSelection(ch), userEvent: 'input.type' }).state
    expect(s.doc.toString()).toBe('xy a\n<!-- ops w:n edits=discard -->\nfoo gen\n<!-- /ops w:n -->\nxy b')
  })
})
