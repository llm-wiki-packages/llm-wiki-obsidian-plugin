// A page's audio as the Listen button reads it, from what ops 0.18.0 wrote on a scratch wiki.
import { describe, expect, it } from 'vitest'
import { CliError, VERBS } from '../src/wiki/cli'
import { clock, hasScript, nextSpeed, pageState, rendersOf, setupCommand, stateOf, trustStale, STALE_GRACE_MS } from '../src/vault/narration'

// `narrate sources/course-bio/syllabus.md mode=read`, as it landed.
const AT = '2026-11-12T22:15:13Z'
const recorded = {
  title: 'Syllabus',
  narrate: {
    render: {
      read: {
        file: 'sources/attachments/audio/sources/course-bio/syllabus.read.mp3',
        by: 'llm-wiki-ops/0.18.0',
        at: AT,
        stage: 'narrate',
        hash: '63b01f6a82cfcb70d340558c6156a600b76178ace734ffd48ca4dc1165b92785',
        voice: 'alba',
        engine: 'pocket-tts',
        transcript: 'sources/attachments/audio/sources/course-bio/syllabus.read.vtt',
      },
      podcast: { error: 'RuntimeError: pocket-tts exited 1', at: AT },
    },
  },
}

// The refusal with no engine declared: the whole error is the command that declares one.
const SETUP = `llm-wiki-ops config set --local '{"engines": {"pocket-tts": {"serves": ["narrate"], "kind": "command", "runs": "host", "command": "pocket-tts"}}, "narrate": {"engines": ["pocket-tts"]}}'`

describe('a page’s audio', () => {
  it('reads each mode’s record, a failed one with its error', () => {
    const [read, podcast] = rendersOf(recorded)
    expect(read).toEqual({ mode: 'read', file: recorded.narrate.render.read.file, transcript: recorded.narrate.render.read.transcript, voice: 'alba', at: AT, error: null })
    expect(podcast).toMatchObject({ mode: 'podcast', file: null, error: 'RuntimeError: pocket-tts exited 1' })
    expect(rendersOf({ title: 'x' })).toEqual([])
  })
  it('does not believe a stale the recording itself caused (llm-wiki-plugins #4721)', () => {
    const at = Date.parse(AT)
    // The narrate write and the sweep after it touch the file within seconds.
    expect(trustStale(AT, at + 5_000)).toBe(false)
    expect(trustStale(AT, at + STALE_GRACE_MS + 1)).toBe(true)
    const [read] = rendersOf(recorded)
    expect(stateOf(read!, 'stale', at + 5_000)).toBe('ready')
    expect(stateOf(read!, 'stale', at + 3_600_000)).toBe('stale')
    expect(stateOf(read!, 'done', at + 3_600_000)).toBe('ready')
  })
  it('shows the worst state on the icon', () => {
    expect(pageState(['ready', 'failed'])).toBe('failed')
    expect(pageState(['ready', 'stale'])).toBe('stale')
    expect(pageState([])).toBe('none')
  })
  it('finds the setup command in the refusal, through the CLI error', () => {
    const e = new CliError(`wiki.narrate: ${SETUP}`, 'exit', 1)
    expect(setupCommand(e.short)).toBe(SETUP)
    expect(setupCommand('wiki.narrate: sources/a.md: RuntimeError: boom')).toBeNull()
  })
  it('runs narrate as a write, and lists the audio read-only', () => {
    expect(VERBS['wiki.narrate']({ wiki: 'w', path: 'sources/a.md', mode: 'read' })).toEqual(['wiki', 'w', 'narrate', 'sources/a.md', 'mode=read', '--json'])
    expect(() => VERBS['wiki.narrate']({ wiki: 'w', path: 'sources/a.md', mode: 'summary' })).toThrow(/bad narrate mode/)
    expect(VERBS['wiki.page.audio']({ wiki: 'w' })).toEqual(['wiki', '--read-only', 'w', 'page', 'list', 'filter=audio:any', '--json'])
  })
  it('knows a page with an episode script, and words the player', () => {
    expect(hasScript('Intro\n\n```webvtt\nWEBVTT\n```\n')).toBe(true)
    expect(hasScript('```vtt\n```')).toBe(false)
    expect(clock(38.4)).toBe('0:38')
    expect(clock(3725)).toBe('1:02:05')
    expect(nextSpeed(1)).toBe(1.25)
    expect(nextSpeed(0.75)).toBe(1)
  })
})
