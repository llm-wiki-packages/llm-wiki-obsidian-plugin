import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Component, MarkdownRenderer, Modal, type App } from 'obsidian'
import type { SkillView } from '../wiki/model'
import { button, pill } from './dom'
import { problem, runSkillAction, skillAction } from '../views/dashboard/skills'
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
          main.createDiv({ cls: 'llm-wiki-row-title', text: `${slot.name} · ${slot.required ? 'required' : 'optional'}` })
          main.createDiv({ cls: 'llm-wiki-row-detail', text: slot.credential ? `${slot.credential}${slot.problem ? ` (${slot.problem})` : ''}` : 'not set' })
          if (!slot.credential || slot.problem) button(row.createDiv({ cls: 'llm-wiki-row-actions' }), slot.credential ? 'Replace credential' : 'Set credential', () => { this.close(); return ctx.act({ kind: 'credential', skill: s.name, slot: slot.name, ...(slot.credential ? { name: slot.credential } : {}) }) }, { icon: 'key-round', cta: slot.required })
        }
      }
      const facts: string[] = []
      if (s.jobs.length) facts.push(`Jobs using it: ${s.jobs.join(', ')}`)
      if (s.inputs.length) facts.push(`A new job asks for: ${s.inputs.map((i) => i.name).join(', ')}`)
      for (const w of s.warnings) facts.push(w)
      if (facts.length) {
        const ul = c.createEl('ul', { cls: 'llm-wiki-facts' })
        for (const f of facts) ul.createEl('li', { text: f })
      }

      const tabs = c.createDiv({ cls: 'llm-wiki-tabs' })
      const notes: { label: string; file: string }[] = [{ label: 'Skill', file: s.notes.skill }]
      if (s.notes.enable) notes.push({ label: 'Enabling', file: s.notes.enable })
      if (s.notes.usage) notes.push({ label: 'Usage', file: s.notes.usage })
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
      button(bar, 'Close', () => this.close())
    }

    private async show(file: string, all: HTMLButtonElement[], active: HTMLButtonElement): Promise<void> {
      for (const b of all) b.toggleClass('is-active', b === active)
      this.page.empty()
      if (!s.dir) {
        this.page.createDiv({ cls: 'llm-wiki-muted', text: s.description || 'Not installed in this wiki yet; its notes arrive with it.' })
        return
      }
      let md: string
      try {
        md = (await readFile(join(s.dir, file), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '')
      } catch {
        this.page.createDiv({ cls: 'llm-wiki-muted', text: `${s.dir}/${file} is not readable.` })
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
