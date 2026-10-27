import { Component, MarkdownRenderer } from 'obsidian'
import { button, empty, icon, relativeTime } from '../../ui/dom'
import { confirm, promptText } from '../../ui/modals'
import { collapses, groupPages, type GroupBy, type PageGroup } from '../../vault/groups'
import { draftsIn, factsOf, setBox, type PageFacts } from '../../vault/pages'
import { isFeed, isResearch, layout } from '../../wiki/layout'
import type { Commit } from '../../wiki/model'
import { dayOf, whoOf, type WhoKind } from '../../wiki/who'
import type { TabContext } from './index'

/** What is new, what you are holding, and what happened: the content side of the wiki. */
export type ChangesTab = 'new' | 'drafts' | 'activity'

const GROUP_NAMES: Record<GroupBy, string> = { source: 'By source', folder: 'By folder', none: 'No groups' }
const COLLAPSE_AT = [0, 3, 5, 10, 25]
/** Asked before a bulk action this large. */
const CONFIRM_OVER = 10

/** The pages waiting for a look; the tab's count. */
export function newPages(ctx: TabContext): PageFacts[] {
  return (ctx.snapshot.pages ?? []).filter((p) => p.state === 'new').map((p) => factsOf(ctx.plugin.app, p.path))
}

export function renderChanges(root: HTMLElement, ctx: TabContext): void {
  const fresh = newPages(ctx)
  const drafts = draftsIn(ctx.plugin.app)
  const sub = (ctx.memo['changes.tab'] as ChangesTab | undefined) ?? (fresh.length || !drafts.length ? 'new' : 'drafts')
  unsavedStrip(root, ctx)
  const bar = root.createDiv({ cls: 'llm-wiki-subnav' })
  const seg = (id: ChangesTab, label: string, count?: number) => {
    const b = bar.createEl('button', { cls: `llm-wiki-seg${sub === id ? ' is-active' : ''}` })
    b.createSpan({ text: label })
    if (count !== undefined) b.createSpan({ cls: 'llm-wiki-seg-count', text: String(count) })
    b.addEventListener('click', () => {
      ctx.memo['changes.tab'] = id
      ctx.redraw()
    })
  }
  seg('new', 'New', fresh.length)
  seg('drafts', 'Drafts', drafts.length)
  seg('activity', 'Activity')
  const tools = bar.createDiv({ cls: 'llm-wiki-subnav-tools' })
  if (sub === 'new') renderNew(root, tools, ctx, fresh)
  else if (sub === 'drafts') renderDrafts(root, ctx, drafts)
  else renderActivity(root, ctx)
}

/** Edits made here that are not in history yet, and what will happen to them. */
function unsavedStrip(root: HTMLElement, ctx: TabContext): void {
  const autosave = ctx.plugin.autosave
  const s = ctx.snapshot.sync
  const files = Math.max(autosave.unsaved().length, (s?.dirty ?? 0) + (s?.untracked ?? 0))
  if (!files) return
  const mode = autosave.mode()
  const strip = root.createDiv({ cls: 'llm-wiki-unsaved' })
  strip.createSpan({ cls: 'llm-wiki-dot is-info' })
  const words = strip.createDiv({ cls: 'llm-wiki-row-main' })
  words.createDiv({ cls: 'llm-wiki-row-title', text: `${files} ${files === 1 ? 'file' : 'files'} edited since the last save` })
  words.createDiv({ cls: 'llm-wiki-row-detail', text: mode === 'runner' ? 'The runner on this machine saves them on its next tick.'
    : mode === 'off' ? 'Saving to history is off in the settings.'
      : autosave.state === 'saving' ? 'Saving…'
        : `Saved after two quiet minutes${mode === 'sync' ? ', then synced to your other machines' : ''}.` })
  if (mode === 'commit' || mode === 'sync') button(strip, 'Save now', () => autosave.saveNow(), { icon: 'save', cta: true })
}

