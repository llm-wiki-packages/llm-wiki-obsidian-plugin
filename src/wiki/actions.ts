// The writes a click asks for, each one verb, each answering one sentence for a Notice.
import type { Cli } from './cli'
import { CliError } from './cli'

export interface Outcome {
  ok: boolean
  message: string
}

function failed(what: string, e: unknown): Outcome {
  const msg = e instanceof CliError ? e.message.replace(/^wiki\.[a-z.]+: /, '') : e instanceof Error ? e.message : String(e)
  return { ok: false, message: `${what}: ${msg}` }
}

interface RequestAnswer {
  outcome?: string
  minted?: boolean
  ticket?: string | null
  error?: string
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
      if (a.outcome === 'queued_already') return { ok: true, message: `${slug} is already queued` }
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

  async reindex(): Promise<Outcome> {
    try {
      await this.cli.run('wiki.search.index', { wiki: this.wiki }, { timeoutMs: 600_000 })
      return { ok: true, message: 'search index refreshed' }
    } catch (e) {
      return failed('reindex', e)
    }
  }
}
