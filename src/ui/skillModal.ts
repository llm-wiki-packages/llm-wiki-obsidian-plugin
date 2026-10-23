import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Component, MarkdownRenderer, Modal, type App } from 'obsidian'
import type { SkillView } from '../wiki/model'
import { button, pill } from './dom'
import { addWith, problem, runSkillAction, skillAction } from '../views/dashboard/skills'
import { slotWords } from '../wiki/slots'
import type { TabContext } from '../views/dashboard/index'

/** Everything about one unit in one place: what it needs here, which jobs use it, and the notes Obsidian cannot show. */
export function openSkillModal(app: App, s: SkillView, ctx: TabContext): void {
  const modal = new (class extends Modal {
    private readonly renderer = new Component()
    private page!: HTMLElement

    onOpen(): void {
      this.modalEl.addClass('llm-wiki-wide')
      this.setTitle(s.name)
      const c = this.contentEl
      const head = c.createDiv({ cls: 'llm-wiki-muted' })
      head.setText([s.state === 'enabled' ? 'enabled on this machine' : s.state === 'installed' ? 'in the wiki, not enabled here' : 'available from its package', s.version, s.from].filter(Boolean).join(' · '))
      const p = problem(s)
      if (p) pill(head, p.text, p.tone)
      if (s.description) c.createEl('p', { text: s.description })

      if (s.slots.length) {
        c.createEl('h4', { text: 'What it needs on this machine' })
        for (const slot of s.slots) {
          const row = c.createDiv({ cls: 'llm-wiki-row' })
          const main = row.createDiv({ cls: 'llm-wiki-row-main' })
          main.createDiv({ cls: 'llm-wiki-row-title', text: `${slotWords(slot.name).label} · ${slot.required ? 'required' : 'optional'}` })
          main.createDiv({ cls: 'llm-wiki-row-detail', text: slot.credential ? `${slot.credential}${slot.problem ? ` (${slot.problem})` : ''}` : 'not set' })
          if (!slot.credential || slot.problem) button(row.createDiv({ cls: 'llm-wiki-row-actions' }), slot.credential ? 'Replace credential' : 'Set credential', () => { this.close(); return ctx.act({ kind: 'credential', skill: s.name, slot: slot.name, ...(slot.credential ? { name: slot.credential } : {}) }) }, { icon: 'key-round', cta: slot.required })
        }
      }
      const facts: [string, string][] = []
      if (s.jobs.length) facts.push(['Jobs using it', s.jobs.join(', ')])
      if (s.inputs.length) facts.push(['A new job asks for', s.inputs.map((i) => i.name).join(', ')])
      for (const w of s.warnings) facts.push(['Note', w])
      for (const [k, v] of facts) {
        const row = c.createDiv({ cls: 'llm-wiki-row' })
        const main = row.createDiv({ cls: 'llm-wiki-row-main' })
        main.createDiv({ cls: 'llm-wiki-row-title', text: k })
        main.createDiv({ cls: 'llm-wiki-row-detail', text: v })
      }

      const notes: { label: string; file: string }[] = [{ label: 'Skill', file: s.notes.skill }]
      if (s.notes.enable) notes.push({ label: 'Enabling', file: s.notes.enable })
      if (s.notes.usage) notes.push({ label: 'Usage', file: s.notes.usage })
      const tabs = c.createDiv({ cls: 'llm-wiki-tabs' })
      if (notes.length < 2) tabs.hide()
      const buttons = notes.map((n) => {
        const b = tabs.createEl('button', { cls: 'llm-wiki-tab', text: n.label })
        b.addEventListener('click', () => void this.show(n.file, buttons, b))
        return b
      })
      this.page = c.createDiv({ cls: 'llm-wiki-note-page markdown-rendered' })
      void this.show(s.notes.skill, buttons, buttons[0]!)

      const bar = c.createDiv({ cls: 'llm-wiki-composer-buttons' })
      const a = skillAction(s)
      if (a) button(bar, s.state === 'available' ? 'Install and enable' : a.label, () => { this.close(); return runSkillAction(a.action, ctx) }, { icon: a.icon, cta: a.cta })
      if (s.state !== 'available') button(bar, 'Add a source with it', () => { this.close(); return ctx.act({ kind: 'ask', prompt: addWith(s) }) }, { icon: 'plus' })
      button(bar, 'Close', () => this.close())
    }

    private async show(file: string, all: HTMLButtonElement[], active: HTMLButtonElement): Promise<void> {
      for (const b of all) b.toggleClass('is-active', b === active)
      this.page.empty()
      let md: string
      try {
        if (!s.dir) throw new Error('no directory')
        md = (await readFile(join(s.dir, file), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '')
      } catch {
        // The description above already says what it is; an unreadable note adds nothing.
        this.page.hide()
        return
      }
      await MarkdownRenderer.render(app, md, this.page, '', this.renderer)
    }

    onClose(): void {
      this.renderer.unload()
      this.contentEl.empty()
    }
  })(app)
  modal.open()
}