function renderNew(root: HTMLElement, tools: HTMLElement, ctx: TabContext, pages: PageFacts[]): void {
  const settings = ctx.plugin.settings
  const select = <T extends string | number>(value: T, options: [T, string][], set: (v: T) => void) => {
    const el = tools.createEl('select', { cls: 'dropdown llm-wiki-small-select' })
    for (const [v, label] of options) el.createEl('option', { value: String(v), text: label })
    el.value = String(value)
    el.addEventListener('change', () => {
      const picked = options.find(([v]) => String(v) === el.value)
      if (picked) set(picked[0])
      void ctx.plugin.saveSettings()
      ctx.redraw()
    })
  }
  select<GroupBy>(settings.changesGroup, Object.entries(GROUP_NAMES) as [GroupBy, string][], (v) => (settings.changesGroup = v))
  if (settings.changesGroup !== 'none')
    select<number>(settings.changesCollapse, COLLAPSE_AT.map((n) => [n, n ? `Fold over ${n}` : 'Never fold']), (v) => (settings.changesCollapse = v))

  if (ctx.snapshot.pages === null) {
    empty(root, 'The page list could not be read.', 'The notice above says why.')
    return
  }
  if (!pages.length) {
    empty(root, 'Nothing new.', `Pages your jobs bring in, and files you drop into ${layout().feeds.join(', ')}/, wait here for a look before the agent uses them.`)
    return
  }
  if (!ctx.memo['changes.explained']) {
    const note = root.createDiv({ cls: 'llm-wiki-explain' })
    note.createSpan({ text: 'Accept takes a page into the wiki: the agent may fold it into wiki pages, and it stays accepted when you edit it. Draft holds it while you work on it. Archive takes it out of search and the agent’s reach; untick Archive on the page to bring it back.' })
    button(note, '', () => {
      ctx.memo['changes.explained'] = true
      ctx.redraw()
    }, { icon: 'x', title: 'Hide' })
  }
  const open = (ctx.memo['changes.open'] as Set<string> | undefined) ?? new Set<string>()
  ctx.memo['changes.open'] = open
  const jobName = (slug: string) => ctx.snapshot.jobs.find((j) => j.slug === slug)?.name
  for (const g of groupPages(pages, settings.changesGroup, jobName)) {
    if (collapses(g, settings.changesCollapse, open.has(g.key))) {
      foldedGroup(root, g, ctx, () => {
        open.add(g.key)
        ctx.redraw()
      })
      continue
    }
    if (g.label) groupHead(root, g, ctx)
    for (const p of g.pages) newRow(root, p, ctx)
  }
}

/** A big group as one row: how many, from where, and the three things to do with all of it. */
function foldedGroup(root: HTMLElement, g: PageGroup, ctx: TabContext, review: () => void): void {
  const row = root.createDiv({ cls: 'llm-wiki-fold' })
  row.createSpan({ cls: 'llm-wiki-fold-count', text: String(g.pages.length) })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: g.label || 'New pages' })
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [`new ${g.pages.length === 1 ? 'page' : 'pages'}`, g.folder && g.folder !== g.label ? g.folder : '', g.newest ? `newest ${relativeTime(new Date(g.newest).toISOString())}` : ''].filter(Boolean).join(' · ') })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Review', review, { icon: 'chevron-down' })
  bulkButtons(bar, g, ctx)
}

function groupHead(root: HTMLElement, g: PageGroup, ctx: TabContext): void {
  const head = root.createDiv({ cls: 'llm-wiki-group llm-wiki-group-row' })
  head.createSpan({ text: `${g.label} · ${g.pages.length}` })
  if (g.pages.length > 1) bulkButtons(head.createDiv({ cls: 'llm-wiki-row-actions' }), g, ctx)
}

