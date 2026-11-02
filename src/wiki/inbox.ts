// The inbox answers into the model, and the sentences its writes say. The one place that knows
// `inboxes ls`, `inboxes read` and `inboxes sweep` field names (docs/cli-shapes.md 1.16, 2.8).
import { slash } from '../chat/skills'
import type { AttentionItem, HeldGroup, InboxMessage } from './model'

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
  action: 'forwarded' | 'repeat' | 'removed' | 'refused'
  to: string | null
  reply_id: string | null
  reason: string | null
}

export interface SweptAnswer {
  inbox?: string
  count?: number
  swept?: SweptRow[]
}

export function messageOf(inbox: string, r: InboxRow): InboxMessage {
  return {
    inbox,
    id: r.id,
    subject: r.subject || r.id,
    at: r.at ?? null,
    seen: typeof r.state === 'string' && r.state !== 'new',
    done: r.done === true,
    replyTo: r.reply_to || null,
    inReplyTo: r.in_reply_to || null,
    readable: r.readable !== false,
  }
}

/** Where a message sits in the vault: one file per message under its inbox, named by its id. */
export function messagePath(m: Pick<InboxMessage, 'inbox' | 'id'>): string {
  return `inboxes/${m.inbox}/${m.id}.md`
}

/** The message a vault path is, if it is one the snapshot holds. */
export function messageAt(messages: InboxMessage[] | null, path: string): InboxMessage | undefined {
  return (messages ?? []).find((m) => messagePath(m) === path)
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/**
 * The held pages under the nearest root above each, the way the bundle levers inherit; a root's own page heads its
 * group and is not listed in it. Pages under no root share one group, last.
 */
export function heldGroups(pages: string[], roots: string[]): HeldGroup[] {
  const rootDirs = roots.map((r) => ({ root: r, dir: dirOf(r) })).sort((a, b) => b.dir.length - a.dir.length)
  const groups = new Map<string | null, string[]>(roots.map((r) => [r, []]))
  for (const p of pages) {
    if (roots.includes(p)) continue
    const home = rootDirs.find((r) => p.startsWith(`${r.dir}/`))
    const key = home?.root ?? null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }
  return [...groups.entries()]
    .filter(([root, list]) => root !== null || list.length)
    .map(([root, list]) => ({ root, pages: list.sort() }))
    // By path, a parent's bundle before its children's; the loose pages last.
    .sort((a, b) => (a.root === null ? 1 : b.root === null ? -1 : dirOf(a.root) < dirOf(b.root) ? -1 : 1))
}

/** What the sweep did to the message a person pressed Done on, in one sentence; the others it closed are counted after. */
export function sweptSentence(a: SweptAnswer, m: Pick<InboxMessage, 'id' | 'subject'>): { ok: boolean; message: string } {
  const rows = a.swept ?? []
  const mine = rows.find((r) => r.id === m.id)
  const others = rows.filter((r) => r.id !== m.id && r.action !== 'refused').length
  const also = others ? ` (and ${others} other answered message${others === 1 ? '' : 's'})` : ''
  if (!mine) return { ok: false, message: `“${m.subject}” was not closed out: the sweep did not find it ticked done` }
  switch (mine.action) {
    case 'forwarded':
      return { ok: true, message: `Replied to “${m.subject}”: your answer went to ${mine.to ?? 'its sender'}${also}` }
    case 'repeat':
      return { ok: true, message: `“${m.subject}” was already answered in ${mine.to ?? 'its sender'}; closed it${also}` }
    case 'removed':
      return { ok: true, message: `“${m.subject}” is done${also}` }
    case 'refused':
      return { ok: false, message: `“${m.subject}” stays in the inbox: ${mine.reason ?? 'the sweep refused it'}` }
  }
}

/** The Overview's rows for the inbox: one for the messages, one for what waits on a judgment. Both open the inbox. */
export function inboxAttention(inbox: InboxMessage[] | null, needsYou: number | null): AttentionItem[] {
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
      detail: `Held sources, groups of new pages curate left to you, open conflicts; answered with ${slash('ingest')}.`,
      action: { kind: 'goto', tab: 'inbox', label: 'Open inbox' },
    })
  }
  return out
}
