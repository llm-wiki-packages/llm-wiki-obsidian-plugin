// Against a real llm-wiki-cli and a scratch wiki: set LLM_WIKI_E2E_BIN and LLM_WIKI_E2E_VAULT, else skipped.
import { describe, expect, it } from 'vitest'
import { Cli, type SearchAnswer, type WikiRow } from '../src/wiki/cli'
import { findBinary, matchWiki } from '../src/wiki/resolve'
import { takeSnapshot } from '../src/wiki/snapshot'

const bin = process.env.LLM_WIKI_E2E_BIN
const vault = process.env.LLM_WIKI_E2E_VAULT

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
  })

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
  })

  it('refuses a harness run on a wiki with no enabled sandbox, through the stream', async () => {
    const types: string[] = []
    let exit: { rc: number | null; stderr: string } | undefined
    for await (const l of cli().stream('wiki.harness.run', { wiki: 'scratch', text: 'hi', sandbox: 'read-search', skill: 'llm-wiki:search' })) {
      types.push(l.type)
      if (l.type === '_exit') exit = l as { rc: number | null; stderr: string }
    }
    expect(types.at(-1)).toBe('_exit')
    expect(exit?.rc).not.toBe(0)
  })
})
