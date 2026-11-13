// The Why? panel's words, from `page explain` as ops 0.18.0 answers it on a page that drifted from its root.
import { describe, expect, it } from 'vitest'
import { VERBS } from '../src/wiki/cli'
import { explainLines, keyLines, type ExplainAnswer } from '../src/wiki/explain'

const ROOT = 'sources/course-bio/README.md'

// The person set course to BIO-303 and swapped the lent biology tag for lab.
const drifted: ExplainAnswer = {
  path: 'sources/course-bio/week1/membranes.md',
  chain: [{ root: ROOT, lends: ['tags', 'course', 'instructor'], values: { tags: ['biology', 'course'], course: 'BIO-101', instructor: 'Dr. Lee' } }],
  keys: {
    course: { value: 'BIO-303', own: ['BIO-303'], lent: [], stale: { value: 'BIO-101', removed: ['BIO-303'], from: { 'BIO-101': ROOT }, own: true } },
    instructor: { value: 'Dr. Lee', own: [], lent: [{ item: 'Dr. Lee', from: ROOT }], stale: null },
    tags: { value: ['lab', 'course'], own: ['lab'], lent: [{ item: 'course', from: ROOT }], stale: { added: ['biology'], removed: [], from: { biology: ROOT } } },
  },
  settling: 0,
  fill: 'page lend sources/course-bio/week1/membranes.md',
  record: 'ok',
}

describe('the Why? panel', () => {
  it('runs page explain read-only', () => {
    expect(VERBS['wiki.page.explain']({ wiki: 'w', path: 'sources/a.md' })).toEqual(['wiki', '--read-only', 'w', 'page', 'explain', 'sources/a.md', '--json'])
  })
  it('says a single value the page changed goes back, and that it replaces the page’s own', () => {
    const k = keyLines('course', drifted.keys.course!)
    expect(k).toMatchObject({ value: 'BIO-303', from: [{ what: 'BIO-303', root: null }], next: 'sets BIO-101, replacing BIO-303', replaces: true })
  })
  it('says a removed lent item comes back, and keeps the page’s own items apart', () => {
    const k = keyLines('tags', drifted.keys.tags!)
    expect(k.from).toEqual([{ what: 'course', root: ROOT }, { what: 'lab', root: null }])
    expect(k.next).toBe('puts back biology')
    expect(k.replaces).toBe(false)
  })
  it('says nothing changes for a value that is up to date', () => {
    expect(keyLines('instructor', drifted.keys.instructor!).next).toBeNull()
  })
  it('notes the next write, the settle window and the way out', () => {
    const { notes } = explainLines(drifted)
    expect(notes[0]).toMatch(/^The next write/)
    expect(notes[1]).toMatch(/saved just now/)
    expect(notes[2]).toMatch(/move it out of course-bio\.$/)
    expect(explainLines({ ...drifted, keys: {}, chain: [], settling: null }).notes).toEqual([])
  })
})
