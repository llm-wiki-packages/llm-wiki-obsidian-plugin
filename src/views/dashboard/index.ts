import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian'
import type LlmWikiPlugin from '../../main'
import { button, pill } from '../../ui/dom'
import type { Action, Snapshot } from '../../wiki/model'
import { renderJobs } from './jobs'
import { renderOverview } from './overview'
import { renderPages } from './pages'
import { renderSkills } from './skills'
import { openSkillModal } from '../../ui/skillModal'
import { openJobModal } from '../../ui/jobModal'
import type { JobView } from '../../wiki/model'

export const VIEW_DASHBOARD = 'llm-wiki-dashboard'

export type Tab = 'overview' | 'jobs' | 'skills' | 'pages'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'skills', label: 'Skills' },
  { id: 'pages', label: 'Pages' },
]

/** What a tab renderer gets: the snapshot, and the ways to act on it. */
export interface TabContext {
  snapshot: Snapshot
  plugin: LlmWikiPlugin
  /** Runs a row's action: a write through Actions, or a hand-off to chat. */
  act(action: Action): Promise<void>
  /** A write the tab asked for; the dashboard refreshes after it and reports the outcome. `quiet` skips the Notice when the row itself will show the change. */
  write(run: () => Promise<{ ok: boolean; message: string }>, quiet?: boolean): Promise<void>
  goTo(tab: Tab): void
  /** Per-view scratch a tab keeps across renders: a filter, an expansion. */
  memo: Record<string, unknown>
}

/** What a failed read is called on screen. */
const READ_NAMES: Record<string, string> = {
  'wiki.doctor': 'the doctor report', 'wiki.jobs.ls': 'the job list', 'wiki.jobs.due': 'what is due', 'wiki.tickets.ls': 'the ticket list', 'wiki.page.ls': 'the page list',
  'wiki.op.since': 'recent runs', 'wiki.search.status': 'the search status', 'wiki.git.conflicts': 'conflicts', 'machine.runner.ls': 'the runner', 'wiki.skills.ls': 'the skills',
  'wiki.skills.doctor': 'the skills doctor', 'wiki.packages.ls': 'the packages', 'wiki.credentials.ls': 'the credentials', 'wiki.credentials.bindings': 'the credential bindings',
}

