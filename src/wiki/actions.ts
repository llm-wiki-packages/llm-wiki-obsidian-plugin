// The writes a click asks for, each one verb, each answering one sentence for a Notice.
import type { Cli } from './cli'
import { CliError } from './cli'

export interface Outcome {
  ok: boolean
  message: string
  /** Pages a run wrote, when the CLI said. */
  written?: string[]
}

function failed(what: string, e: unknown): Outcome {
  const msg = e instanceof CliError ? e.short : e instanceof Error ? e.message : String(e)
  return { ok: false, message: `${what}: ${msg}` }
}

/** The settle window's refusal, `OPS/lib/page/settle.py` `refuse_unsettled`: the page and how long ago it moved. */
const SETTLING = /^(.+\.md): edited (\d+)s ago; retry after the settle window/

export function settlingOf(e: unknown): { path: string; age: number } | null {
  const said = e instanceof CliError ? (e.body as { message?: unknown } | undefined)?.message : undefined
  const m = typeof said === 'string' ? SETTLING.exec(said) : null
  return m ? { path: m[1]!, age: Number(m[2]) } : null
}

/**
 * A judgment the settle window held, in a person's words. The window keeps the
 * pipeline off a page someone is typing in; the plugin's clicks run under the
 * `editor` origin, which lifts it, so only a CLI from before llm-wiki-plugins
 * #3687 answers this. Named pages are judged all or nothing, so one held page
 * holds the lot.
 */
function held(verb: 'accept' | 'archive', paths: string[], e: unknown): Outcome {
  const s = settlingOf(e)
  if (!s) return failed(paths.length === 1 ? `could not ${verb} ${paths[0]}` : `could not ${verb}`, e)
  const ago = s.age < 60 ? 'moments ago' : `${Math.round(s.age / 60)} min ago`
  const what = paths.length === 1 ? 'Nothing changed' : `None of the ${paths.length} pages changed`
  return { ok: false, message: `${s.path} was edited ${ago}, and the wiki waits a few minutes after an edit before it can ${verb} a page. ${what}; try again shortly.` }
}

/** `jobs request`'s answer: `minted: false` means a ticket was already in flight; `ok` means the pass landed before it returned. */
interface RequestAnswer {
  outcome?: 'ok' | 'failed' | 'running'
  minted?: boolean
  ticket?: string | null
  written?: string[]
  error?: string | null
}

export class Actions {
  constructor(
    private readonly cli: Cli,
    private readonly wiki: string,
  ) {}

  /** Lease, mint and start one job's pass now. The row's state is read back from the tickets, not from this answer. */
  async runJob(slug: string): Promise<Outcome> {
    try {
      const a = await this.cli.run<RequestAnswer>('wiki.jobs.request', { wiki: this.wiki, slug }, { timeoutMs: 120_000 })
      if (a.minted === false) return { ok: true, message: `${slug} is already in flight${a.ticket ? ` (ticket ${a.ticket})` : ''}` }
      if (a.outcome === 'ok') return { ok: true, message: `${slug} ran${a.written?.length ? `: ${a.written.length} page${a.written.length === 1 ? '' : 's'} written` : ''}`, written: a.written ?? [] }
      return { ok: true, message: `${slug} started` }
    } catch (e) {
      // A non-zero exit with an answer is a run that ran: it stopped, or it is still going. Only a refusal "did not start".
      const body = e instanceof CliError ? (e.body as RequestAnswer | undefined) : undefined
      if (body?.outcome === 'failed') return { ok: false, message: `${slug} ran and stopped${body.error ? `: ${body.error}` : ''}` }
      if (body?.outcome === 'running') return { ok: true, message: `${slug} started; still running` }
      return failed(`${slug} did not start`, e)
    }
  }

  /** Put a stopped ticket back and run the pass now, since without a runner nothing else would pick it up. */
  async retryAndRun(ticket: string, slug: string): Promise<Outcome> {
    const back = await this.retryTicket(ticket)
    if (!back.ok || back.landed) return back
    return this.runJob(slug)
  }

