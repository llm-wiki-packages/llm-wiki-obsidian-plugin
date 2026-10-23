import { Modal, Setting, type App } from 'obsidian'
import type { Actions, Outcome } from '../wiki/actions'
import type { SkillView, Snapshot } from '../wiki/model'
import { slotWords } from '../wiki/slots'

export interface CredentialPrompt {
  /** Replace: the name is fixed and only the value changes. */
  name?: string
  kind?: 'value' | 'dir'
  /** Set for a slot: the skill and its jobs are offered as bindings. */
  skill?: string
  slot?: string
  /** A parked ticket to retry once the credential is saved, and the job it belongs to, so the pass runs too. */
  retry?: string
  job?: string
}

const NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/

/** Save a secret or a folder for this wiki on this machine, bind it where it is needed, and get the job going, in one dialog. */
export function openCredentialModal(app: App, snapshot: Snapshot, actions: Actions, prompt: CredentialPrompt, after: (out: Outcome) => Promise<void>): void {
  const unit: SkillView | undefined = prompt.skill ? snapshot.skills.find((s) => s.name === prompt.skill) : undefined
  const replacing = Boolean(prompt.name)
  const words = prompt.slot ? slotWords(prompt.slot) : undefined
  const existing = prompt.name ? snapshot.credentials.find((c) => c.name === prompt.name) : undefined
  const stale = existing?.uses.find((u) => u.problem)?.problem ?? (existing?.state === 'failed' ? 'failed' : undefined)
  let name = prompt.name ?? (unit && words ? `${unit.name}-${words.suffix}` : '')
  let kind: 'value' | 'dir' = prompt.kind ?? words?.kind ?? 'value'
  let secret = ''
  let dir = ''
  const binds: { skill?: string; job?: string; slot: string; on: boolean; label: string }[] = []
  if (unit && prompt.slot && !replacing) {
    binds.push({ skill: unit.name, slot: prompt.slot, on: true, label: unit.jobs.length > 1 ? `${unit.name} (every job of it)` : unit.name })
    if (unit.jobs.length > 1) for (const j of unit.jobs) binds.push({ job: j, slot: prompt.slot, on: false, label: `${j} only` })
  }
  // What happens after the save: a stopped ticket is retried and run, a due job is run.
  const job = prompt.job ?? (unit?.jobs.length === 1 ? unit.jobs[0] : undefined)
  const jobView = job ? snapshot.jobs.find((j) => j.slug === job) : undefined
  // Only a job the caller named, or the skill's one job, is acted on; a guess would run the wrong mailbox.
  const then: 'retry' | 'run' | null = prompt.retry && job ? 'retry' : job && jobView && !jobView.running && !jobView.paused && (jobView.next.kind === 'due' || jobView.next.kind === 'unbound') ? 'run' : null

  const modal = new (class extends Modal {
    private error!: HTMLElement
    private valueRow!: HTMLElement
    private nameHint!: HTMLElement

    onOpen(): void {
      this.setTitle(replacing ? `Replace ${name}` : unit ? `Credential for ${unit.name}` : 'Add a credential')
      const c = this.contentEl
      c.createEl('p', { cls: 'llm-wiki-muted', text: this.sentence() })
      if (!replacing) {
        const s = new Setting(c).setName('Name').addText((t) => t.setValue(name).setPlaceholder('gmail-token').onChange((v) => (name = v.trim())))
        this.nameHint = s.descEl
      }
      if (!replacing && !words)
        new Setting(c).setName('Kind').addDropdown((d) => d.addOptions({ value: 'Secret value', dir: 'Folder on this machine' }).setValue(kind).onChange((v) => {
          kind = v === 'dir' ? 'dir' : 'value'
          this.showValue()
        }))
      this.valueRow = c.createDiv()
      this.showValue()
      if (binds.length > 1) {
        const s = new Setting(c).setName('Bind to').setDesc('The skill binding covers every job of it; a job binding overrides it for that job only.')
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
      const cta = then === 'retry' ? 'Save and retry' : then === 'run' ? 'Save and run' : binds.some((x) => x.on) ? 'Save and bind' : 'Save'
      new Setting(c)
        .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
        .addButton((b) => b.setButtonText(cta).setCta().onClick(() => void this.save(b)))
    }

    /** One sentence: what is needed, why, and what the save does next. */
    private sentence(): string {
      const parts: string[] = []
      if (replacing && kind === 'dir') parts.push(`${name} is a folder, such as a browser profile or cookie jar${stale ? `, and it is ${stale}` : ''}. Sign in again inside that profile and save, or point at a fresh folder.`)
      else if (replacing) parts.push(`${name}${stale ? ` is ${stale}` : ''}. Paste the new value; the old one is replaced.`)
      else if (unit && words) parts.push(`${unit.name} needs ${words.what} on this machine. It is stored by the CLI and never shown again.`)
      else parts.push('Stored on this machine for this wiki. The value is never shown again.')
      if (then === 'retry') parts.push(`The stopped ${jobView?.name ?? job ?? 'job'} run is retried right away.`)
      else if (then === 'run') parts.push(`${jobView?.name ?? job} runs right away.`)
      return parts.join(' ')
    }

    private showValue(): void {
      this.valueRow.empty()
      if (kind === 'value') {
        const s = new Setting(this.valueRow).setName('Secret').setDesc('Pasted here, piped to the CLI, never on a command line.')
        const field = s.controlEl.createEl('input', { type: 'password', cls: 'llm-wiki-prompt-field', placeholder: 'paste the token or key' })
        field.addEventListener('input', () => (secret = field.value))
        field.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void this.save()
        })
        window.setTimeout(() => field.focus(), 0)
      } else {
        new Setting(this.valueRow).setName('Folder').setDesc(replacing ? 'Leave empty to keep the same folder after signing in again.' : 'An absolute path; empty to let the CLI create one.').addText((t) => t.setPlaceholder('/absolute/path/to/profile').onChange((v) => (dir = v.trim())))
      }
    }

    private async save(b?: { setDisabled(d: boolean): unknown }): Promise<void> {
      this.error.setText('')
      if (!NAME.test(name)) {
        this.nameHint?.setText('Letters, digits, dots and dashes, starting with a letter or digit.')
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
      b?.setDisabled(true)
      let out = await actions.setCredential(name, kind === 'value' ? { kind, secret } : { kind, dir }, binds.filter((x) => x.on).map(({ skill, job: j, slot }) => ({ ...(skill ? { skill } : {}), ...(j ? { job: j } : {}), slot })))
      secret = ''
      if (!out.ok) {
        b?.setDisabled(false)
        this.error.setText(out.message)
        return
      }
      const bound = !binds.length || binds.some((x) => x.on)
      if (then === 'retry' && prompt.retry && job) {
        const r = await actions.retryAndRun(prompt.retry, job)
        out = { ok: r.ok, message: `${out.message}. ${r.message}` }
      } else if (then === 'run' && job && !bound) {
        out = { ok: true, message: `${out.message}; not bound anywhere, so ${job} was not run` }
      } else if (then === 'run' && job) {
        const r = await actions.runJob(job)
        out = { ok: r.ok, message: `${out.message}. ${r.message}` }
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