function bulkButtons(bar: HTMLElement, g: PageGroup, ctx: TabContext): void {
  const actions = ctx.plugin.actions
  if (!actions) return
  const paths = g.pages.map((p) => p.path)
  const what = `${paths.length} pages${g.label ? ` from ${g.label}` : ''}`
  button(bar, 'Archive all…', async () => {
    const reason = await promptText(ctx.plugin.app, { title: `Archive ${what}`, placeholder: 'Why? One line; it is stamped on each page.', cta: 'Archive' })
    if (reason) await ctx.write(() => actions.reject(paths, reason), true)
  }, { icon: 'archive' })
  button(bar, 'Accept all…', async () => {
    if (paths.length > CONFIRM_OVER && !(await confirm(ctx.plugin.app, { title: `Accept ${what}?`, body: 'The agent may then fold each of them into the wiki’s pages. You can still archive any of them later.', cta: 'Accept all' }))) return
    await ctx.write(() => actions.accept(paths), true)
  }, { icon: 'check-check', cta: true })
}

function openPage(ctx: TabContext, path: string): void {
  void ctx.act({ kind: 'open', path })
}

function newRow(root: HTMLElement, p: PageFacts, ctx: TabContext): void {
  const actions = ctx.plugin.actions
  const row = root.createDiv({ cls: 'llm-wiki-row is-link' })
  row.tabIndex = 0
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: p.title })
  main.createDiv({ cls: 'llm-wiki-row-detail', text: [p.blurb || p.path, p.host, p.mtime ? relativeTime(new Date(p.mtime).toISOString()) : ''].filter(Boolean).join(' · ') })
  row.addEventListener('click', () => openPage(ctx, p.path))
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') openPage(ctx, p.path)
  })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!actions) return
  button(bar, 'Draft', () => ctx.write(() => setBox(ctx.plugin.app, p.path, layout().draftKey, true), true), { icon: 'pencil', title: 'Hold it while you work on it; nothing automatic takes it' })
  button(bar, 'Archive…', async () => {
    const reason = await promptText(ctx.plugin.app, { title: `Archive ${p.title}`, placeholder: 'Why? One line; it is stamped on the page.', cta: 'Archive' })
    if (reason) await ctx.write(() => actions.reject(p.path, reason), true)
  }, { icon: 'archive', title: 'Out of search and the agent’s reach' })
  button(bar, 'Accept', () => ctx.write(() => actions.accept([p.path]), true), { icon: 'check', cta: true, title: 'Into the wiki: the agent may fold it into wiki pages' })
}

/** Why a page is a draft, in a word. */
function draftWhy(p: PageFacts): { text: string; tone: string } {
  if (isResearch(p.path)) return { text: 'research', tone: 'info' }
  return { text: 'on hold', tone: 'muted' }
}

function renderDrafts(root: HTMLElement, ctx: TabContext, drafts: PageFacts[]): void {
  if (!drafts.length) {
    empty(root, 'No drafts.', `Tick ${layout().draftKey} on a page to hold it while you work on it; nothing automatic takes a draft. It shows here until you accept it.`)
    return
  }
  const selected = drafts.find((d) => d.path === ctx.memo['changes.draft']) ?? drafts[0]!
  const split = root.createDiv({ cls: 'llm-wiki-split' })
  const list = split.createDiv({ cls: 'llm-wiki-split-list' })
  for (const d of drafts) {
    const row = list.createDiv({ cls: `llm-wiki-row is-link${d === selected ? ' is-selected' : ''}` })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: d.title })
    const detail = main.createDiv({ cls: 'llm-wiki-row-detail' })
    const why = draftWhy(d)
    detail.createSpan({ cls: `llm-wiki-pill is-${why.tone}`, text: why.text })
    detail.createSpan({ text: ` ${d.mtime ? `edited ${relativeTime(new Date(d.mtime).toISOString())}` : ''}` })
    row.addEventListener('click', () => {
      ctx.memo['changes.draft'] = d.path
      ctx.redraw()
    })
  }
  preview(split.createDiv({ cls: 'llm-wiki-split-preview' }), selected, drafts, ctx)
}

