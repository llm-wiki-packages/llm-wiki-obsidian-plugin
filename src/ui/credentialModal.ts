import { Modal, Setting, type App } from 'obsidian'
import type { Actions, Outcome } from '../wiki/actions'
import type { SkillView, Snapshot } from '../wiki/model'

export interface CredentialPrompt {
  /** Replace: the name is fixed and only the value changes. */
  name?: string
  kind?: 'value' | 'dir'
  /** Set for a slot: the skill and its jobs are offered as bindings. */
  skill?: string
  slot?: string
}

const NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/

/** Save a secret or a folder for this wiki on this machine, and bind it where it is needed, in one dialog. */
export function openCredentialModal(app: App, snapshot: Snapshot, actions: Actions, prompt: CredentialPrompt, after: (out: Outcome) => Promise<void>): void {
  const unit: SkillView | undefined = prompt.skill ? snapshot.skills.find((s) => s.name === prompt.skill) : undefined
  const replacing = Boolean(prompt.name)
  let name = prompt.name ?? (unit && prompt.slot ? `${unit.name}-${prompt.slot}` : '')
  let kind: 'value' | 'dir' = prompt.kind ?? 'value'
  let secret = ''
  let dir = ''
  const binds: { skill?: string; job?: string; slot: string; on: boolean; label: string }[] = []
  if (unit && prompt.slot && !replacing) {
    binds.push({ skill: unit.name, slot: prompt.slot, on: true, label: `${unit.name} (every job of it)` })
    for (const j of unit.jobs) binds.push({ job: j, slot: prompt.slot, on: false, label: `${j} only` })
  }

  const modal = new (class extends Modal {
    private error!: HTMLElement
    private valueRow!: HTMLElement

    onOpen(): void {
      this.setTitle(replacing ? `Replace ${name}` : unit ? `Credential for ${unit.name}` : 'Add a credential')
      const c = this.contentEl
      c.createEl('p', { cls: 'llm-wiki-muted', text: unit && prompt.slot ? `The skill's ${prompt.slot} slot is empty on this machine. The value goes to the CLI's own store and is never shown again.` : 'Stored for this wiki on this machine. The value is never shown again.' })
      if (!replacing)
        new Setting(c).setName('Name').setDesc('Letters, digits, dots, dashes.').addText((t) => t.setValue(name).setPlaceholder('gmail-token').onChange((v) => (name = v.trim())))
      if (!replacing)
        new Setting(c).setName('Kind').addDropdown((d) => d.addOptions({ value: 'Secret value', dir: 'Folder on this machine' }).setValue(kind).onChange((v) => {
          kind = v === 'dir' ? 'dir' : 'value'
          this.showValue()
        }))
      this.valueRow = c.createDiv()
      this.showValue()
      if (binds.length) {
        const s = new Setting(c).setName('Bind to').setDesc('Where this credential fills the slot. The skill binding covers every job of it; a job binding overrides it for that job only.')
        s.settingEl.addClass('llm-wiki-setting-column')
        const list = s.controlEl.createDiv({ cls: 'llm-wiki-check-list' })
        for (const b of binds) {
          const label = list.createEl('label', { cls: 'llm-wiki-check' })
          const box = label.createEl('input', { type: 'checkbox' })
          box.checked = b.on
          box.addEventListener('change', () => (b.on = box.checked))
          label.createSpan({ text: b.label })
        }
      }
      this.error = c.createDiv({ cls: 'llm-wiki-error' })
      new Setting(c)
        .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
        .addButton((b) => b.setButtonText(binds.some((x) => x.on) ? 'Save and bind' : 'Save').setCta().onClick(() => void this.save(b)))
    }

    private showValue(): void {
      this.valueRow.empty()
      if (kind === 'value') {
        const s = new Setting(this.valueRow).setName('Secret').setDesc('Pasted here, piped to the CLI, never on a command line.')
        const field = s.controlEl.createEl('input', { type: 'password', cls: 'llm-wiki-prompt-field', placeholder: 'paste the token or key' })
        field.addEventListener('input', () => (secret = field.value))
        window.setTimeout(() => field.focus(), 0)
      } else {
        new Setting(this.valueRow).setName('Folder').setDesc('An absolute path; empty to let the CLI create one. A browser profile, a cookie jar, a config directory.').addText((t) => t.setPlaceholder('/Users/you/Library/…').onChange((v) => (dir = v.trim())))
      }
    }

    private async save(b: { setDisabled(d: boolean): unknown }): Promise<void> {
      this.error.setText('')
      if (!NAME.test(name)) {
        this.error.setText('The name is letters, digits, dots and dashes, starting with a letter or digit.')
        return
      }
      if (kind === 'value' && !secret) {
        this.error.setText('Paste the secret first.')
        return
      }
      if (kind === 'dir' && dir && !dir.startsWith('/')) {
        this.error.setText('A folder is an absolute path.')
        return
      }
      b.setDisabled(true)
      const out = await actions.setCredential(name, kind === 'value' ? { kind, secret } : { kind, dir }, binds.filter((x) => x.on).map(({ skill, job, slot }) => ({ ...(skill ? { skill } : {}), ...(job ? { job } : {}), slot })))
      secret = ''
      if (!out.ok) {
        b.setDisabled(false)
        this.error.setText(out.message)
        return
      }
      this.close()
      await after(out)
    }

    onClose(): void {
      secret = ''
      this.contentEl.empty()
    }
  })(app)
  modal.open()
}
