// The inbox answers into the model, and the sentences its writes say. The one place that knows
// `inboxes ls`, `inboxes read`, `inboxes done`, `inboxes sweep` and `whereami`'s needs-you field names
// (docs/cli-shapes.md 1.16, 1.24, 2.14).
import { slash } from '../chat/skills'
import type { AttentionItem, BlockedJob, HeldGroup, InboxMessage, NeedsYouParts } from './model'

/** The inbox a person answers; `init` seeds it and `inboxes sweep` closes it out by default. */
export const USER_INBOX = 'user'

/** One row of `inboxes ls <inbox> --all`. */
export interface InboxRow {
  id: string
  subject?: string
  at?: string | null
  state?: string
  done?: boolean
  reply_to?: string | null
  in_reply_to?: string | null
  readable?: boolean
  /** The file, wiki-relative (llm-wiki-plugins #3940); absent from an older CLI. */
  path?: string
  /** The landing ticket that filed it (llm-wiki-plugins #3940); with no `reply_to`, a job ask. */
  ticket?: string | null
  /** The asking job, on a job ask (the ask loop, llm-wiki-plugins #3929); absent from an older CLI. */
  slug?: string | null
}

export interface InboxLsAnswer {
  inbox?: string
  count?: number
  messages?: InboxRow[]
}

/** `inboxes read <inbox> <id>`: the message whole. Booleans arrive as their spelling, `"true"`/`"false"`. */
export interface InboxReadAnswer {
  inbox?: string
  id?: string
  frontmatter?: Record<string, unknown>
  body?: string
}

/** One row of `inboxes sweep`: what became of each message ticked `done`. */
export interface SweptRow {
  id: string
  action: 'forwarded' | 'repeat' | 'removed' | 'refused' | 'kept'
  to: string | null
  reply_id: string | null
  reason: string | null
}

export interface SweptAnswer {
  inbox?: string
  count?: number
  swept?: SweptRow[]
}

/** `inboxes done <inbox> <id>`: what became of that one message. A refusal is an error, not a row. */
export interface ClosedAnswer {
  inbox?: string
  id?: string
  action?: 'forwarded' | 'repeat' | 'removed' | 'kept' | 'archived'
  to?: string | null
  reply_id?: string | null
}

/** The slice of `whereami` the inbox reads. */
export interface NeedsYouAnswer {
  needs_you?: number | null
  needs_you_parts?: NeedsYouParts | null
  blocked?: BlockedJob[] | null
}

export function messageOf(inbox: string, r: InboxRow): InboxMessage {
  return {
    inbox,
    id: r.id,
    path: r.path || messagePath({ inbox, id: r.id }),
    jobAsk: Boolean(r.ticket) && !r.reply_to,
    job: r.ticket && !r.reply_to ? (r.slug ?? null) : null,
    subject: r.subject || r.id,
    at: r.at ?? null,
    seen: typeof r.state === 'string' && r.state !== 'new',
    done: r.done === true,
    replyTo: r.reply_to || null,
    inReplyTo: r.in_reply_to || null,
    readable: r.readable !== false,
  }
}

/** Where an older CLI keeps a message it never renamed: one file per message under its inbox, named by its id. */
export function messagePath(m: Pick<InboxMessage, 'inbox' | 'id'>): string {
  return `inboxes/${m.inbox}/${m.id}.md`
}

/** The rolling copy of the render a landing could not merge into a page: `<dir>/_versions/<stem>.incoming.md` (`OPS/lib/jobs/refresh.py`). */
export function incomingPath(page: string): string {
  const i = page.lastIndexOf('/')
  const dir = i < 0 ? '' : `${page.slice(0, i)}/`
  return `${dir}_versions/${page.slice(i + 1).replace(/\.md$/, '')}.incoming.md`
}

