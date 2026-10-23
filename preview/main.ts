// Renders the dashboard and chat with fixture data in a browser, for screenshots. Not shipped.
/* eslint-disable */
import { App, WorkspaceLeaf } from 'obsidian'
import { DashboardView, type Tab } from '../src/views/dashboard/index'
import { ChatView } from '../src/views/chat'
import { SearchView } from '../src/views/search'
import type { Snapshot } from '../src/wiki/model'
import { openCredentialModal } from '../src/ui/credentialModal'
import { openSkillModal } from '../src/ui/skillModal'

const NOW = Date.now()
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const ahead = (min: number) => new Date(NOW + min * 60_000).toISOString()

const snapshot: Snapshot = {
  takenAt: NOW,
  wikiKey: 'notes',
  health: { tone: 'warn', count: 2 },
  attention: [
    { id: 'unbound:inbox-joe', severity: 'warn', title: 'Joe’s mailbox cannot run on this machine', detail: 'channel-gmail needs a credential for file', action: { kind: 'credential', skill: 'channel-gmail', slot: 'file' } },
    { id: 'parked:t9', severity: 'warn', title: 'YouTube subscriptions harvest stopped: cookies expired', detail: 'ticket t9', action: { kind: 'retry', ticket: 't9' } },
    { id: 'outdated:web-page', severity: 'info', title: 'A newer web-page is in its package', action: { kind: 'ask', prompt: '/llm-wiki:enable web-page', label: 'Update' } },
  ],
  runner: true,
  jobs: [
    { slug: 'inbox-joe', name: 'Joe’s mailbox', kind: 'pipeline', skill: 'channel-gmail', schedule: 'every 1d', paused: false, last: { at: null, outcome: null }, next: { kind: 'unbound', detail: 'channel-gmail needs a credential for file' }, running: null },
    { slug: 'yt-subs', name: 'YouTube subscriptions', kind: 'pipeline', skill: 'channel-youtube', schedule: 'every 6h', paused: false, last: { at: ago(400), outcome: 'failed' }, next: { kind: 'due', detail: 'overdue' }, running: null },
    { slug: 'ops-hourly', name: 'Curate what the pipeline landed', kind: 'routines', skill: null, schedule: 'every 1h', paused: false, last: { at: ago(20), outcome: 'ok' }, next: { kind: 'running', detail: 'curating' }, running: { ticket: 't12', stage: 'llm-wiki:curate', since: ago(3) } },
    { slug: 'blog-acme', name: 'Acme engineering blog', kind: 'pipeline', skill: 'web-page', schedule: 'every 1d', paused: false, last: { at: ago(900), outcome: 'ok' }, next: { kind: 'at', at: ahead(540) }, running: null },
    { slug: 'ops-nightly', name: 'Dream: merge what was curated', kind: 'routines', skill: null, schedule: 'every 1d · 02:00-05:00', paused: false, last: { at: ago(1300), outcome: 'ok' }, next: { kind: 'at', at: ahead(700) }, running: null },
    { slug: 'ops-denials', name: 'Review denial rows', kind: 'routines', skill: null, schedule: 'every 1d', paused: true, last: { at: null, outcome: null }, next: { kind: 'paused' }, running: null },
  ],
  skills: [
    { name: 'channel-gmail', state: 'enabled', venue: 'gmail', version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/channel-gmail ticket=<id>', drifted: false, outdated: false, warnings: [], slots: [{ name: 'file', required: true, credential: null }], jobs: ['inbox-joe'], inputs: [{ name: 'mailbox', prompt: 'Which mailbox does this watch pull?', required: true }], notes: { skill: 'SKILL.md', enable: 'references/enable.md', usage: 'references/usage.md' }, dir: '.llm-wiki/skills/channel-gmail' },
    { name: 'channel-youtube', state: 'enabled', venue: 'youtube', version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/channel-youtube ticket=<id>', drifted: false, outdated: false, warnings: [], slots: [{ name: 'dir', required: false, credential: 'yt-cookies', problem: 'stale' }], jobs: ['yt-subs'], inputs: [], notes: { skill: 'SKILL.md', enable: 'references/enable.md' }, dir: '.llm-wiki/skills/channel-youtube' },
    { name: 'web-page', state: 'enabled', venue: 'web', version: '0.2.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/web-page url=<url>', drifted: false, outdated: true, warnings: [], slots: [], jobs: ['blog-acme'], inputs: [], notes: { skill: 'SKILL.md' }, dir: '.llm-wiki/skills/web-page' },
    { name: 'daily-report', state: 'installed', venue: null, version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir: '.llm-wiki/skills/daily-report' },
    ...['channel-circle', 'channel-github', 'channel-notion-tasks', 'channel-spotify', 'channel-substack', 'channel-frameio'].map((name) => ({ name, state: 'available' as const, venue: null, version: null, from: 'llm-wiki-packages/llm-wiki-skills@0.5.0', usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir: null })),
  ],
  credentials: [
    { name: 'claude_login', kind: 'harness', state: 'verified', verified: ago(60), uses: [] },
    { name: 'yt-cookies', kind: 'dir', state: 'unverified', verified: null, uses: [{ skill: 'channel-youtube', slot: 'dir', problem: 'stale' }] },
    { name: 'gh-token', kind: 'value', state: 'failed', verified: ago(3000), uses: [] },
  ],
  curation: [
    { path: 'sources/web/acme/postgres-at-scale.md', title: 'postgres-at-scale', job: 'web/acme' },
    { path: 'sources/web/acme/on-call-rotations.md', title: 'on-call-rotations', job: 'web/acme' },
  ],
  unadopted: [{ path: 'sources/notes/meeting-2026-10-21.md', title: 'meeting-2026-10-21', job: 'notes' }],
  recent: [
    { op: 'pass', outcome: 'ok', at: ago(20), summary: '' },
    { op: 'harvest yt-subs', outcome: 'failed', at: ago(400), summary: 'cookies expired' },
    { op: 'pass', outcome: 'ok', at: ago(80), summary: '2 pages written' },
  ],
  errors: {},
}

const app = new App()
const plugin: any = {
  app,
  settings: { defaultChatMode: 'agent', searchK: 20 },
  wiki: { key: 'notes', name: 'Notes', root: '/tmp/obs-scratch/wiki' },
  snapshot,
  problem: null,
  actions: new Proxy({}, { get: (_t, verb) => (...args: unknown[]) => { console.log('action', verb, args); return Promise.resolve({ ok: true, message: `${String(verb)} ok` }) } }),
  refreshSnapshot: () => Promise.resolve(),
  openChat: (text?: string) => { console.log('chat', text); chat.prefill(text ?? ''); return Promise.resolve() },
  addJob: () => console.log('add job'),
  pickSkill: () => console.log('pick skill'),
  credentialModal: (p: unknown) => openCredentialModal(app, snapshot, plugin.actions, p as any, async () => {}),
  backend: () => Promise.reject(new Error('no backend in the preview')),
}

const main = document.getElementById('main')!
const side = document.getElementById('side')!
const leaf = new WorkspaceLeaf(app)
const dash = new DashboardView(leaf as any, plugin)
main.appendChild(dash.contentEl)
void dash.onOpen()
const chat = new ChatView(new WorkspaceLeaf(app) as any, plugin)
side.appendChild(chat.contentEl)
void chat.onOpen()

// Driven from the screenshot script: ?tab=jobs, ?modal=credential|skill, ?theme=dark, ?pane=search
const q = new URLSearchParams(location.search)
if (q.get('theme') === 'dark') document.body.className = 'theme-dark'
if (q.get('tab')) dash.goTo(q.get('tab') as Tab)
if (q.get('pane') === 'search') {
  side.replaceChildren()
  const search = new SearchView(new WorkspaceLeaf(app) as any, plugin)
  side.appendChild(search.contentEl)
  void search.onOpen()
}
if (q.get('modal') === 'credential') plugin.credentialModal({ skill: 'channel-gmail', slot: 'file' })
if (q.get('modal') === 'skill') openSkillModal(app, '/tmp/obs-scratch/wiki', snapshot.skills[0]!, async (a) => console.log(a))
if (q.get('modal') === 'replace') plugin.credentialModal({ name: 'gh-token', kind: 'value' })
if (q.get('chat') === 'turn') {
  // A fabricated transcript, to see the bubbles.
  const t = chat.contentEl.querySelector('.llm-wiki-transcript')!
  ;(t as any).createDiv({ cls: 'llm-wiki-msg llm-wiki-user', text: 'Check my inbox now and tell me what needs a reply' })
  const a = (t as any).createDiv({ cls: 'llm-wiki-msg llm-wiki-assistant' })
  const tool = a.createDiv({ cls: 'llm-wiki-tool' })
  tool.createSpan({ cls: 'llm-wiki-tool-name', text: 'Bash' })
  tool.createSpan({ cls: 'llm-wiki-tool-detail llm-wiki-muted', text: 'llm-wiki-ops jobs request inbox-joe wait=60s --json' })
  const card = a.createDiv({ cls: 'llm-wiki-permission' })
  card.createDiv({ cls: 'llm-wiki-permission-title', text: 'Run this?' })
  card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: 'llm-wiki-ops jobs request inbox-joe wait=60s --json' })
  const b = card.createDiv({ cls: 'llm-wiki-permission-buttons' })
  b.createEl('button', { text: 'Allow', cls: 'mod-cta' })
  b.createEl('button', { text: 'Deny' })
  a.createDiv({ cls: 'llm-wiki-assistant-body' }).innerHTML = '<p>The harvest landed 14 new messages. Three look like they need a reply:</p><ul><li><strong>Dana</strong> about the Q4 budget review</li><li><strong>Acme support</strong> ticket 4471</li><li><strong>Sam</strong> asking for the meeting notes</li></ul>'
}
