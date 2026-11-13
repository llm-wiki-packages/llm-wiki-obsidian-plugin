// Bundle roots read from the metadata cache: which root a value comes from, and how far a root's value reaches.
import { describe, expect, it } from 'vitest'
import { LendIndex, isPage, lendsTitle, lineText, ownPart, rootName, type PageFm } from '../src/vault/lends'

const root: PageFm = {
  path: 'sources/course-bio/README.md',
  fm: { title: 'Biology 101', tags: ['biology', 'course'], course: 'BIO-101', instructor: 'Dr. Lee', ops: { root: true, lends: ['tags', 'course', 'instructor'] } },
}
const lent = { course: 'BIO-101', instructor: 'Dr. Lee', tags: ['biology', 'course'] }
const syllabus: PageFm = { path: 'sources/course-bio/syllabus.md', fm: { course: 'BIO-101', instructor: 'Dr. Lee', tags: ['biology', 'course', 'lab'], ops: { lent } } }
// A sub-root: lends its own course, and its own tag on top of the upper root's.
const sub: PageFm = {
  path: 'sources/course-bio/week2/README.md',
  fm: { course: 'BIO-202', instructor: 'Dr. Lee', tags: ['biology', 'course', 'genetics'], ops: { root: true, lends: ['course', 'tags'], lent } },
}
const deep: PageFm = {
  path: 'sources/course-bio/week2/dna.md',
  fm: { course: 'BIO-202', instructor: 'Dr. Lee', tags: ['genetics', 'biology', 'course'], ops: { lent: { course: 'BIO-202', instructor: 'Dr. Lee', tags: ['genetics', 'biology', 'course'] } } },
}
const drifted: PageFm = { path: 'sources/course-bio/week1/membranes.md', fm: { course: 'BIO-303', instructor: 'Dr. Lee', tags: ['course'], ops: { lent } } }
const outside: PageFm = { path: 'wiki/course-bio/README.md', fm: { ops: { root: true, lends: ['tags'] }, tags: ['x'] } }

const index = new LendIndex([deep, drifted, sub, syllabus, root, outside, { path: 'sources/course-bio/_versions/syllabus.md', fm: {} }])

describe('bundle roots from the metadata cache', () => {
  it('finds the roots above a page, nearest first, and never a root above itself', () => {
    expect(index.chain(deep.path).map((r) => r.path)).toEqual([sub.path, root.path])
    expect(index.chain(sub.path).map((r) => r.path)).toEqual([root.path])
    expect(index.chain(root.path)).toEqual([])
    // Only sources/ and research/ inherit.
    expect(index.chain('wiki/course-bio/page.md')).toEqual([])
  })
  it('reads a sub-root’s own part, less what was lent to it', () => {
    expect(ownPart('tags', sub.fm)).toEqual(['genetics'])
    expect(ownPart('course', sub.fm)).toBe('BIO-202')
    // Not in its lends: it lends nothing of it.
    expect(ownPart('instructor', sub.fm)).toBeUndefined()
  })
  it('names the nearest root lending each value', () => {
    expect(index.lenderOf(deep.path, 'course')).toBe(sub.path)
    expect(index.lenderOf(deep.path, 'instructor')).toBe(root.path)
    expect(index.lenderOf(deep.path, 'tags', 'genetics')).toBe(sub.path)
    expect(index.lenderOf(deep.path, 'tags', 'biology')).toBe(root.path)
  })
  it('counts the pages a value reaches: a list all of them, a single value only where no nearer root wins', () => {
    // syllabus, membranes, the sub-root and dna; the version copy is not a page.
    expect(index.reach(root.path, 'tags')).toBe(4)
    expect(index.reach(root.path, 'instructor')).toBe(4)
    // dna takes the sub-root's course.
    expect(index.reach(root.path, 'course')).toBe(3)
    expect(index.reach(sub.path, 'course')).toBe(1)
  })
  it('marks a root’s lend rows, and a child’s lent rows with their root', () => {
    const r = index.cues(root.path, root.fm)
    expect(r.get('tags')?.lends).toEqual({ reach: 4, folder: 'sources/course-bio' })
    expect(r.get('title')).toBeUndefined()
    const c = index.cues(syllabus.path, syllabus.fm)
    expect(c.get('course')?.lent).toEqual({ from: root.path, items: null })
    // Its own lab tag is not lent.
    expect([...c.get('tags')!.lent!.items!]).toEqual(['biology', 'course'])
    // A sub-root both lends and holds.
    const s = index.cues(sub.path, sub.fm)
    expect(s.get('course')?.lends?.reach).toBe(1)
    expect(s.get('instructor')?.lent?.from).toBe(root.path)
  })
  it('leaves a value the page changed unmarked, and a lent item it removed out of the pills', () => {
    const d = index.cues(drifted.path, drifted.fm)
    expect(d.get('course')).toBeUndefined()
    expect([...d.get('tags')!.lent!.items!]).toEqual(['course'])
  })
  it('says it in a line under Properties', () => {
    expect(lineText(index.summary(root.path, root.fm)!)).toEqual({ lends: 'Lends tags, course, instructor to 4 pages', lent: null })
    const s = index.summary(deep.path, deep.fm)!
    expect(s.from).toEqual([sub.path, root.path])
    expect(lineText(s).lent).toBe('course, instructor, tags from')
    expect(index.summary('sources/other.md', { title: 'x' })).toBeNull()
    expect(index.summary(outside.path, outside.fm)).toBeNull()
  })
  it('words the tooltips and names', () => {
    expect(lendsTitle({ reach: 1, folder: 'sources/a' })).toBe('Lent to 1 page under sources/a. A change here reaches them.')
    expect(rootName(root.path)).toBe('course-bio')
    expect(isPage('sources/a/index.md')).toBe(false)
    expect(isPage('sources/attachments/a.md')).toBe(false)
  })
})
