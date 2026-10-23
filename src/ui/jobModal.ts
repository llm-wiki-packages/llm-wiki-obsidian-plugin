import { Modal, type App } from 'obsidian'
import type { TabContext } from '../views/dashboard/index'
import { askAbout, jobButtons, nextText } from '../views/dashboard/jobs'
import { slotWords } from '../wiki/slots'
import type { JobView } from '../wiki/model'
import { button, clockTime, relativeTime } from './dom'

/** One job in full: what it is, what it is waiting on and why, what it needs here, and its last runs. */
export function openJobModal(app: App, j: JobView, ctx: TabContext): void {
  const modal = new (class extends Modal {
    onOpen(): void {
      this.modalEl.addClass('llm-wiki-wide')
      this.setTitle(j.name)
      const c = this.contentEl
      c.createDiv({ cls: 'llm-wiki-muted', text: [j.slug, j.kind, j.schedule, j.skill ? `skill ${j.skill}` : null].filter(Boolean).join(' · ') })

      const state = c.createDiv({ cls: 'llm-wiki-facts-block' })
      const line = state.createDiv({ cls: j.next.kind === 'unbound' ? 'llm-wiki-next' : `llm-wiki-next is-${j.next.kind}` })
      line.setText(j.running ? `Running ${j.running.stage} since ${j.running.since ? clockTime(j.running.since) : '?'} (ticket ${j.running.ticket})` : nextText(j, ctx.snapshot.runner))
      if (j.next.detail && !j.running) state.createDiv({ cls: 'llm-wiki-muted', text: j.next.detail })
      else if (j.reasons.length) state.createDiv({ cls: 'llm-wiki-muted', text: j.reasons.join('; ') })

      const unit = j.skill ? ctx.snapshot.skills.find((s) => s.name === j.skill) : undefined
      if (unit?.slots.length) {
        c.createEl('h4', { text: 'What it needs on this machine' })
        for (const slot of unit.slots) {
          const row = c.createDiv({ cls: 'llm-wiki-row' })
          const main = row.createDiv({ cls: 'llm-wiki-row-main' })
          main.createDiv({ cls: 'llm-wiki-row-title', text: `${slotWords(slot.name).label} · ${slot.required ? 'required' : 'optional'}` })
          main.createDiv({ cls: 'llm-wiki-row-detail', text: slot.credential ? `${slot.credential}${slot.problem ? ` (${slot.problem})` : ''}` : 'not set' })
          if (!slot.credential || slot.problem)
            button(row.createDiv({ cls: 'llm-wiki-row-actions' }), slot.credential ? 'Replace credential' : 'Set credential', () => { this.close(); return ctx.act({ kind: 'credential', skill: unit.name, slot: slot.name, ...(slot.credential ? { name: slot.credential } : {}) }) }, { icon: 'key-round', cta: slot.required || Boolean(slot.problem) })
        }
      }

      c.createEl('h4', { text: 'Last runs' })
      const runs = j.tickets.filter((t) => t.state !== 'pending').slice(0, 6)
      if (!runs.length) c.createDiv({ cls: 'llm-wiki-muted', text: j.last.at ? `Last ok ${relativeTime(j.last.at)}; no ticket records remain.` : 'It has not run yet.' })
      for (const t of runs) {
        const row = c.createDiv({ cls: 'llm-wiki-row' })
        row.createSpan({ cls: `llm-wiki-dot is-${t.state === 'done' ? (t.reason ? 'muted' : 'ok') : t.state === 'failed' ? 'error' : t.state === 'active' ? 'info' : 'muted'}` })
        const main = row.createDiv({ cls: 'llm-wiki-row-main' })
        main.createDiv({ cls: 'llm-wiki-row-title', text: `${t.stage} · ${t.state === 'done' ? (t.reason === 'dropped' ? 'dropped' : 'ok') : t.state === 'failed' ? 'stopped' : t.state}` })
        if (t.reason && t.reason !== 'dropped') main.createDiv({ cls: 'llm-wiki-row-detail', text: t.reason })
        const right = row.createDiv({ cls: 'llm-wiki-muted' })
        right.setText([t.at ? relativeTime(t.at) : '', t.runtimeS ? `${Math.round(t.runtimeS)}s` : ''].filter(Boolean).join(' · '))
        row.title = `ticket ${t.id}`
        if (t.state === 'failed' && ctx.plugin.actions) button(row.createDiv({ cls: 'llm-wiki-row-actions' }), 'Retry', () => { this.close(); return ctx.act({ kind: 'retry', ticket: t.id }) }, { icon: 'rotate-ccw' })
      }

      const bar = c.createDiv({ cls: 'llm-wiki-composer-buttons' })
      const wrap = bar.createDiv({ cls: 'llm-wiki-row-actions' })
      jobButtons(wrap, j, { ...ctx, write: async (run) => { this.close(); await ctx.write(run) }, act: async (a) => { this.close(); await ctx.act(a) } }, true)
      button(wrap, 'Ask the agent', () => { this.close(); return ctx.act({ kind: 'ask', prompt: askAbout(j) }) }, { icon: 'message-square' })
      button(wrap, 'Close', () => this.close())
    }

    onClose(): void {
      this.contentEl.empty()
    }
  })(app)
  modal.open()
}
