import { describe, expect, it } from 'vitest'
import { Cli, CliError, VERBS, childEnv, question } from '../src/wiki/cli'
import { Actions } from '../src/wiki/actions'

describe('the verb table', () => {
  it('spells a read verb with the floor flag before the selector and --json last', () => {
    expect(VERBS['wiki.doctor']({ wiki: 'kb' })).toEqual(['wiki', '--read-only', 'kb', 'doctor', '--json'])
  })

  it('spells a write verb without the floor flag, and refuses a path that climbs', () => {
    expect(VERBS['wiki.jobs.request']({ wiki: 'kb', slug: 'gmail', wait: 30 })).toEqual(['wiki', 'kb', 'jobs', 'request', 'gmail', 'wait=30s', '--json'])
    expect(VERBS['wiki.page.curate']({ wiki: 'kb', paths: ['sources/web/a.md'], reason: 'not relevant' })).toEqual(['wiki', 'kb', 'page', 'curate', 'sources/web/a.md', 'reject=not relevant', '--json'])
    expect(() => VERBS['wiki.page.curate']({ wiki: 'kb', paths: ['../etc/passwd'] })).toThrow(CliError)
  })

  it('puts the search text after -- so a dash-led query is not a flag', () => {
    const argv = VERBS['wiki.search.query']({ wiki: 'kb', text: '-money model', k: 5 })
    expect(argv.slice(-3)).toEqual(['--json', '--', '-money model'])
    expect(argv).toContain('filter=k:5')
  })

  it('refuses a wiki key that is not a bare slug', () => {
    expect(() => VERBS['wiki.doctor']({ wiki: 'kb; rm -rf /' })).toThrow(CliError)
    expect(() => VERBS['wiki.doctor']({})).toThrow(CliError)
  })

  it('spells harness run with key=value tokens, no floor flag, and the question last', () => {
    const argv = VERBS['wiki.harness.run']({ wiki: 'kb', text: 'what is new?', sandbox: 'read-search', skill: 'llm-wiki:search', model: 'opus' })
    expect(argv).toEqual(['wiki', 'kb', 'harness', 'run', 'sandbox=read-search', 'skill=llm-wiki:search', 'model=opus', '--stream', '--', 'what is new?'])
  })

  it('refuses a dash-led or oversized question', () => {
    expect(() => question('--version')).toThrow(/dash/)
    expect(() => question('x'.repeat(9000))).toThrow(/8192/)
  })
})

describe('the child environment', () => {
  it('sets the read floor on a read verb and clears it on harness run', () => {
    expect(childEnv({ PATH: '/bin' }, 'wiki.doctor').LLM_WIKI_PERMISSIONS).toBe('read')
    expect(childEnv({ PATH: '/bin', LLM_WIKI_PERMISSIONS: 'read' }, 'wiki.harness.run').LLM_WIKI_PERMISSIONS).toBeUndefined()
  })
})

const node = process.execPath

describe('the runner against a stand-in binary', () => {
  it('parses a JSON answer', async () => {
    // The stand-in ignores its argv and prints one object.
    const cli = new Cli({ bin: node, prefix: ['-e', 'process.stdout.write(process.env.FAKE_OUT)'], env: { ...process.env, FAKE_OUT: '{"count":1,"wikis":[{"key":"kb","name":"KB","path":"/tmp/kb"}]}' }, timeoutMs: 5000 })
    const ans = await cli.run<{ count: number }>('machine.wikis.ls')
    expect(ans.count).toBe(1)
  })

  it('reports the envelope error key on a refusal', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'process.stdout.write(process.env.FAKE_OUT); process.exit(2)'], env: { ...process.env, FAKE_OUT: '{"error":"refused","message":"no such wiki"}' }, timeoutMs: 5000 })
    await expect(cli.run('machine.wikis.ls')).rejects.toMatchObject({ kind: 'exit', rc: 2, message: expect.stringContaining('no such wiki') })
  })

  it('streams JSON lines and ends with its own _exit line', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'console.log(JSON.stringify({type:"start"})); console.log("prose"); console.log(JSON.stringify({type:"text",text:"hi"}))'], env: { ...process.env }, timeoutMs: 5000 })
    const seen: string[] = []
    for await (const l of cli.stream('wiki.harness.run', { wiki: 'kb', text: 'q', sandbox: 's', skill: 'a:b' })) seen.push(l.type)
    expect(seen).toEqual(['start', 'text', '_exit'])
  })
})

/** A stand-in CLI that prints one object and exits as told. */
const standIn = (out: string, rc = 0) => new Cli({ bin: node, prefix: ['-e', `process.stdout.write(process.env.FAKE_OUT); process.exit(${rc})`], env: { ...process.env, FAKE_OUT: out }, timeoutMs: 5000 })

describe('Actions.runJob says what the request answered', () => {
  it('ran, with the pages written, when the pass landed before it returned', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":true,"outcome":"ok","written":["sources/mail/a.md","sources/mail/b.md"]}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail ran: 2 pages written' })
  })
  it('already in flight when nothing was minted', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":false,"outcome":"running","ticket":"abc"}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail is already in flight (ticket abc)' })
  })
  it('started when the worker is still going', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":true,"outcome":"running","ticket":"abc"}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail started' })
  })
  it('did not start, with the CLI sentence, on a refusal', async () => {
    expect(await new Actions(standIn('{"error":"gmail: paused — `jobs resume gmail` first"}', 2), 'kb').runJob('gmail')).toEqual({ ok: false, message: 'gmail did not start: gmail: paused — `jobs resume gmail` first' })
  })
})