export class DashboardView extends ItemView {
  private tab: Tab = 'overview'
  private panel!: HTMLElement
  private tabBar!: HTMLElement
  private refreshedEl!: HTMLElement
  private healthPill!: HTMLElement
  private readonly memo: Record<string, unknown> = {}

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: LlmWikiPlugin,
  ) {
    super(leaf)
  }

  getViewType(): string {
    return VIEW_DASHBOARD
  }

  getDisplayText(): string {
    return this.plugin.wiki ? `${this.plugin.wiki.name} — LLM Wiki` : 'LLM Wiki'
  }

  getIcon(): string {
    return 'layout-dashboard'
  }

  getState(): Record<string, unknown> {
    return { tab: this.tab }
  }

  async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const tab = (state as { tab?: Tab } | null)?.tab
    if (tab && TABS.some((t) => t.id === tab)) this.tab = tab
    await super.setState(state, result)
    if (this.panel) this.render()
  }

  onOpen(): Promise<void> {
    const root = this.contentEl
    root.empty()
    root.addClass('llm-wiki', 'llm-wiki-dashboard')
    const header = root.createDiv({ cls: 'llm-wiki-header' })
    header.createEl('h2', { text: 'LLM Wiki' })
    this.healthPill = pill(header, '…')
    this.refreshedEl = header.createSpan({ cls: 'llm-wiki-muted' })
    const actions = header.createDiv({ cls: 'llm-wiki-header-actions' })
    button(actions, 'Refresh', () => this.refresh(), { icon: 'refresh-cw' })
    button(actions, 'Chat', () => void this.plugin.openChat(), { icon: 'message-square' })
    this.tabBar = root.createDiv({ cls: 'llm-wiki-tabs' })
    for (const t of TABS) {
      const b = this.tabBar.createEl('button', { cls: 'llm-wiki-tab', text: t.label })
      b.dataset.tab = t.id
      this.registerDomEvent(b, 'click', () => this.goTo(t.id))
    }
    this.panel = root.createDiv({ cls: 'llm-wiki-panel' })
    this.registerEvent(this.app.workspace.on('llm-wiki:snapshot' as 'layout-change', () => this.render()))
    this.registerEvent(this.app.workspace.on('llm-wiki:detected' as 'layout-change', () => void this.refresh()))
    this.render()
    void this.refresh()
    return Promise.resolve()
  }

  /** The job detail dialog, for the command palette. */
  openJob(j: JobView): void {
    const snapshot = this.plugin.snapshot
    if (snapshot) openJobModal(this.app, j, this.context(snapshot))
  }

  goTo(tab: Tab): void {
    this.tab = tab
    void this.app.workspace.requestSaveLayout()
    this.render()
  }

  private refresh(): Promise<void> {
    return this.plugin.refreshSnapshot()
  }

  private render(): void {
    for (const b of Array.from(this.tabBar.children)) b.toggleClass('is-active', (b as HTMLElement).dataset.tab === this.tab)
    // A poll redraws in place; the reader keeps their scroll position.
    const scrollTop = this.contentEl.scrollTop
    this.panel.empty()
    window.requestAnimationFrame(() => (this.contentEl.scrollTop = scrollTop))
    const snapshot = this.plugin.snapshot
    if (!snapshot) {
      this.healthPill.setText(this.plugin.problem ? 'not ready' : 'loading')
      this.healthPill.className = `llm-wiki-pill is-${this.plugin.problem ? 'error' : 'muted'}`
      this.refreshedEl.setText('')
      if (this.plugin.problem) this.notReady(this.plugin.problem)
      else this.panel.createDiv({ cls: 'llm-wiki-notice', text: 'Reading the wiki…' })
      return
    }
    this.healthPill.setText(snapshot.health.count ? `${snapshot.health.count} need you` : 'ok')
    this.healthPill.className = `llm-wiki-pill is-${snapshot.health.tone}`
    const errors = Object.entries(snapshot.errors)
    const at = new Date(snapshot.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    this.refreshedEl.setText(errors.length ? `could not read everything · ${at}` : `refreshed ${at}`)
    const ctx = this.context(snapshot)
    // Every read refused: this CLI predates the plugin (or refuses the read floor); one card, not fourteen notices.
    if (errors.length >= 8 && !snapshot.jobs.length && !snapshot.skills.length) {
      this.olderCli(errors)
      return
    }
    if (errors.length) {
      const notice = this.panel.createDiv({ cls: 'llm-wiki-notice llm-wiki-notice-row' })
      notice.createSpan({ text: `Could not read ${errors.map(([v]) => READ_NAMES[v] ?? v).join(', ')}; this view may be incomplete.` })
      notice.title = errors.map(([v, m]) => `${v}: ${m}`).join('\n')
      button(notice, 'Ask the agent', () => this.act({ kind: 'ask', prompt: `The Obsidian plugin could not read these from the wiki: ${errors.map(([v, m]) => `${v} (${m})`).join('; ')}. What is wrong?` }), { icon: 'message-square' })
    }
    switch (this.tab) {
      case 'overview':
        renderOverview(this.panel, ctx)
        break
      case 'jobs':
        renderJobs(this.panel, ctx)
        break
      case 'skills':
        renderSkills(this.panel, ctx)
        break
      case 'pages':
        renderPages(this.panel, ctx)
        break
    }
  }

  private olderCli(errors: [string, string][]): void {
    const card = this.panel.createDiv({ cls: 'llm-wiki-first' })
    card.createEl('h3', { text: 'This llm-wiki-cli cannot answer the plugin' })
    card.createEl('p', { cls: 'llm-wiki-muted', text: 'Every read was refused, which an older CLI does. Update the llm-wiki plugins, then re-detect.' })
    card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: errors.slice(0, 3).map(([v, m]) => `${v}: ${m}`).join('\n') })
    const bar = card.createDiv({ cls: 'llm-wiki-row-actions' })
    button(bar, 'Re-detect', () => this.plugin.detect(true), { icon: 'refresh-cw', cta: true })
    button(bar, 'Ask the agent', () => this.act({ kind: 'ask', prompt: `The Obsidian plugin's reads of this wiki are all refused: ${errors.map(([v, m]) => `${v} (${m})`).join('; ')}. Is the llm-wiki CLI out of date, and how do I update it?` }), { icon: 'message-square' })
  }

  /** The two ways to be not ready, each with its exit: a missing binary, or a vault that is not a registered wiki. */
  private notReady(problem: string): void {
    const card = this.panel.createDiv({ cls: 'llm-wiki-first' })
    const missingCli = /llm-wiki-cli not found/.test(problem)
    const notWiki = /not a registered wiki/.test(problem)
    card.createEl('h3', { text: missingCli ? 'llm-wiki-cli was not found' : notWiki ? 'This vault is not a registered wiki' : 'Not ready' })
    card.createEl('p', { cls: 'llm-wiki-muted', text: missingCli
      ? 'The plugin runs the llm-wiki CLI from your login shell PATH. Install the llm-wiki plugins, or set the path to llm-wiki-cli in the plugin settings.'
      : notWiki
        ? `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`
        : problem })
    const registered = this.plugin.registered
    if (notWiki && registered.length) {
      card.createDiv({ cls: 'llm-wiki-muted', text: 'If this vault is one of the registered wikis under another path, pick it:' })
      const picks = card.createDiv({ cls: 'llm-wiki-chip-list' })
      for (const w of registered) {
        const chip = picks.createEl('button', { cls: 'llm-wiki-chip', text: `${w.key} · ${w.path}` })
        chip.addEventListener('click', () => {
          this.plugin.settings.wikiKey = w.key
          void this.plugin.saveSettings().then(() => this.plugin.detect(true))
        })
      }
      card.createDiv({ cls: 'llm-wiki-muted', text: 'Otherwise, from a terminal inside the vault:' })
    }
    if (notWiki) card.createEl('pre', { cls: 'llm-wiki-permission-summary', text: 'llm-wiki-cli init .        # a new wiki here\nllm-wiki-ops join key=<key>   # an existing one' })
    const bar = card.createDiv({ cls: 'llm-wiki-row-actions' })
    button(bar, 'Re-detect', () => this.plugin.detect(true), { icon: 'refresh-cw', cta: true })
    button(bar, 'Open settings', () => this.plugin.openSettings(), { icon: 'settings' })
  }

  private context(snapshot: Snapshot): TabContext {
    return {
      snapshot,
      plugin: this.plugin,
      act: (a) => this.act(a),
      write: (run, quiet) => this.write(run, quiet),
      goTo: (t) => this.goTo(t),
      memo: this.memo,
    }
  }

  private async write(run: () => Promise<{ ok: boolean; message: string }>, quiet = false): Promise<void> {
    const out = await run()
    if (!out.ok || !quiet) new Notice(out.message, out.ok ? 4000 : 8000)
    await this.refresh()
  }

  private async act(action: Action): Promise<void> {
    const actions = this.plugin.actions
    switch (action.kind) {
      case 'ask':
        await this.plugin.openChat(action.prompt)
        return
      case 'open':
        await this.app.workspace.openLinkText(action.path, '', true)
        return
      case 'retry':
        // Without a runner a retried ticket would sit queued; run the pass for it.
        if (actions) await this.write(() => action.slug && !this.plugin.snapshot?.runner ? actions.retryAndRun(action.ticket, action.slug) : actions.retryTicket(action.ticket))
        return
      case 'reindex':
        if (actions) await this.write(() => actions.reindex())
        return
      case 'credential':
        this.plugin.credentialModal({ skill: action.skill, slot: action.slot, name: action.name, retry: action.retry })
        return
      case 'inspect': {
        const s = this.plugin.snapshot?.skills.find((x) => x.name === action.skill)
        if (s && this.plugin.snapshot) openSkillModal(this.app, s, this.context(this.plugin.snapshot))
        return
      }
    }
  }
}