  async pauseJob(slug: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.jobs.pause', { wiki: this.wiki, slug })
      return { ok: true, message: `${slug} paused` }
    } catch (e) {
      return failed(`could not pause ${slug}`, e)
    }
  }

  async resumeJob(slug: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.jobs.resume', { wiki: this.wiki, slug })
      return { ok: true, message: `${slug} resumed` }
    } catch (e) {
      return failed(`could not resume ${slug}`, e)
    }
  }

  /** Back to pending, or the truth that it had already landed and there is nothing to retry. */
  async retryTicket(id: string): Promise<Outcome & { landed?: boolean }> {
    try {
      const a = await this.cli.run<{ already_landed?: boolean }>('wiki.tickets.retry', { wiki: this.wiki, id })
      if (a.already_landed) return { ok: true, message: `ticket ${id} had already landed; nothing to retry`, landed: true }
      return { ok: true, message: `ticket ${id} back to pending` }
    } catch (e) {
      return failed(`could not retry ${id}`, e)
    }
  }

  /** One call for the lot: `page curate` takes many paths and judges them together. */
  async accept(paths: string[]): Promise<Outcome> {
    try {
      await this.cli.run('wiki.page.curate', { wiki: this.wiki, paths })
      return { ok: true, message: paths.length === 1 ? `accepted ${paths[0]}` : `accepted ${paths.length} pages` }
    } catch (e) {
      return held('accept', paths, e)
    }
  }

  /** Several writes against one wiki go one after another; two writers at once can trip a lock. */
  async each(slugs: string[], one: (slug: string) => Promise<Outcome>, did: string): Promise<Outcome> {
    const outs: Outcome[] = []
    for (const s of slugs) outs.push(await one(s))
    const bad = outs.filter((o) => !o.ok)
    return bad.length ? { ok: false, message: `${did} ${outs.length - bad.length} of ${outs.length}: ${bad[0]?.message ?? ''}` } : { ok: true, message: `${did} ${outs.length}` }
  }

  /** Archive with a reason: `page curate reject=` ticks `Archive` and stamps why. */
  async reject(paths: string | string[], reason: string): Promise<Outcome> {
    const list = typeof paths === 'string' ? [paths] : paths
    try {
      await this.cli.run('wiki.page.curate', { wiki: this.wiki, paths: list, reason })
      return { ok: true, message: list.length === 1 ? `archived ${list[0]}` : `archived ${list.length} pages` }
    } catch (e) {
      return held('archive', list, e)
    }
  }

  async adopt(paths: string[]): Promise<Outcome> {
    try {
      await this.cli.run('wiki.page.adopt', { wiki: this.wiki, paths })
      return { ok: true, message: paths.length === 1 ? `adopted ${paths[0]}` : `adopted ${paths.length} pages` }
    } catch (e) {
      return failed('could not adopt', e)
    }
  }

  /**
   * A copy Obsidian just made carries its original's `document_id`: give the copy one of its own. The CLI picks the
   * newer page by git and refuses the original by name, so a wrong guess here writes nothing.
   */
  async fixCopy(path: string): Promise<Outcome & { reminted: boolean }> {
    try {
      const a = await this.cli.run<FixAnswer>('wiki.page.fix', { wiki: this.wiki, paths: [path], force: true })
      const row = a.pages?.find((p) => p.path === path)
      if (row?.actions?.includes('reminted')) return { ok: true, reminted: true, message: `${path} is a copy, so it has its own identity now, as a new page` }
      return { ok: true, reminted: false, message: row?.note ?? `${path} needed no repair` }
    } catch (e) {
      return { ...failed(`could not give ${path} its own identity`, e), reminted: false }
    }
  }

  /** Store a secret (on stdin) or adopt a folder, then bind it where asked. The value is never echoed, not even in the Notice. */
  async setCredential(name: string, value: { kind: 'value'; secret: string } | { kind: 'dir'; dir: string }, bindTo: { skill?: string; job?: string; slot: string }[]): Promise<Outcome> {
    try {
      if (value.kind === 'value') await this.cli.run('wiki.credentials.set', { wiki: this.wiki, name, kind: 'value' }, { stdin: value.secret })
      else await this.cli.run('wiki.credentials.set', { wiki: this.wiki, name, kind: 'dir', dir: value.dir })
    } catch (e) {
      return failed(`could not save ${name}`, e)
    }
    const bound: string[] = []
    for (const b of bindTo) {
      const out = await this.bindCredential(name, b)
      if (!out.ok) return { ok: false, message: `${name} saved, but ${out.message}` }
      bound.push(b.job ?? b.skill ?? '')
    }
    return { ok: true, message: bound.length ? `${name} saved and bound to ${bound.join(', ')}` : `${name} saved` }
  }

  async bindCredential(name: string, to: { skill?: string; job?: string; slot: string }): Promise<Outcome> {
    try {
      await this.cli.run('wiki.credentials.bind', to.job ? { wiki: this.wiki, subject: 'job', slug: to.job, slot: to.slot, credential: name } : { wiki: this.wiki, subject: 'skill', name: to.skill, slot: to.slot, credential: name })
      return { ok: true, message: `${name} bound to ${to.job ?? to.skill ?? ''}` }
    } catch (e) {
      return failed(`could not bind ${name} to ${to.job ?? to.skill ?? ''}`, e)
    }
  }

  /** Renew by the credential's declared login; a browser login opens on this machine. */
  async loginCredential(name: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.credentials.login', { wiki: this.wiki, name }, { timeoutMs: 600_000 })
      return { ok: true, message: `${name} renewed` }
    } catch (e) {
      return failed(`could not renew ${name}`, e)
    }
  }

  async removeCredential(name: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.credentials.remove', { wiki: this.wiki, name })
      return { ok: true, message: `${name} removed` }
    } catch (e) {
      return failed(`could not remove ${name}`, e)
    }
  }

  /** The sweep: commit every uncommitted change, attributed by author. Pages edited inside the settle window wait for the next one. */
  async commit(): Promise<Outcome & { settling: string[]; commits: number }> {
    try {
      const a = await this.cli.run<CommitAnswer>('wiki.git.commit', { wiki: this.wiki }, { timeoutMs: 120_000 })
      const commits = a.commits?.length ?? 0
      const settling = a.settling ?? []
      const wait = settling.length ? `; ${plural(settling.length, 'page')} still being edited, saved later` : ''
      return { ok: true, message: commits ? `saved to history${wait}` : `nothing new to save${wait}`, settling, commits }
    } catch (e) {
      return { ...failed('could not save to history', e), settling: [], commits: 0 }
    }
  }

  /** Pull with rebase, then push. A dirty tree defers the pull, which the note says. */
  async sync(): Promise<Outcome> {
    try {
      const a = await this.cli.run<SyncAnswer>('wiki.git.sync', { wiki: this.wiki }, { timeoutMs: 180_000 })
      const did = [a.pulled ? 'pulled' : '', a.pushed ? 'pushed' : ''].filter(Boolean).join(' and ')
      return { ok: a.pulled || a.pushed || !a.note, message: did ? `synced: ${did}` : `not synced: ${a.note || 'nothing to do'}` }
    } catch (e) {
      return failed('could not sync', e)
    }
  }

  /** The additive pass: offer what moved since the last one. A `partial` pass exits 1 with its answer. */
  async index(): Promise<Outcome> {
    try {
      return indexed(await this.cli.run<IndexAnswer>('wiki.search.index', { wiki: this.wiki }, { timeoutMs: 600_000 }))
    } catch (e) {
      const body = e instanceof CliError ? (e.body as IndexAnswer | undefined) : undefined
      return body?.status ? indexed(body) : failed('could not update the index', e)
    }
  }

  /** The full pass: every file offered, then the engine drops what the corpus no longer holds. */
  async reindex(): Promise<Outcome> {
    try {
      return reindexed(await this.cli.run<ReindexAnswer>('wiki.search.reindex', { wiki: this.wiki }, { timeoutMs: 3_600_000 }))
    } catch (e) {
      const body = e instanceof CliError ? (e.body as ReindexAnswer | undefined) : undefined
      return body?.status ? reindexed(body) : failed('could not rebuild the index', e)
    }
  }
}

