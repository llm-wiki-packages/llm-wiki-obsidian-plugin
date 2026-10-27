// Changing one config key: the value, in the control its kind takes, and the
// file it lands in, said before Save. There is no choice of file: a value is
// written back where it is set now (`targetOf`).
import { Modal, Setting, type App } from 'obsidian'
import { COMMITTED_FILE, LOCAL_FILE, folderPattern, parseInput, placeWords, valueWords, type Knob, type Place } from '../wiki/config'

/** What the person chose: a value to set, or the key removed from its file. */
export type KnobChange = { set: string } | { unset: true }

export interface KnobEditOptions {
  knob: Knob
  /** The value now, and whether a file sets it. */
  value: unknown
  found: boolean
  place: Place
}

/** Where it lands, in a sentence, and what a committed write costs. */
export function landsIn(place: Place): string {
  return place === 'committed'
    ? `Saved in ${COMMITTED_FILE}, the wiki’s own config: it is committed to the wiki’s history and reaches every machine on its next sync.`
    : `Saved in ${LOCAL_FILE}, for this machine only.`
}

/** Resolves to the change, or null when dismissed. */
export function editKnob(app: App, opts: KnobEditOptions): Promise<KnobChange | null> {
  const { knob } = opts
  return new Promise((resolve) => {
    let settled = false
    const done = (v: KnobChange | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    new (class extends Modal {
      onOpen(): void {
        this.setTitle(knob.name)
        const c = this.contentEl
        c.addClass('llm-wiki')
        if (knob.desc) c.createEl('p', { cls: 'llm-wiki-muted', text: knob.desc })
        let raw = opts.found ? valueWords({ type: 'text' }, opts.value) : ''
        if (knob.type === 'bool') raw = opts.value === true ? 'true' : 'false'
        const error = c.createDiv({ cls: 'llm-wiki-config-error' })
        const submit = () => {
          const parsed = parseInput(knob, raw)
          if ('error' in parsed) {
            error.setText(`${knob.name} is ${parsed.error}.`)
            return
          }
          done({ set: parsed.value })
          this.close()
        }
        const field = new Setting(c).setName(knob.key).setDesc(opts.found ? '' : `Not set: ${knob.unset}.`)
        field.nameEl.addClass('llm-wiki-config-key')
        switch (knob.type) {
          case 'bool':
            field.addToggle((t) => t.setValue(raw === 'true').onChange((v) => (raw = v ? 'true' : 'false')))
            break
          case 'enum':
            field.addDropdown((d) => {
              if (!opts.found) d.addOption('', `Choose…`)
              for (const o of knob.options ?? []) d.addOption(o, o)
              d.setValue(raw).onChange((v) => (raw = v))
            })
            break
          default:
            field.addText((t) => {
              t.setValue(raw).setPlaceholder(knob.unset).onChange((v) => (raw = v))
              t.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              })
              window.setTimeout(() => t.inputEl.focus(), 0)
            })
        }
        c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn(opts.place) })
        const bar = new Setting(c)
        if (opts.found)
          bar.addButton((b) => b.setButtonText(`Remove for ${placeWords(opts.place)}`).setWarning().onClick(() => {
            done({ unset: true })
            this.close()
          }))
        bar.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
        bar.addButton((b) => b.setButtonText('Save').setCta().onClick(submit))
      }

      onClose(): void {
        this.contentEl.empty()
        done(null)
      }
    })(app).open()
  })
}

export interface TemplateEditOptions {
  /** The folder pattern being changed; absent when adding one. */
  pattern?: string
  template?: string
  /** The template files to pick from, wiki-relative. */
  templates: string[]
  /** Folders to suggest for a new pattern. */
  folders: string[]
}

/** One row of `page.templates`: a folder and the template a new page there starts from. */
export function editTemplate(app: App, opts: TemplateEditOptions): Promise<{ pattern: string; template: string } | { unset: true } | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: { pattern: string; template: string } | { unset: true } | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    new (class extends Modal {
      onOpen(): void {
        this.setTitle(opts.pattern === undefined ? 'Add a template rule' : `Pages in ${opts.pattern === '*' ? 'any folder' : opts.pattern}`)
        const c = this.contentEl
        c.addClass('llm-wiki')
        let pattern = opts.pattern ?? ''
        let template = opts.template ?? opts.templates[0] ?? ''
        const error = c.createDiv({ cls: 'llm-wiki-config-error' })
        if (opts.pattern === undefined) {
          const listId = 'llm-wiki-config-folders'
          new Setting(c).setName('Folder').setDesc('Where the new page lands, like sources/notes. A * stands for one folder name, so sources/* is every folder in sources.').addText((t) => {
            t.setPlaceholder('sources/notes').onChange((v) => (pattern = v))
            t.inputEl.setAttribute('list', listId)
            window.setTimeout(() => t.inputEl.focus(), 0)
          })
          const list = c.createEl('datalist')
          list.id = listId
          for (const f of opts.folders) list.createEl('option', { value: f })
        }
        new Setting(c).setName('Template').addDropdown((d) => {
          const choices = opts.template && !opts.templates.includes(opts.template) ? [opts.template, ...opts.templates] : opts.templates
          for (const t of choices) d.addOption(t, t)
          d.setValue(template).onChange((v) => (template = v))
        })
        if (!opts.templates.length) c.createEl('p', { cls: 'llm-wiki-muted', text: 'The templates folder has no notes yet; add one there first.' })
        c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn('committed') })
        const bar = new Setting(c)
        if (opts.pattern !== undefined)
          bar.addButton((b) => b.setButtonText('Remove rule').setWarning().onClick(() => {
            done({ unset: true })
            this.close()
          }))
        bar.addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
        bar.addButton((b) => b.setButtonText('Save').setCta().onClick(() => {
          const p = folderPattern(pattern)
          if ('error' in p) return error.setText(`The folder is ${p.error}.`)
          if (!template) return error.setText('Choose a template.')
          done({ pattern: p.pattern, template })
          this.close()
        }))
      }

      onClose(): void {
        this.contentEl.empty()
        done(null)
      }
    })(app).open()
  })
}
