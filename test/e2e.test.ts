// Against a real llm-wiki-cli and a scratch wiki: set LLM_WIKI_E2E_BIN and LLM_WIKI_E2E_VAULT, else skipped.
// The sandboxed chat also spends model budget, so it runs only with LLM_WIKI_E2E_SANDBOX naming a read-only sandbox.
import { describe, expect, it } from 'vitest'
import { HarnessRunBackend } from '../src/chat/harnessRun'
import type { ChatEvent, TurnContext } from '../src/chat/types'
import { Cli, type SearchAnswer, type WikiRow } from '../src/wiki/cli'
import { findBinary, matchWiki } from '../src/wiki/resolve'
import { takeSnapshot } from '../src/wiki/snapshot'

const bin = process.env.LLM_WIKI_E2E_BIN
const vault = process.env.LLM_WIKI_E2E_VAULT
const sandbox = process.env.LLM_WIKI_E2E_SANDBOX

describe.skipIf(!bin || !vault)('the seam against a real CLI', () => {
  const cli = () => new Cli({ bin: bin!, env: { ...process.env }, timeoutMs: 30_000 })

  it('finds the binary by its override', async () => {
    expect(await findBinary('llm-wiki-cli', bin)).toBe(bin)
  })

  it('matches the vault to its registered wiki', async () => {
    const rows = await cli().run<{ wikis: WikiRow[] }>('machine.wikis.ls')
    const row = matchWiki(rows.wikis, vault!)
    expect(row?.key).toBe('scratch')
  })

  it('searches under the read floor and gets vault-relative paths back', async () => {
    const ans = await cli().run<SearchAnswer>('wiki.search.query', { wiki: 'scratch', text: 'money model', k: 5 })
    expect(ans.hits?.[0]?.source_path).toBe('wiki/money-models.md')
  })

  it('takes a whole snapshot of a joined wiki', async () => {
    const snap = await takeSnapshot(cli(), 'scratch')
    expect(snap.errors).toEqual({})
    expect(snap.jobs.length).toBeGreaterThan(0)
    expect(snap.jobs.every((j) => j.next.kind !== 'unknown')).toBe(true)
    expect(snap.runner).toBe(false)
    expect(snap.health.count).toBeGreaterThanOrEqual(0)
  }, 30_000)

  it('reads skills, credentials and the job an empty slot keeps from running here', async () => {
    const snap = await takeSnapshot(cli(), 'scratch')
    expect(Object.keys(snap.errors).filter((k) => k.startsWith('wiki.skills') || k.startsWith('wiki.credentials') || k.startsWith('wiki.packages'))).toEqual([])
    const gmail = snap.skills.find((s) => s.name === 'channel-gmail')
    if (!gmail) return
    expect(gmail.state).toBe('enabled')
    expect(gmail.slots.map((x) => x.name)).toContain('file')
    expect(snap.skills.some((s) => s.state === 'available')).toBe(true)
    expect(snap.credentials.map((c) => c.name)).toContain('claude_login')
    const job = snap.jobs.find((j) => j.skill === 'channel-gmail')
    if (job && gmail.slots.some((x) => x.required && !x.credential)) expect(job.next.kind).toBe('unbound')
  }, 30_000)

  it('refuses a harness run on a wiki with no enabled sandbox, through the stream', async () => {
    const types: string[] = []
    let exit: { rc: number | null; stderr: string } | undefined
    for await (const l of cli().stream('wiki.harness.run', { wiki: 'scratch', text: 'hi', sandbox: 'read-search', skill: 'brain:search' })) {
      types.push(l.type)
      if (l.type === '_exit') exit = l as { rc: number | null; stderr: string }
    }
    expect(types.at(-1)).toBe('_exit')
    expect(exit?.rc).not.toBe(0)
  })
})

describe.skipIf(!bin || !vault || !sandbox)('the sandboxed chat against a real CLI', () => {
  const ctx = (signal = new AbortController().signal): TurnContext =>
    ({ wiki: { key: 'scratch', name: 'scratch', root: vault! }, signal, askPermission: () => Promise.resolve({ allow: true }), options: { permissionMode: 'default', readOnly: true, model: 'haiku' } })
  async function turn(backend: HarnessRunBackend, prompt: string, signal?: AbortSignal): Promise<ChatEvent[]> {
    const out: ChatEvent[] = []
    for await (const e of backend.send(prompt, ctx(signal))) out.push(e)
    return out
  }
  const said = (es: ChatEvent[]) => es.map((e) => (e.type === 'text' ? e.text : '')).join('')

  it('keeps one session across turns, and Stop ends the turn, not the session', async () => {
    const backend = new HarnessRunBackend(new Cli({ bin: bin!, env: { ...process.env }, timeoutMs: 30_000 }), { sandbox: sandbox!, idleMinutes: () => 60 })
    try {
      const first = await turn(backend, 'Remember the word PELICAN. Reply only: ok')
      expect(first.find((e) => e.type === 'result')).toMatchObject({ ok: true })
      expect(first.some((e) => e.type === 'context' && typeof e.used === 'number')).toBe(true)

      expect(said(await turn(backend, 'What word did I ask you to remember? One word.'))).toMatch(/PELICAN/i)

      const ac = new AbortController()
      const stopped = turn(backend, 'Write a 2000-word story about a pelican.', ac.signal)
      setTimeout(() => ac.abort(), 4000)
      expect((await stopped).find((e) => e.type === 'result')).toMatchObject({ ok: false, detail: 'interrupted' })

      const after = await turn(backend, 'Reply only: still here')
      expect(after.some((e) => e.type === 'status')).toBe(false)
      expect(said(after)).toMatch(/still here/i)
    } finally {
      backend.close()
    }
  }, 240_000)
})