/** `git commit`'s answer, `OPS/lib/git/commit.py` `Committed`. */
interface CommitAnswer {
  commits?: object[]
  settling?: string[]
}

/** `page fix`'s answer, `OPS/commands/page/fix.py`: per page what was done, or why not (`needs_force`, `older_copy`). */
interface FixAnswer {
  pages?: { path: string; actions?: string[]; skipped?: string | null; note?: string | null }[]
}

/** `git sync`'s answer, `OPS/lib/git/sync.py` `Synced`. */
interface SyncAnswer {
  pulled?: boolean
  pushed?: boolean
  note?: string
}

/** `search index`'s answer, `OPS/search/index.py`. */
interface IndexAnswer {
  status?: 'no_index' | 'synced' | 'partial' | 'unavailable' | 'deferred'
  scanned?: number
  indexed?: number | null
  unchanged?: number
  failed?: string[]
  skipped?: string[]
  conflicts?: string[]
  note?: string | null
}

/** `search reindex`'s answer, `OPS/search/reconcile.py`: the counts sit in `report`. */
interface ReindexAnswer {
  status?: IndexAnswer['status']
  report?: { indexed?: number; unchanged?: number; deleted?: string[]; failed?: string[]; refused?: string[]; conflicts?: string[] } | null
  note?: string | null
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The sentence a pass earns: what it did, or why it did not. */
function passOutcome(status: IndexAnswer['status'], did: string, refused: number, note: string | null | undefined): Outcome {
  switch (status) {
    case 'synced':
      return { ok: true, message: did }
    case 'no_index':
      return { ok: true, message: note || 'this wiki answers from grep, which needs no index' }
    case 'deferred':
      return { ok: false, message: 'another index pass is running; try again when it finishes' }
    case 'partial':
      return { ok: false, message: `${did}, but ${plural(refused, 'file')} did not go in${note ? `: ${note}` : ''}` }
    default:
      return { ok: false, message: `the search engine is unavailable${note ? `: ${note}` : ''}` }
  }
}

function indexed(a: IndexAnswer): Outcome {
  const refused = (a.failed?.length ?? 0) + (a.skipped?.length ?? 0) + (a.conflicts?.length ?? 0)
  const did = a.indexed ? `search index updated: ${plural(a.indexed, 'file')} indexed` : 'search index already up to date'
  return passOutcome(a.status, did, refused, a.note)
}

function reindexed(a: ReindexAnswer): Outcome {
  const r = a.report ?? {}
  const refused = (r.failed?.length ?? 0) + (r.refused?.length ?? 0) + (r.conflicts?.length ?? 0)
  const removed = r.deleted?.length ?? 0
  const did = `search index rebuilt: ${plural((r.indexed ?? 0) + (r.unchanged ?? 0), 'file')}${removed ? `, ${plural(removed, 'missing page')} removed` : ''}`
  return passOutcome(a.status, did, refused, a.note)
}
