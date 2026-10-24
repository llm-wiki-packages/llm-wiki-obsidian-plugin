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
  it('leaves skill= off harness run when the prompt carries it', () => {
    const argv = VERBS['wiki.harness.run']({ wiki: 'kb', text: '/llm-wiki:search new?', sandbox: 'read-search', effort: 'high' })
    expect(argv).toEqual(['wiki', 'kb', 'harness', 'run', 'sandbox=read-search', 'effort=high', '--stream', '--', '/llm-wiki:search new?'])
  })

  it('spells the skills, packages and credentials verbs, with the secret nowhere in argv', () => {
    expect(VERBS['wiki.skills.show']({ wiki: 'kb', name: 'channel-gmail' })).toEqual(['wiki', '--read-only', 'kb', 'skills', 'ls', 'channel-gmail', '--json'])
    expect(VERBS['wiki.packages.show']({ wiki: 'kb', name: 'llm-wiki-packages/llm-wiki-skills' })).toEqual(['wiki', '--read-only', 'kb', 'packages', 'show', 'llm-wiki-packages/llm-wiki-skills', '--json'])
    expect(VERBS['wiki.credentials.set']({ wiki: 'kb', name: 'gmail-token', kind: 'value' })).toEqual(['wiki', 'kb', 'credentials', 'set', 'gmail-token', 'kind=value', '--json'])
    expect(VERBS['wiki.credentials.set']({ wiki: 'kb', name: 'yt-cookies', kind: 'dir', dir: '/Users/me/cookies' })).toEqual(['wiki', 'kb', 'credentials', 'set', 'yt-cookies', 'kind=dir', 'path=/Users/me/cookies', '--json'])
    expect(VERBS['wiki.credentials.bind']({ wiki: 'kb', subject: 'skill', name: 'channel-gmail', slot: 'file', credential: 'gmail-token' })).toEqual(['wiki', 'kb', 'credentials', 'bind', 'skill', 'channel-gmail', 'file=gmail-token', '--json'])
    expect(VERBS['wiki.credentials.bind']({ wiki: 'kb', subject: 'job', slug: 'inbox-joe', slot: 'env.API_KEY', credential: 'gmail-token' })).toEqual(['wiki', 'kb', 'credentials', 'bind', 'job', 'inbox-joe', 'env.API_KEY=gmail-token', '--json'])
    expect(() => VERBS['wiki.credentials.set']({ wiki: 'kb', name: 'a b' })).toThrow(CliError)
    expect(() => VERBS['wiki.credentials.set']({ wiki: 'kb', name: 'x', kind: 'dir', dir: 'relative' })).toThrow(CliError)
    expect(() => VERBS['wiki.credentials.bind']({ wiki: 'kb', subject: 'skill', name: 'u', slot: 'file=x', credential: 'c' })).toThrow(CliError)
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
  it('marks only a credential write as attended, and strips an inherited mark from everything else', () => {
    expect(childEnv({ PATH: '/bin' }, 'wiki.credentials.set').LLM_WIKI_SESSION_ATTENDED).toBe('1')
    expect(childEnv({ PATH: '/bin', LLM_WIKI_SESSION_ATTENDED: '1' }, 'wiki.jobs.request').LLM_WIKI_SESSION_ATTENDED).toBeUndefined()
    expect(childEnv({ PATH: '/bin', LLM_WIKI_SESSION_ATTENDED: '1' }, 'wiki.doctor').LLM_WIKI_SESSION_ATTENDED).toBeUndefined()
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

  it('hands stdin to the child and closes it', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'let b="";process.stdin.on("data",d=>b+=d).on("end",()=>process.stdout.write(JSON.stringify({got:b})))'], env: process.env, timeoutMs: 5000 })
    expect(await cli.run('wiki.credentials.set', { wiki: 'kb', name: 'x' }, { stdin: 's3cret' })).toEqual({ got: 's3cret' })
    expect(await cli.run('wiki.doctor', { wiki: 'kb' })).toEqual({ got: '' })
  })

  it('streams JSON lines and ends with its own _exit line', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'console.log(JSON.stringify({type:"start"})); console.log("prose"); console.log(JSON.stringify({type:"text",text:"hi"}))'], env: { ...process.env }, timeoutMs: 5000 })
    const seen: string[] = []
    for await (const l of cli.stream('wiki.harness.run', { wiki: 'kb', text: 'q', sandbox: 's', skill: 'a:b' })) seen.push(l.type)
    expect(seen).toEqual(['start', 'text', '_exit'])
  })

  it('spells --conversation right after --stream', () => {
    const argv = VERBS['wiki.harness.run']({ wiki: 'kb', text: 'hi', sandbox: 'read-search', conversation: true })
    expect(argv).toEqual(['wiki', 'kb', 'harness', 'run', 'sandbox=read-search', '--stream', '--conversation', '--', 'hi'])
  })

  it('keeps stdin open for lines until closed, then ends with _exit', async () => {
    const echo = 'let b="";process.stdin.on("data",d=>{b+=d;for(let i=b.indexOf("\\n");i>=0;i=b.indexOf("\\n")){console.log(JSON.stringify({type:"echo",line:JSON.parse(b.slice(0,i))}));b=b.slice(i+1)}}).on("end",()=>process.exit(0))'
    const cli = new Cli({ bin: node, prefix: ['-e', echo], env: { ...process.env }, timeoutMs: 5000 })
    const conv = cli.conversation('wiki.harness.run', { wiki: 'kb', text: 'q', sandbox: 's', conversation: true })
    const it = conv.lines[Symbol.asyncIterator]()
    conv.write({ type: 'turn', text: 'one' })
    expect((await it.next()).value).toEqual({ type: 'echo', line: { type: 'turn', text: 'one' } })
    conv.write({ type: 'interrupt' })
    expect((await it.next()).value).toEqual({ type: 'echo', line: { type: 'interrupt' } })
    expect(conv.exited).toBe(false)
    conv.close()
    const last = (await it.next()).value as { type: string; rc: number }
    expect(last).toMatchObject({ type: '_exit', rc: 0 })
    expect(conv.exited).toBe(true)
  })

  it('kills a conversation child when its signal aborts', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'setInterval(()=>{},1000)'], env: { ...process.env }, timeoutMs: 5000 })
    const ac = new AbortController()
    const conv = cli.conversation('wiki.harness.run', { wiki: 'kb', text: 'q', sandbox: 's' }, { signal: ac.signal })
    const it = conv.lines[Symbol.asyncIterator]()
    ac.abort()
    expect((await it.next()).value).toMatchObject({ type: '_exit' })
  })
})

