// Renders the dashboard and chat with fixture data in a browser, for screenshots. Not shipped.
import configAnswer from '../test/mocks/config-get.json'
import { AssistantBubble } from '../src/views/chat'
/* eslint-disable */
import { App, TFile, WorkspaceLeaf } from 'obsidian'
import { DashboardView, type Tab } from '../src/views/dashboard/index'
import type { Snapshot } from '../src/wiki/model'
import { openCredentialModal } from '../src/ui/credentialModal'
import { openSkillModal } from '../src/ui/skillModal'
import { openJobModal } from '../src/ui/jobModal'
import { openDiff } from '../src/ui/diffModal'
import { DEFAULT_SETTINGS } from '../src/settings'

const NOW = Date.now()
const q0 = (k: string) => new URLSearchParams(location.search).get(k)
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()
const ahead = (min: number) => new Date(NOW + min * 60_000).toISOString()

const snapshot: Snapshot = {
  takenAt: NOW,
  wikiKey: 'notes',
  health: { tone: 'warn', count: 2 },
  attention: [
    { id: 'unbound:inbox-joe', severity: 'warn', title: 'Joe’s mailbox cannot run on this machine', detail: 'channel-gmail needs a token or key', action: { kind: 'credential', skill: 'channel-gmail', slot: 'file' } },
    { id: 'parked:t9', severity: 'warn', title: 'YouTube subscriptions stopped: yt-cookies is stale', detail: 'cookies expired', action: { kind: 'credential', skill: 'channel-youtube', slot: 'dir', name: 'yt-cookies', retry: 't9' } },
    { id: 'outdated:web-page', severity: 'info', title: 'A newer web-page is in its package', action: { kind: 'ask', prompt: '/llm-wiki:enable web-page', label: 'Update' } },
  ],
  runner: true,
  jobs: [
    { slug: 'inbox-joe', name: 'Joe’s mailbox', kind: 'pipeline', skill: 'channel-gmail', schedule: 'every 1d', paused: false, last: { at: null, outcome: null }, next: { kind: 'unbound', detail: 'channel-gmail needs a credential' }, running: null, credential: { slot: 'file', name: null, problem: 'missing' }, reasons: ['never run'], tickets: [] },
    { slug: 'yt-subs', name: 'YouTube subscriptions', kind: 'pipeline', skill: 'channel-youtube', schedule: 'every 6h', paused: false, last: { at: ago(400), outcome: 'failed' }, next: { kind: 'unbound', detail: 'yt-cookies is stale' }, running: null, credential: { slot: 'dir', name: 'yt-cookies', problem: 'stale' }, reasons: ['overdue'], tickets: [
      { id: 't9', stage: 'harvest', state: 'failed', at: ago(400), reason: 'cookies expired', runtimeS: 12 },
      { id: 't7', stage: 'process', state: 'done', at: ago(800), reason: null, runtimeS: 95 },
      { id: 't6', stage: 'harvest', state: 'done', at: ago(810), reason: null, runtimeS: 40 },
    ] },
    { slug: 'ops-hourly', name: 'Curate what the pipeline landed', kind: 'routines', skill: null, schedule: 'every 1h', paused: false, last: { at: ago(20), outcome: 'ok' }, next: { kind: 'running', detail: 'curating' }, running: { ticket: 't12', stage: 'llm-wiki:curate', since: ago(3) }, credential: null, reasons: [], tickets: [{ id: 't12', stage: 'routine', state: 'active', at: ago(3), reason: null, runtimeS: null }, { id: 't11', stage: 'routine', state: 'done', at: ago(80), reason: null, runtimeS: 130 }] },
    { slug: 'blog-acme', name: 'Acme engineering blog', kind: 'pipeline', skill: 'web-page', schedule: 'every 1d', paused: false, last: { at: ago(900), outcome: 'ok' }, next: { kind: 'at', at: ahead(540) }, running: null, credential: null, reasons: ['ran recently'], tickets: [] },
    { slug: 'ops-nightly', name: 'Dream: merge what was curated', kind: 'routines', skill: null, schedule: 'every 1d · 02:00-05:00', paused: false, last: { at: ago(1300), outcome: 'ok' }, next: { kind: 'at', at: ahead(700), detail: 'next window 02:00-05:00' }, running: null, credential: null, reasons: ['window'], tickets: [] },
    { slug: 'ops-denials', name: 'Review denial rows', kind: 'routines', skill: null, schedule: 'every 1d', paused: true, last: { at: null, outcome: null }, next: { kind: 'paused' }, running: null, credential: null, reasons: ['paused'], tickets: [] },
  ],
  skills: [
    { name: 'channel-gmail', state: 'enabled', description: 'Gmail capture for this wiki: one watch per mailbox, daily ledgers under research/channels.', venue: 'gmail', version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/channel-gmail ticket=<id>', drifted: false, outdated: false, warnings: [], slots: [{ name: 'file', required: true, credential: null }], jobs: ['inbox-joe'], inputs: [{ name: 'mailbox', prompt: 'Which mailbox does this watch pull?', required: true }], notes: { skill: 'SKILL.md', enable: 'references/enable.md', usage: 'references/usage.md' }, dir: '.llm-wiki/skills/channel-gmail' },
    { name: 'channel-youtube', state: 'enabled', description: 'YouTube capture and note building for this wiki: yt-dlp ground truth, deterministic notes.', venue: 'youtube', version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/channel-youtube ticket=<id>', drifted: false, outdated: false, warnings: [], slots: [{ name: 'dir', required: false, credential: 'yt-cookies', problem: 'stale' }], jobs: ['yt-subs'], inputs: [], notes: { skill: 'SKILL.md', enable: 'references/enable.md' }, dir: '.llm-wiki/skills/channel-youtube' },
    { name: 'web-page', state: 'enabled', description: 'Fetch a web page or a site section into sources/, deterministic, no model session.', venue: 'web', version: '0.2.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: '/web-page url=<url>', drifted: false, outdated: true, warnings: [], slots: [], jobs: ['blog-acme'], inputs: [], notes: { skill: 'SKILL.md' }, dir: '.llm-wiki/skills/web-page' },
    { name: 'daily-report', state: 'installed', description: 'A morning digest of what every channel landed yesterday, as one page.', venue: null, version: '0.1.0', from: 'llm-wiki-packages/llm-wiki-skills@v0.5.0', usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir: '.llm-wiki/skills/daily-report' },
    ...[['channel-circle', 'Circle community spaces: courses and lessons, with assets.'], ['channel-github', 'GitHub issues and pull requests for the repositories you follow.'], ['channel-notion-tasks', 'A Notion task database, one page per task.'], ['channel-spotify', 'Podcast episodes from Spotify shows, transcribed.'], ['channel-substack', 'Substack newsletters, post by post.'], ['channel-frameio', 'Frame.io review comments on your video projects.']].map(([name, description]) => ({ name: name!, state: 'available' as const, description: description!, venue: null, version: null, from: 'llm-wiki-packages/llm-wiki-skills@0.5.0', usage: null, drifted: false, outdated: false, warnings: [], slots: [], jobs: [], inputs: [], notes: { skill: 'SKILL.md' }, dir: null })),
  ],
  pipeline: [
    { name: 'PLUGIN:curate', plugin: true, description: 'Reviews draft pages and research dispositions and accepts them into the wiki; by hand on a path, or as a routine on a ticket.', stages: ['routine'], ready: true, next: null, jobs: [] },
    { name: 'PLUGIN:dream', plugin: true, description: 'The nightly pass: merges curated content into the wiki’s knowledge, resolves contradictions, refreshes stale facts.', stages: ['routine'], ready: true, next: null, jobs: [] },
    { name: 'PLUGIN:wiki-report', plugin: true, description: 'Writes the wiki’s digest of what its ops did since the last report, as a page under research/reports.', stages: ['routine'], ready: false, next: 'llm-wiki-ops skills enable PLUGIN:wiki-report', jobs: [] },
    { name: 'channel-gmail', plugin: false, description: 'Gmail capture for this wiki: one watch per mailbox, daily ledgers under research/channels.', stages: ['harvest', 'process'], ready: true, next: null, jobs: ['inbox-joe'] },
    { name: 'channel-youtube', plugin: false, description: 'YouTube capture and note building for this wiki: yt-dlp ground truth, deterministic notes.', stages: ['harvest', 'process'], ready: true, next: null, jobs: ['yt-subs'] },
    { name: 'web-page', plugin: false, description: 'Fetch a web page or a site section into sources/, deterministic, no model session.', stages: ['harvest'], ready: true, next: null, jobs: ['blog-acme'] },
  ],
  credentials: [
    { name: 'claude_login', kind: 'harness', state: 'verified', verified: ago(60), uses: [] },
    { name: 'yt-cookies', kind: 'dir', state: 'unverified', verified: null, uses: [{ skill: 'channel-youtube', slot: 'dir', problem: 'stale' }] },
    { name: 'gh-token', kind: 'value', state: 'failed', verified: ago(3000), uses: [] },
    { name: 'acme-blog-key', kind: 'value', state: 'unverified', verified: null, uses: [{ job: 'blog-acme', slot: 'env.API_KEY' }] },
  ],
  pages: [
    ...Array.from({ length: 12 }, (_, i) => ({ path: `sources/youtube/lex/episode-${400 + i}.md`, state: 'new' as const, change: 'current' as const })),
    { path: 'sources/mail/joe/q3-vendor-contract.md', state: 'new', change: 'current' },
    { path: 'sources/mail/joe/offsite-dates.md', state: 'new', change: 'current' },
    { path: 'sources/papers/vector-db-benchmarks.md', state: 'new', change: 'new' },
    { path: 'sources/web/acme/pricing-teardown.md', state: 'draft', change: 'edited' },
    { path: 'sources/web/acme/postgres-at-scale.md', state: 'accepted', change: 'current' },
  ],
  boxes: true,
  activity: [
    { sha: 'a1b2c3d4', at: ago(35), subject: 'dream: refreshed 2 wiki pages from their sources', op: 'dream', actor: 'agent@mac-mini', files: [{ path: 'wiki/topics/retrieval-evals.md', status: 'M' }, { path: 'wiki/concepts/offers.md', status: 'M' }] },
    { sha: 'b2c3d4e5', at: ago(120), subject: 'inbox-joe: 3 messages', op: 'inbox-joe', actor: 'agent@mac-mini', files: [{ path: 'sources/email/joe/2026-10-27.md', status: 'A' }, { path: 'sources/email/joe/2026-10-26.md', status: 'M' }, { path: 'sources/email/joe/2026-10-25.md', status: 'M' }] },
    { sha: 'c3d4e5f6', at: ago(200), subject: 'sweep 4 files', op: 'none', actor: 'user@macbook', files: [{ path: 'sources/notes/mine.md', status: 'A' }, { path: 'sources/web/acme/pricing-teardown.md', status: 'M' }, { path: 'sources/notes/old idea.md', status: 'D' }, { path: 'wiki/topics/pricing.md', status: 'M' }, { path: 'templates/Note.md', status: 'M' }, { path: 'sources/attachments/chart.png', status: 'A' }] },
    { sha: 'd4e5f6a7', at: ago(1500), subject: 'sweep 1 file', op: 'none', actor: 'user@macbook' },
    { sha: 'e5f6a7b8', at: ago(1600), subject: 'curate: accepted 6 pages', op: 'curate', actor: 'agent@macbook' },
  ],
  machine: 'macbook',
  fleet: q0('fleet') === '1' ? [] : [
    { name: 'macbook', state: 'no-cadence', lastSeen: ago(2), roles: [], me: true },
    { name: 'mac-mini', state: 'healthy', lastSeen: ago(3), roles: ['harvest', 'index', 'process'], me: false },
    { name: 'linux-box', state: 'stuck', lastSeen: ago(2900), roles: ['transcribe'], me: false, detail: 'push rejected since Sunday' },
  ],
  sync: { dirty: 2, untracked: 1, unpushed: 2, behind: 0, upstream: 'origin/main', files: [{ path: 'wiki/topics/retrieval-evals.md', status: 'modified' }, { path: 'sources/web/acme/pricing-teardown.md', status: 'modified' }, { path: 'sources/notes/mine.md', status: 'untracked' }] },
  search: { engine_configured: true, realm_ready: true, serving: 'search_server', corpus_files: 1284, dirty: 4, marker_known: true, reindex_required: false, index_as_of: { source_commit: '9f3c2a1e7b' }, paths: [{ pattern: 'wiki/', origin: 'committed' }, { pattern: 'sources/', origin: 'committed' }, { pattern: 'research/*/reports/', origin: 'local' }], not_indexed: [{ pattern: '_raw/', origin: 'local' }],
    backends: [{ name: 'search_server', configured: true, available: true }, { name: 'grep', configured: true, available: true }],
    properties: [{ key: 'Draft', type: 'checkbox', match: 'exact' }, { key: 'Archive', type: 'checkbox', match: 'exact' }, { key: 'project', type: 'text', match: 'prefix' }], _cmd_: { head: 'c41d07be22' } },
  recent: [
    { op: 'pass', outcome: 'ok', at: ago(20), summary: '' },
    { op: 'pass', job: 'yt-subs', outcome: 'failed', at: ago(400), summary: 'cookies expired' },
    { op: 'pass', outcome: 'ok', at: ago(80), summary: '2 pages written' },
  ],
  errors: {},
}

const app = new App()
// The notes behind the Changes tab: what Obsidian's metadata cache would hold.
const note = (path: string, fm: Record<string, unknown>, body: string, minAgo: number) => (app.files[path] = new TFile(path, fm, body, NOW - minAgo * 60_000))
for (let i = 0; i < 12; i++) note(`sources/youtube/lex/episode-${400 + i}.md`, { title: `Lex Fridman Podcast #${400 + i}`, job: 'yt-lex', resource: `https://www.youtube.com/watch?v=${i}` }, '', 120 + i * 7)
note('sources/mail/joe/q3-vendor-contract.md', { title: 'Q3 vendor contract renewal', job: 'inbox-joe', summary: 'Renewal terms move to annual billing from January; Joe asks for a decision by Friday.' }, '', 130)
note('sources/mail/joe/offsite-dates.md', { title: 'Re: offsite dates', job: 'inbox-joe', summary: 'Two options for the March offsite, both in Lisbon.' }, '', 190)
note('sources/papers/vector-db-benchmarks.md', { title: 'Vector DB benchmarks', source: 'vector-db-benchmarks.pdf' }, '', 1400)
note('sources/web/acme/pricing-teardown.md', { title: 'Pricing page teardown', Draft: true, resource: 'https://acme.com/pricing' }, '---\ntitle: x\n---\n# Pricing page teardown\n\nAcme moved the Team plan from **$12 to $15** per seat and dropped the annual discount to 10%.\n\n- Starter stays free\n- Enterprise is now quote-only\n', 60)
note('research/agent-memory/survey.md', { title: 'Agent memory survey', Draft: true }, '# Agent memory survey\n\nNotes from twelve papers on long-term memory for agents.\n', 1500)
note('wiki/topics/retrieval-evals.md', { title: 'Notes on retrieval evals', Draft: true }, '# Retrieval evals\n\nRecall at 10 is the number we watch; MRR hides too much.\n', 20)
// Pages on disk for the search freshness check: one current, one edited since it was indexed; a third is gone.
const pages: Record<string, string> = {
  'wiki/concepts/value-equation.md': '# Value equation\n\nThe value equation says perceived value rises with the dream outcome and the likelihood of achieving it, and falls with time delay and effort.\n',
  'sources/web/acme/pricing-tiers.md': '# Pricing tiers\n\nWe now price on seats only; the usage tier was retired in September.\n',
}
app.vault.adapter = { exists: async (p: string) => p in pages, read: async (p: string) => pages[p] ?? '' }
const hits = [
  { rank: 1, score: 0.98, title: 'Value equation', source_path: 'wiki/concepts/value-equation.md', snippet: 'The value equation says perceived value rises with the dream outcome and the likelihood of achieving it, and falls with time delay and effort.', passage_start: 0, passage_end: 138, passages_retained: 3 },
  { rank: 2, score: 0.91, title: 'Pricing tiers', source_path: 'sources/web/acme/pricing-tiers.md', snippet: 'Three tiers: starter, growth and a usage-based tier that bills per API call, so pricing tracks the value a customer gets out of the product each month.' },
  { rank: 3, score: 0.84, title: 'Old offer notes', source_path: 'wiki/notes/old-offer.md', snippet: 'An early draft of the grand slam offer: stack the bonuses until the price looks small against the value of the whole package.' },
]
// `config get`: a real answer from a scratch wiki, trimmed to the rows the tab reads.
for (const t of ['Note', 'Journal', 'Clip', 'Meeting']) note(`templates/${t}.md`, {}, '', 9000)
const fakeCli = {
  run: async (verb: string) => {
    if (verb === 'wiki.config.get') return configAnswer
    if (verb === 'wiki.search.query') return { backend: 'search_server', quality_mode: 'hybrid_rerank', count: hits.length, hits, backend_metadata: { index_as_of: { source_commit: '9f3c2a1e7b' } }, _cmd_: { head: 'c41d07be22' } }
    if (verb === 'wiki.search.status') return snapshot.search
    // A real `page diff` answer, captured from a scratch wiki and trimmed.
    if (verb === 'wiki.page.diff') return { path: 'sources/notes/Alpha note.md',
      old: { at: 'saved', sha: '1556611', path: 'sources/notes/Alpha note.md', revision: 2, exists: true, frontmatter: 'ok' },
      new: { at: 'working', sha: null, path: 'sources/notes/Alpha note.md', revision: 2, exists: true, frontmatter: 'ok' },
      frontmatter: [{ key: 'tags', change: 'changed', old: ['demo'], new: ['demo', 'more'] }, { key: 'Draft', change: 'added', old: null, new: 'true' }, { key: 'verified', change: 'removed', old: '2026-10-20', new: null }],
      hunks: [
        { old_start: 18, old_count: 3, new_start: 18, new_count: 4, lines: [
          { kind: 'context', old: 18, new: 18, text: '## What it costs' },
          { kind: 'removed', old: 19, new: null, text: 'Three tiers: starter, growth and enterprise.' },
          { kind: 'added', old: null, new: 19, text: 'Three tiers: starter, growth and a usage-based tier that bills per API call, so pricing tracks the value a customer gets out of the product each month.' },
          { kind: 'added', old: null, new: 20, text: '' },
          { kind: 'context', old: 20, new: 21, text: 'See [[offers]] for how the bonuses stack.' },
        ] },
        { old_start: 41, old_count: 1, new_start: 42, new_count: 1, lines: [
          { kind: 'removed', old: 41, new: null, text: '- [ ] ask about annual billing' },
          { kind: 'added', old: null, new: 42, text: '- [x] ask about annual billing' },
        ] },
      ], identical: false }
    if (verb === 'wiki.git.changed') return { files: ['sources/web/acme/pricing-tiers.md', 'wiki/concepts/offers.md', 'wiki/notes/2026-10-25.md', 'wiki/index.md', 'research/r.md', 'sources/web/acme/on-call.md'] }
    return {}
  },
}
const plugin: any = {
  app,
  cli: fakeCli,
  settings: { ...DEFAULT_SETTINGS, defaultSkill: new URLSearchParams(location.search).get('skill') ?? '', lastSession: new URLSearchParams(location.search).get('last') === '1' ? 'abc' : '' },
  wiki: { key: 'notes', name: 'Notes', root: '/tmp/obs-scratch/wiki' },
  snapshot,
  problem: new URLSearchParams(location.search).get('problem') === 'cli' ? 'llm-wiki-cli not found on the login shell PATH; set its path in the plugin settings' : new URLSearchParams(location.search).get('problem') === 'wiki' ? 'the vault is not a registered wiki (2 registered); join it, or set the wiki key in the plugin settings' : null,
  actions: new Proxy({}, { get: (_t, verb) => (...args: unknown[]) => { console.log('action', verb, args); return Promise.resolve({ ok: true, message: `${String(verb)} ok` }) } }),
  refreshSnapshot: () => Promise.resolve(),
  openChat: (text?: string) => { console.log('chat', text); dash.goTo('chat'); dash.chat.prefill(text ?? ''); return Promise.resolve() },
  addJob: () => console.log('add job'),
  pickSkill: () => console.log('pick skill'),
  chatSkills: () => Promise.resolve([
    { name: 'search', description: 'When asked what a wiki knows or says about something.', args: '<question>' },
    { name: 'add', description: 'When asked to watch, follow, track, or add a source to the wiki.', args: '<url, channel or task>' },
    { name: 'curate', description: 'When asked to review staged notes.', args: '' },
    { name: 'status', description: 'When asked what wikis exist on this machine, or whether llm-wiki is healthy.', args: '' },
    { name: 'doctor', description: 'When asked whether this machine is set up correctly for a wiki.', args: '' },
  ]),
  models: [],
  credentialModal: (p: unknown) => openCredentialModal(app, snapshot, plugin.actions, p as any, async () => {}),
  backend: () => Promise.reject(new Error('no backend in the preview')),
  detect: () => Promise.resolve(),
  openSettings: () => console.log('settings'),
  saveSettings: () => Promise.resolve(),
  autosave: { mode: () => (q0('save') ?? 'sync'), unsaved: () => ['wiki/topics/retrieval-evals.md', 'sources/web/acme/pricing-teardown.md', 'sources/notes/mine.md'], isUnsaved: () => true, state: 'waiting', saveNow: () => Promise.resolve() },
  vaultPath: () => '/Users/joe/Notes',
  registered: [{ key: 'notes', name: 'Notes', path: '/Users/joe/Notes' }, { key: 'work', name: 'Work', path: '/Users/joe/Work' }],
  cliBin: '/usr/local/bin/llm-wiki-cli',
  claudeBin: new URLSearchParams(location.search).get('claude') === '0' ? null : '/usr/local/bin/claude',
}
if (plugin.problem) plugin.snapshot = null
if (new URLSearchParams(location.search).get('filters') === '1') plugin.settings.searchFilters = [{ kind: 'under', value: 'wiki/' }, { kind: 'tag', value: 'pricing, offers' }]

const main = document.getElementById('main')!
const leaf = new WorkspaceLeaf(app)
const dash: any = new DashboardView(leaf as any, plugin)
main.appendChild(dash.contentEl)
void dash.onOpen()
const chat = dash.chat

// Driven from the screenshot script: ?tab=jobs|chat|search, ?modal=credential|skill, ?theme=dark, ?narrow=1
const q = new URLSearchParams(location.search)
if (q.get('theme') === 'dark') document.body.className = 'theme-dark'
if (q.get('narrow') === '1') main.style.maxWidth = '420px'
if (q.get('tab')) dash.goTo(q.get('tab') as Tab)
if (q.get('modal') === 'credential') plugin.credentialModal({ skill: 'channel-gmail', slot: 'file' })
const ctx = { snapshot, plugin, act: async (a: any) => console.log('act', a), write: async (run: any) => console.log(await run()), goTo: (t: Tab) => dash.goTo(t) }
if (q.get('modal') === 'skill') openSkillModal(app, snapshot.skills[Number(q.get('skill') ?? 0)]!, ctx as any)
if (q.get('modal') === 'job') openJobModal(app, snapshot.jobs[Number(q.get('job') ?? 1)]!, ctx as any)
if (q.get('jobs') === '0') { snapshot.jobs = []; snapshot.attention = []; snapshot.health = { tone: 'ok', count: 0 }; dash.render() }
if (q.get('runner') === '0') { snapshot.runner = false; dash.render() }
if (q.get('many') === '1') {
  for (let i = 0; i < 20; i++) snapshot.jobs.push({ slug: `feed-${i}`, name: `Feed ${i}`, kind: 'pipeline', skill: 'web-page', schedule: 'every 1d', paused: false, last: { at: ago(100 + i * 60), outcome: 'ok' }, next: { kind: 'at', at: ahead(60 + i * 45) }, running: null, credential: null, reasons: [], tickets: [] })
  dash.render()
}
if (q.get('modal') === 'diff') openDiff(plugin, q.get('commit') ? { path: 'sources/notes/Alpha note.md', commit: snapshot.activity[2]!, history: snapshot.activity } : { path: 'sources/notes/Alpha note.md' })
if (q.get('sub')) { dash.memo['changes.tab'] = q.get('sub'); dash.render() }
if (q.get('modal') === 'replace') plugin.credentialModal({ name: 'yt-cookies', kind: 'dir', skill: 'channel-youtube', slot: 'dir', retry: 't9', job: 'yt-subs' })
if (q.get('chat') === 'turn') {
  // A fabricated turn, through the real bubble.
  dash.goTo('chat')
  const t = dash.contentEl.querySelector('.llm-wiki-transcript') as HTMLElement
  t.querySelector('.llm-wiki-hint')?.remove()
  dash.contentEl.querySelector('.llm-wiki-chips')?.empty()
  ;(t as any).createDiv({ cls: 'llm-wiki-msg llm-wiki-user', text: 'what’s new in the wiki' })
  const root = '/Users/joe/wikis/personal'
  const a = new AssistantBubble(t, app as any, chat, root)
  const tool = (id: string, name: string, input: any, out?: string, error = false) => {
    a.take({ type: 'tool', id, name, input, detail: input.command ?? input.file_path ?? '' })
    if (out !== undefined) a.take({ type: 'tool-done', id, output: out, error })
  }
  tool('s1', 'Skill', { skill: 'brain:wiki-report', args: 'what’s new' }, 'Launching skill: brain:wiki-report')
  tool('b1', 'Bash', { command: 'llm-wiki-ops whereami skill=PLUGIN:wiki-report' }, 'wiki: personal (/Users/joe/wikis/personal)\nsession: attended\nsandbox: none')
  tool('b2', 'Bash', { command: 'llm-wiki-ops --help 2>&1 | head -80; echo ---; llm-wiki-ops op since --help 2>&1 | head -40', description: 'Read the CLI help' }, 'Usage: llm-wiki-ops [OPTIONS] COMMAND [ARGS]...\n\n  llm-wiki-ops 0.9.0 — the one wiki this CLI is scoped to.\n\nCommands:\n  init   Create the wiki…\n  doctor What is wrong…')
  tool('b3', 'Bash', { command: 'llm-wiki-ops reference skills/wiki-report/SKILL.md' }, '# wiki-report\n\nReport what changed since the last report…')
  tool('b4', 'Bash', { command: 'rm -rf _raw/tmp' })
  void a.ask({ tool: 'Bash', input: {}, summary: 'rm -rf _raw/tmp' })
  ;(t.querySelectorAll('.llm-wiki-permission button')[2] as HTMLElement).click()
  a.take({ type: 'tool-done', id: 'b4', output: 'Denied in Obsidian', error: true })
  a.take({ type: 'text', text: 'Running the wiki-report skill by hand (its preload hook got blocked). Opening the op and fixing the window.' })
  tool('r1', 'Read', { file_path: `${root}/wiki/log.md` }, '1  # Log\n2  - 2026-10-20 — init')
  tool('e1', 'Edit', { file_path: `${root}/wiki/topics/plans.md`, old_string: 'status: draft\nowner: joe', new_string: 'status: stable\nowner: joe' }, 'The file has been updated.')
  a.take({ type: 'text', text: '[[wiki/log.md]] has a single entry:\n\n- **2026-10-20** — `init`: wiki initialized (ops 0.7.0)\n\nSo no distill, dream or query has run yet. On your question:\n\n- The log shows nothing new.\n- Git has recent commits (“sweep 2 files”), so you edited pages:\n  - `sources/notes/Some file.md`\n  - `wiki/topics/plans.md`\n- Approve `git log` and I can say what changed.\n\n1. First\n2. Second' })
  tool('b5', 'Bash', { command: 'llm-wiki-ops git log filter=since:7d' })
  ;(t.querySelectorAll('.llm-wiki-tool-line')[1] as HTMLElement).click()
}
// The composer's states: ?busy=1 shows Stop, ?ctx=<tokens> fills the ring, ?pop=perm|model|effort|ring opens one, ?slash=<text> types into the box.
if (q.get('busy') === '1') { (chat as any).running = new AbortController(); (chat as any).showSend() }
if (q.get('ctx')) chat.ring.set(Number(q.get('ctx')), 1_000_000)
if (q.get('sandbox') === '1') { plugin.settings.sandboxed = true; (chat as any).showControls() }
if (q.get('ro') === '1') { plugin.settings.readOnly = true; (chat as any).showControls() }
if (q.get('q')) {
  dash.goTo('search')
  const box = dash.contentEl.querySelector('.llm-wiki-search-input') as HTMLInputElement
  box.value = q.get('q')!
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
}
if (q.get('panel') === '1') (dash.contentEl.querySelector('.llm-wiki-search-tool') as HTMLElement).click()
setTimeout(() => {
  if (q.get('modal') === 'index') dash.search.openIndex()
  const pop = q.get('pop')
  if (pop === 'perm') (chat as any).openPermissions()
  if (pop === 'model') (chat as any).openModels()
  if (pop === 'effort') (chat as any).openEfforts()
  if (pop === 'ring') chat.ring.el.dispatchEvent(new MouseEvent('mouseenter'))
  if (q.get('slash') !== null) {
    const box = dash.contentEl.querySelector('.llm-wiki-composer-input') as HTMLTextAreaElement
    box.value = q.get('slash')!
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
    box.dispatchEvent(new Event('input'))
  }
}, 300)
