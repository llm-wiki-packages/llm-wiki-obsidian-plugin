// The writes a click asks for, each one verb, each answering one sentence for a Notice.
import type { Cli } from './cli'
import { CliError } from './cli'

export interface Outcome {
  ok: boolean
  message: string
}

function failed(what: string, e: unknown): Outcome {
  const msg = e instanceof CliError ? e.short : e instanceof Error ? e.message : String(e)
  return { ok: false, message: `${what}: ${msg}` }
}

/** `jobs request`'s answer: `minted: false` means a ticket was already in flight; `ok` means the pass landed before it returned. */
interface RequestAnswer {
  outcome?: 'ok' | 'failed' | 'running'
  minted?: boolean
  ticket?: string | null
  written?: string[]
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
      if (a.outcome === 'ok') return { ok: true, message: `${slug} ran${a.written?.length ? `: ${a.written.length} page${a.written.length === 1 ? '' : 's'} written` : ''}` }
      return { ok: true, message: `${slug} started` }
    } catch (e) {
      return failed(`${slug} did not start`, e)
    }
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

  async retryTicket(id: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.tickets.retry', { wiki: this.wiki, id })
      return { ok: true, message: `ticket ${id} back to pending` }
    } catch (e) {
      return failed(`could not retry ${id}`, e)
    }
  }

  async accept(path: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.page.curate', { wiki: this.wiki, paths: [path] })
      return { ok: true, message: `accepted ${path}` }
    } catch (e) {
      return failed(`could not accept ${path}`, e)
    }
  }

  async reject(path: string, reason: string): Promise<Outcome> {
    try {
      await this.cli.run('wiki.page.curate', { wiki: this.wiki, paths: [path], reason })
      return { ok: true, message: `rejected ${path}` }
    } catch (e) {
      return failed(`could not reject ${path}`, e)
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

  async reindex(): Promise<Outcome> {
    try {
      await this.cli.run('wiki.search.index', { wiki: this.wiki }, { timeoutMs: 600_000 })
      return { ok: true, message: 'search index refreshed' }
    } catch (e) {
      return failed('reindex', e)
    }
  }
}