/** A stand-in CLI that prints one object and exits as told. */
const standIn = (out: string, rc = 0) => new Cli({ bin: node, prefix: ['-e', `process.stdout.write(process.env.FAKE_OUT); process.exit(${rc})`], env: { ...process.env, FAKE_OUT: out }, timeoutMs: 5000 })

describe('Actions.runJob says what the request answered', () => {
  it('ran, with the pages written, when the pass landed before it returned', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":true,"outcome":"ok","written":["sources/mail/a.md","sources/mail/b.md"]}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail ran: 2 pages written', written: ['sources/mail/a.md', 'sources/mail/b.md'] })
  })
  it('accept takes every path in one call, and each() runs writes one after another', async () => {
    const a = new Actions(standIn('{"pages":[],"count":2}'), 'kb')
    expect(await a.accept(['sources/a.md', 'sources/b.md'])).toEqual({ ok: true, message: 'accepted 2 pages' })
    const order: string[] = []
    expect(await a.each(['x', 'y'], async (s) => { order.push(s); return { ok: s === 'x', message: s } }, 'started')).toEqual({ ok: false, message: 'started 1 of 2: y' })
    expect(order).toEqual(['x', 'y'])
  })
  it('a run can be cancelled through its signal', async () => {
    const cli = new Cli({ bin: node, prefix: ['-e', 'setTimeout(()=>process.stdout.write("{}"), 2000)'], env: process.env, timeoutMs: 5000 })
    const ac = new AbortController()
    const p = cli.run('wiki.doctor', { wiki: 'kb' }, { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toThrow(/cancelled/)
  })
  it('retryAndRun puts the ticket back and then runs the pass, stopping at a refused retry', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":true,"outcome":"running","ticket":"t2"}'), 'kb').retryAndRun('t1', 'gmail')).toEqual({ ok: true, message: 'gmail started' })
    expect((await new Actions(standIn('{"error":"no ticket t1"}', 2), 'kb').retryAndRun('t1', 'gmail')).ok).toBe(false)
  })
  it('already in flight when nothing was minted', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":false,"outcome":"running","ticket":"abc"}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail is already in flight (ticket abc)' })
  })
  it('started when the worker is still going', async () => {
    expect(await new Actions(standIn('{"slug":"gmail","minted":true,"outcome":"running","ticket":"abc"}'), 'kb').runJob('gmail')).toEqual({ ok: true, message: 'gmail started' })
  })
  it('ran and stopped when the pass failed, started when it is still going, and only a refusal did not start', async () => {
    expect(await new Actions(standIn('{"slug":"yt","minted":true,"outcome":"failed","error":"cookies expired","written":[]}', 1), 'kb').runJob('yt')).toEqual({ ok: false, message: 'yt ran and stopped: cookies expired' })
    expect(await new Actions(standIn('{"slug":"yt","minted":true,"outcome":"running","ticket":"t","written":[]}', 1), 'kb').runJob('yt')).toEqual({ ok: true, message: 'yt started; still running' })
  })
  it('says when a retried ticket had already landed, and does not run the pass for it', async () => {
    const a = new Actions(standIn('{"item":"t1","queue":"harvest","already_landed":true}'), 'kb')
    expect(await a.retryTicket('t1')).toMatchObject({ ok: true, landed: true })
    expect((await a.retryAndRun('t1', 'yt')).message).toMatch(/already landed/)
  })
  it('did not start, with the CLI sentence, on a refusal', async () => {
    expect(await new Actions(standIn('{"error":"gmail: paused — `jobs resume gmail` first"}', 2), 'kb').runJob('gmail')).toEqual({ ok: false, message: 'gmail did not start: gmail: paused — `jobs resume gmail` first' })
  })
})