function preview(el: HTMLElement, d: PageFacts, drafts: PageFacts[], ctx: TabContext): void {
  const app = ctx.plugin.app
  const head = el.createDiv({ cls: 'llm-wiki-preview-head' })
  head.createDiv({ cls: 'llm-wiki-row-detail', text: d.path })
  const bar = el.createDiv({ cls: 'llm-wiki-row-actions llm-wiki-preview-actions' })
  const body = el.createDiv({ cls: 'llm-wiki-preview-body markdown-rendered' })
  const file = app.vault.getFileByPath(d.path)
  // One renderer per preview: the last one's embeds and children go when this one draws.
  ;(ctx.memo['changes.renderer'] as Component | undefined)?.unload()
  const renderer = new Component()
  renderer.load()
  ctx.memo['changes.renderer'] = renderer
  if (file) void app.vault.cachedRead(file).then((text) => MarkdownRenderer.render(app, text.replace(/^---\n[\s\S]*?\n---\n?/, ''), body, d.path, renderer))
  // After a decision, the next draft is up.
  const next = () => {
    const i = drafts.indexOf(d)
    ctx.memo['changes.draft'] = (drafts[i + 1] ?? drafts[i - 1])?.path
  }
  const actions = ctx.plugin.actions
  button(bar, 'Open', () => openPage(ctx, d.path), { icon: 'file-text' })
  if (!actions) return
  button(bar, 'Archive…', async () => {
    const reason = await promptText(app, { title: `Archive ${d.title}`, placeholder: 'Why? One line; it is stamped on the page.', cta: 'Archive' })
    if (!reason) return
    next()
    await ctx.write(() => isFeed(d.path) ? actions.reject(d.path, reason) : setBox(app, d.path, layout().archiveKey, true), true)
  }, { icon: 'archive' })
  // A feed page is accepted by curate, which clears the box; a wiki or research page is accepted by unticking it, and the agent takes it up.
  button(bar, 'Accept', async () => {
    next()
    await ctx.write(() => isFeed(d.path) ? actions.accept([d.path]) : setBox(app, d.path, layout().draftKey, false), true)
  }, { icon: 'check', cta: true, title: isFeed(d.path) ? 'Into the wiki, and off hold' : `Off hold: unticks ${layout().draftKey}, and the agent takes it up` })
}

const WHO_CHIPS: [WhoKind | 'all', string][] = [['all', 'Everyone'], ['you', 'You'], ['job', 'Jobs'], ['agent', 'Agent']]

function renderActivity(root: HTMLElement, ctx: TabContext): void {
  const { activity, machine } = ctx.snapshot
  const jobName = (slug: string) => ctx.snapshot.jobs.find((j) => j.slug === slug)?.name
  const wanted = (ctx.memo['changes.who'] as WhoKind | 'all' | undefined) ?? 'all'
  const chips = root.createDiv({ cls: 'llm-wiki-chip-list' })
  for (const [id, label] of WHO_CHIPS) {
    const chip = chips.createEl('button', { cls: `llm-wiki-chip${wanted === id ? ' is-active' : ''}`, text: label })
    chip.addEventListener('click', () => {
      ctx.memo['changes.who'] = id
      ctx.redraw()
    })
  }
  const shown = activity.map((c) => ({ c, who: whoOf(c, machine, jobName) })).filter((x) => wanted === 'all' || x.who.kind === wanted)
  if (!shown.length) {
    empty(root, activity.length ? 'Nothing from them this week.' : 'Nothing saved to history this week.', 'Every commit to the wiki shows here: your edits once saved, what jobs brought in, what the agent wrote.')
    return
  }
  let day = ''
  for (const { c, who } of shown) {
    const d = dayOf(c.at)
    if (d !== day) {
      day = d
      root.createDiv({ cls: 'llm-wiki-day', text: d })
    }
    activityRow(root, c, who.label, who.kind)
  }
}

function activityRow(root: HTMLElement, c: Commit, who: string, kind: WhoKind): void {
  const row = root.createDiv({ cls: 'llm-wiki-activity' })
  row.createSpan({ cls: 'llm-wiki-activity-when', text: new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  icon(row, kind === 'you' ? 'user' : kind === 'job' ? 'download' : 'bot', `llm-wiki-who is-${kind}`)
  row.createSpan({ cls: `llm-wiki-who is-${kind}`, text: who })
  row.createSpan({ cls: 'llm-wiki-row-detail', text: c.subject })
  row.title = c.sha.slice(0, 7)
}
