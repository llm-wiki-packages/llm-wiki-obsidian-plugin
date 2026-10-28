// Reports: the briefs the agents wrote, newest first. The latest leads with
// its lede and what it says needs you; the earlier ones are a list to step
// back through; the vault's other HTML follows. Each opens in its own tab:
// a brief in the HTML view, a record as a note. Read from the vault, so it
// needs no CLI call.
import { button, empty, relativeTime, section } from '../../ui/dom'
import { openJobModal } from '../../ui/jobModal'
import { TEMPLATE_PATH, collectReports, otherHtml, vaultRows, type Report } from '../../vault/reports'
import { dayOf } from '../../wiki/who'
import type { TabContext } from './index'

/** How many earlier reports show before "Show all". */
const EARLIER = 14
const OTHER = 10

export function renderReports(root: HTMLElement, ctx: TabContext): void {
  const { app } = ctx.plugin
  const rows = vaultRows(app)
  const reports = collectReports(rows)
  const open = (path: string | null, e?: MouseEvent) => {
    const file = path ? app.vault.getFileByPath(path) : null
    if (file) void app.workspace.getLeaf(e && (e.metaKey || e.ctrlKey) ? 'split' : 'tab').openFile(file)
  }
  const template = app.vault.getFileByPath(TEMPLATE_PATH)
  const head = section(root, 'Reports', {
    count: reports.length,
    actions: template ? (bar) => button(bar, 'Template', () => open(template.path), { icon: 'layout-template', title: 'The design every brief borrows its look from' }).addClass('llm-wiki-small') : undefined,
  })

  const [latest, ...earlier] = reports
  if (!latest) noReports(head, ctx)
  else {
    latestCard(head, latest, open)
    if (earlier.length) {
      const all = ctx.memo['reports.all'] === true
      const list = section(root, 'Earlier', { count: earlier.length })
      for (const r of all ? earlier : earlier.slice(0, EARLIER)) reportRow(list, r, open)
      if (earlier.length > EARLIER)
        button(list, all ? 'Show fewer' : `Show all ${earlier.length}`, () => {
          ctx.memo['reports.all'] = !all
          ctx.redraw()
        }).addClass('llm-wiki-small')
    }
  }

  const others = otherHtml(rows)
  if (others.length) {
    const list = section(root, 'Other HTML', { count: others.length })
    for (const f of others.slice(0, OTHER)) {
      const row = list.createDiv({ cls: 'llm-wiki-row is-link' })
      const main = row.createDiv({ cls: 'llm-wiki-row-main' })
      const at = f.path.lastIndexOf('/')
      main.createDiv({ cls: 'llm-wiki-row-title', text: f.path.slice(at + 1) })
      main.createDiv({ cls: 'llm-wiki-row-detail', text: at > 0 ? f.path.slice(0, at) : 'vault root' })
      row.createSpan({ cls: 'llm-wiki-muted', text: relativeTime(new Date(f.mtime).toISOString()) })
      row.addEventListener('click', (e) => open(f.path, e))
    }
    if (others.length > OTHER) list.createDiv({ cls: 'llm-wiki-muted', text: `And ${others.length - OTHER} more; the file explorer lists them all.` })
  }
}

/** `Today`, `Yesterday` or the day, read as a local date: `2026-10-28` alone would parse as UTC midnight. */
function dayWords(r: Report): string {
  return r.date ? dayOf(`${r.date}T12:00:00`) : dayOf(new Date(r.mtime).toISOString())
}

type Open = (path: string | null, e?: MouseEvent) => void

function latestCard(parent: HTMLElement, r: Report, open: Open): void {
  const card = parent.createDiv({ cls: 'llm-wiki-report-latest' })
  const kicker = card.createDiv({ cls: 'llm-wiki-report-kicker' })
  kicker.createSpan({ text: dayWords(r) })
  if (r.date) kicker.createSpan({ cls: 'llm-wiki-muted', text: r.date })
  if (r.title) card.createDiv({ cls: 'llm-wiki-report-title', text: r.title })
  if (r.summary) card.createEl('p', { cls: 'llm-wiki-report-lede', text: r.summary })
  if (r.attention.length) {
    const list = card.createEl('ul', { cls: 'llm-wiki-report-attention' })
    for (const t of r.attention.slice(0, 5)) list.createEl('li', { text: t })
  }
  const bar = card.createDiv({ cls: 'llm-wiki-row-actions' })
  if (r.brief) button(bar, 'Open the brief', (e) => open(r.brief, e), { icon: 'newspaper', cta: true })
  if (r.record) button(bar, 'Read the record', (e) => open(r.record, e), { icon: 'file-text', cta: !r.brief })
}

function reportRow(parent: HTMLElement, r: Report, open: Open): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row is-link llm-wiki-report-row' })
  const when = row.createDiv({ cls: 'llm-wiki-report-day' })
  when.createDiv({ text: dayWords(r) })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  if (r.title) main.createDiv({ cls: 'llm-wiki-row-title', text: r.title })
  if (r.summary) main.createDiv({ cls: 'llm-wiki-row-detail llm-wiki-report-summary', text: r.summary })
  if (!r.title && !r.summary) main.createDiv({ cls: 'llm-wiki-muted', text: r.record ? 'No lede.' : 'The brief alone, with no record.' })
  row.addEventListener('click', (e) => open(r.brief ?? r.record, e))
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (r.brief && r.record) button(bar, '', (e) => open(r.record, e), { icon: 'file-text', title: 'Read the record' }).addClass('llm-wiki-small')
  row.title = r.brief ? `Opens the brief, ${r.brief}` : `Opens the record, ${r.record ?? ''}`
}

/** No report yet: say which job writes them and whether it is paused, or that nothing does. */
function noReports(parent: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const job = snapshot.jobs.find((j) => j.slug === 'ops-morning') ?? snapshot.jobs.find((j) => /morning|brief|daily.report/i.test(`${j.slug} ${j.name}`))
  if (job) {
    const card = empty(parent, 'No reports yet.', job.paused
      ? `The ${job.slug} job writes one each morning once it is resumed. It runs the wiki’s daily-report skill, which writes a record under wiki/reports/ and a brief beside it.`
      : `The ${job.slug} job writes one each morning, into wiki/reports/.`)
    button(card, 'Open the job', () => openJobModal(ctx.plugin.app, job, ctx), { icon: 'calendar-clock' })
    return
  }
  const card = empty(parent, 'No reports yet.', 'Nothing on the schedule writes one. The daily-report skill writes a morning brief: a record under wiki/reports/ and an HTML page beside it.')
  button(card, 'Ask the agent to set it up', () => ctx.act({ kind: 'ask', prompt: 'Set up the daily-report skill so this wiki gets a morning brief in wiki/reports/.' }), { icon: 'message-square' })
}