/** The message a vault path is, if it is one the snapshot holds. */
export function messageAt(messages: InboxMessage[] | null, path: string): InboxMessage | undefined {
  return (messages ?? []).find((m) => m.path === path)
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * The held pages under the nearest root above each, the way the bundle levers inherit; a root's own page sits in its
 * own group, and a root holding no held page is left out. Pages under no root share one group, last. `waiting` marks
 * the pages the count waits on.
 */
export function heldGroups(pages: string[], roots: string[], waiting: ReadonlySet<string> = new Set()): HeldGroup[] {
  const rootDirs = roots.map((r) => ({ root: r, dir: dirOf(r) })).sort((a, b) => b.dir.length - a.dir.length)
  const groups = new Map<string | null, string[]>()
  for (const p of pages) {
    const key = rootDirs.find((r) => p.startsWith(`${r.dir}/`))?.root ?? null
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const order = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : dirOf(a) < dirOf(b) ? -1 : dirOf(a) > dirOf(b) ? 1 : 0)
  return [...groups.entries()]
    .sort(([a], [b]) => order(a, b))
    .map(([root, list]) => ({ root, pages: list.sort().map((path) => ({ path, waiting: waiting.has(path) })) }))
}

type Said = { ok: boolean; message: string }

/** What `inboxes done` did, in one sentence. */
export function closedSentence(a: ClosedAnswer, m: Pick<InboxMessage, 'subject'>): Said {
  switch (a.action) {
    case 'forwarded':
      return { ok: true, message: `Replied to “${m.subject}”: your answer went to ${a.to ?? 'its sender'}` }
    case 'repeat':
      return { ok: true, message: `“${m.subject}” was already answered in ${a.to ?? 'its sender'}; closed it` }
    case 'removed':
      return { ok: true, message: `“${m.subject}” is done and removed from the inbox` }
    case 'kept':
      return { ok: true, message: `Answered “${m.subject}”: the job picks it up next run` }
    case 'archived':
      return { ok: true, message: `“${m.subject}” is done; your answer is kept in the inbox's archive` }
    default:
      return { ok: false, message: `“${m.subject}”: the CLI answered no outcome` }
  }
}

/** What the sweep did to the message a person pressed Done on, in one sentence; the others it closed are counted after. */
export function sweptSentence(a: SweptAnswer, m: Pick<InboxMessage, 'id' | 'subject'>): Said {
  const rows = a.swept ?? []
  const mine = rows.find((r) => r.id === m.id)
  const others = rows.filter((r) => r.id !== m.id && r.action !== 'refused' && r.action !== 'kept').length
  const also = others ? ` (and ${others} other answered message${others === 1 ? '' : 's'})` : ''
  if (!mine) return { ok: false, message: `“${m.subject}” was not sent: the sweep did not find it ticked done` }
  if (mine.action === 'refused') return { ok: false, message: `“${m.subject}” stays in the inbox: ${mine.reason ?? 'the sweep refused it'}` }
  const said = closedSentence({ action: mine.action, to: mine.to }, m)
  return { ok: said.ok, message: `${said.message}${also}` }
}

/**
 * What Done will do to this message, in the words a row and its button say. `typed`: an answer is in the body. An
 * older CLI has no `inboxes done` and so no archive for it: there `inboxes rm` deletes what was typed.
 */
export function doneWords(m: Pick<InboxMessage, 'replyTo' | 'job' | 'jobAsk'>, typed = false, inboxDone = true): string {
  if (m.jobAsk) return `Done answers ${m.job ? `job ${m.job}` : 'the job'}: it picks the answer up next run`
  if (m.replyTo) return `Done sends your answer to ${m.replyTo}`
  if (!typed) return 'Done removes it'
  return inboxDone ? 'Done archives your answer' : 'Done deletes your answer: this CLI cannot archive it'
}

/** Whether the body holds more than the CLI last read: an answer typed in, wherever it was typed. */
export function answerTyped(now: string, read: string): boolean {
  return now.trim() !== read.trim()
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** What the inbox counts: messages to answer and the listed parts. Curate's groups are judged on Changes, so they are not. */
export function inboxCount(s: { inbox: InboxMessage[] | null; parts: NeedsYouParts | null; blocked: BlockedJob[]; conflicts: InboxMessage[] | null }): number {
  const open = (s.inbox ?? []).filter((m) => !m.done).length
  if (s.parts) return open + s.parts.held.length + s.parts.conflicts.length + (s.parts.page_conflicts?.length ?? 0) + s.blocked.length
  return open + (s.conflicts?.length ?? 0) + s.blocked.length
}

/** The Overview's rows for the inbox: one for the messages, one for what waits on a judgment. Both open the inbox. */
export function inboxAttention(inbox: InboxMessage[] | null, needsYou: number | null, parts: NeedsYouParts | null = null, blocked: BlockedJob[] = []): AttentionItem[] {
  const out: AttentionItem[] = []
  const open = (inbox ?? []).filter((m) => !m.done)
  if (open.length) {
    const subjects = open.slice(0, 3).map((m) => `“${m.subject}”`).join(', ')
    out.push({
      id: 'inbox:user',
      severity: 'warn',
      title: open.length === 1 ? '1 message waits for your answer' : `${open.length} messages wait for your answer`,
      detail: `${subjects}${open.length > 3 ? ` and ${open.length - 3} more` : ''}`,
      action: { kind: 'goto', tab: 'inbox', label: 'Open inbox' },
    })
  }
  if (needsYou) {
    out.push({
      id: 'inbox:needs-you',
      severity: 'warn',
      title: needsYou === 1 ? '1 thing waits on your judgment' : `${needsYou} things wait on your judgment`,
      detail: judgmentDetail(parts, blocked),
      action: { kind: 'goto', tab: 'inbox', label: 'Open inbox' },
    })
  }
  return out
}

/** The kinds the count holds, named only when there are some; an older CLI lists none, so every kind is named. */
function judgmentDetail(parts: NeedsYouParts | null, blocked: BlockedJob[]): string {
  const ingest = slash('ingest')
  if (!parts) return `Sources held for you, blocked jobs, groups of new pages curate left to you, open conflicts; most are answered with ${ingest}.`
  const kinds = [
    blocked.length ? plural(blocked.length, 'blocked job', 'blocked jobs') : '',
    parts.held.length ? plural(parts.held.length, 'held source', 'held sources') : '',
    parts.conflicts.length ? plural(parts.conflicts.length, 'conflict', 'conflicts') : '',
    parts.page_conflicts?.length ? plural(parts.page_conflicts.length, 'page whose update did not merge', 'pages whose updates did not merge') : '',
    parts.curate.length ? plural(parts.curate.length, 'group of new pages', 'groups of new pages') : '',
  ].filter(Boolean)
  const viaIngest = parts.held.length + parts.conflicts.length > 0
  return `${kinds.join(', ')}${viaIngest ? `; held sources and conflicts are answered with ${ingest}` : ''}.`
}
