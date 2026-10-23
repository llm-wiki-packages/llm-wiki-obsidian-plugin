import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian'
import type LlmWikiPlugin from '../../main'
import { button, pill } from '../../ui/dom'
import type { Action, Snapshot } from '../../wiki/model'
import { renderJobs } from './jobs'
import { renderOverview } from './overview'
import { renderPages } from './pages'
import { renderSkills } from './skills'
import { openSkillModal } from '../../ui/skillModal'

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
  /** A write the tab asked for; the dashboard refreshes after it and reports the outcome. */
  write(run: () => Promise<{ ok: boolean; message: string }>): Promise<void>
  goTo(tab: Tab): void
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
    this.panel.empty()
    const snapshot = this.plugin.snapshot
    if (!snapshot) {
      this.healthPill.setText(this.plugin.problem ? 'not ready' : 'loading')
      this.healthPill.className = `llm-wiki-pill is-${this.plugin.problem ? 'error' : 'muted'}`
      this.refreshedEl.setText('')
      this.panel.createDiv({ cls: 'llm-wiki-notice', text: this.plugin.problem ?? 'Reading the wiki…' })
      return
    }
    this.healthPill.setText(snapshot.health.count ? `${snapshot.health.count} need you` : 'ok')
    this.healthPill.className = `llm-wiki-pill is-${snapshot.health.tone}`
    this.refreshedEl.setText(`refreshed ${new Date(snapshot.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    const ctx = this.context(snapshot)
    const errors = Object.entries(snapshot.errors)
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

  private context(snapshot: Snapshot): TabContext {
    return {
      snapshot,
      plugin: this.plugin,
      act: (a) => this.act(a),
      write: (run) => this.write(run),
      goTo: (t) => this.goTo(t),
    }
  }

  private async write(run: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
    const out = await run()
    new Notice(out.message, out.ok ? 4000 : 8000)
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
        if (actions) await this.write(() => actions.retryTicket(action.ticket))
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
