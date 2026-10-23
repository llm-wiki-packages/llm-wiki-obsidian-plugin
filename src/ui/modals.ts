import { Modal, Setting, type App } from 'obsidian'

export interface TextPromptOptions {
  title: string
  description?: string
  placeholder?: string
  cta?: string
  initial?: string
  multiline?: boolean
}

/** One field and one button; resolves to the text, or null when dismissed. */
export function promptText(app: App, opts: TextPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: string | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const modal = new (class extends Modal {
      onOpen(): void {
        this.setTitle(opts.title)
        if (opts.description) this.contentEl.createEl('p', { text: opts.description, cls: 'llm-wiki-muted' })
        let value = opts.initial ?? ''
        const submit = () => {
          const v = value.trim()
          if (!v) return
          done(v)
          this.close()
        }
        const field: HTMLInputElement | HTMLTextAreaElement = opts.multiline
          ? this.contentEl.createEl('textarea', { cls: 'llm-wiki-prompt-field', placeholder: opts.placeholder ?? '' })
          : this.contentEl.createEl('input', { type: 'text', cls: 'llm-wiki-prompt-field', placeholder: opts.placeholder ?? '' })
        if (field instanceof HTMLTextAreaElement) field.rows = 4
        field.value = value
        field.addEventListener('input', () => (value = field.value))
        const el: HTMLElement = field
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (!opts.multiline || e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        })
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
          .addButton((b) => b.setButtonText(opts.cta ?? 'OK').setCta().onClick(submit))
        window.setTimeout(() => field.focus(), 0)
      }

      onClose(): void {
        this.contentEl.empty()
        done(null)
      }
    })(app)
    modal.open()
  })
}
