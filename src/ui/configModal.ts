// Changing the wiki's config: one value in the control its row's type takes, a
// list one entry per line, a template rule, an indexed property. Each says the
// layer it lands in before Save. There is no choice of layer: a value is
// written back where it is set now (`targetOf`).
import { Modal, Setting, type App } from 'obsidian'
import { PROPERTY_TYPES, defaultWords, folderPattern, layerWords, parseInput, parseList, propertyName, valueWords, type ConfigRow, type Knob, type Layer, type SearchProperty } from '../wiki/config'

/** What the person chose: a value to set, or the key removed from its layer. */
export type KnobChange = { set: string } | { unset: true }

export interface KnobEditOptions {
  knob: Knob
  row: ConfigRow
  layer: Layer
}

/** Where it lands, in a sentence, and what a wiki write costs. */
export function landsIn(layer: Layer): string {
  return layer === 'wiki'
    ? 'Saved in the wiki’s own config (.llm-wiki.toml): it is committed to the wiki’s history and reaches every machine on its next sync.'
    : 'Saved in this machine’s config (.llm-wiki.local.toml), for this machine only.'
}

/** A modal that resolves once: to what Save gave, or null when dismissed. */
function asking<T>(app: App, draw: (modal: Modal, done: (v: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: T | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    new (class extends Modal {
      onOpen(): void {
        this.contentEl.addClass('llm-wiki')
        draw(this, (v) => {
          done(v)
          this.close()
        })
      }

      onClose(): void {
        this.contentEl.empty()
        done(null)
      }
    })(app).open()
  })
}

/** Cancel and Save, with Remove before them when there is something to remove. */
function buttons(c: HTMLElement, save: () => void, cancel: () => void, remove?: { label: string; run: () => void }): void {
  const bar = new Setting(c)
  if (remove) bar.addButton((b) => b.setButtonText(remove.label).setWarning().onClick(remove.run))
  bar.addButton((b) => b.setButtonText('Cancel').onClick(cancel))
  bar.addButton((b) => b.setButtonText('Save').setCta().onClick(save))
}

/** One scalar row. */
export function editKnob(app: App, opts: KnobEditOptions): Promise<KnobChange | null> {
  const { knob, row, layer } = opts
  const mine = layer in row.in
  return asking<KnobChange>(app, (m, done) => {
    m.setTitle(knob.name)
    const c = m.contentEl
    const desc = knob.desc ?? row.doc
    if (desc) c.createEl('p', { cls: 'llm-wiki-muted', text: desc })
    const now = mine ? row.in[layer] : row.value
    let raw = row.type === 'bool' ? (now === true ? 'true' : 'false') : mine ? valueWords(row.type, now) : ''
    const error = c.createDiv({ cls: 'llm-wiki-config-error' })
    const submit = () => {
      const parsed = parseInput(knob, row, raw)
      if ('error' in parsed) return void error.setText(`${knob.name} is ${parsed.error}.`)
      done({ set: parsed.value })
    }
    const field = new Setting(c).setName(knob.key).setDesc(mine ? '' : `Not set for ${layerWords(layer)}: ${valueWords(row.type, row.value) || defaultWords(knob, row)} applies.`)
    field.nameEl.addClass('llm-wiki-config-key')
    switch (row.type) {
      case 'bool':
        field.addToggle((t) => t.setValue(raw === 'true').onChange((v) => (raw = v ? 'true' : 'false')))
        break
      case 'enum':
        field.addDropdown((d) => {
          if (!mine) d.addOption('', 'Choose…')
          for (const o of row.values ?? []) if (o) d.addOption(o, o)
          d.setValue(raw).onChange((v) => (raw = v))
        })
        break
      default:
        field.addText((t) => {
          t.setValue(raw).setPlaceholder(defaultWords(knob, row)).onChange((v) => (raw = v))
          t.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          })
          window.setTimeout(() => t.inputEl.focus(), 0)
        })
    }
    c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn(layer) })
    buttons(c, submit, () => done(null), mine ? { label: `Remove for ${layerWords(layer)}`, run: () => done({ unset: true }) } : undefined)
  })
}

export interface ListEditOptions {
  title: string
  desc?: string
  /** The layer's own list now; empty when it sets none. */
  list: string[]
  layer: Layer
  placeholder?: string
  /** Shown under the box: what applies with nothing written here. */
  fallback?: string
}

/** A `list<str>` row in one layer, one entry per line. Resolves to the new list, or `null` to remove the layer's list. */
export function editList(app: App, opts: ListEditOptions): Promise<{ list: string[] | null } | null> {
  return asking<{ list: string[] | null }>(app, (m, done) => {
    m.setTitle(opts.title)
    const c = m.contentEl
    if (opts.desc) c.createEl('p', { cls: 'llm-wiki-muted', text: opts.desc })
    let raw = opts.list.join('\n')
    const error = c.createDiv({ cls: 'llm-wiki-config-error' })
    new Setting(c).setName('One per line').setClass('llm-wiki-config-list').addTextArea((t) => {
      t.setValue(raw).setPlaceholder(opts.placeholder ?? '').onChange((v) => (raw = v))
      t.inputEl.rows = 6
      window.setTimeout(() => t.inputEl.focus(), 0)
    })
    if (opts.fallback) c.createEl('p', { cls: 'llm-wiki-muted', text: opts.fallback })
    c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn(opts.layer) })
    const save = () => {
      const parsed = parseList(raw)
      if ('error' in parsed) return void error.setText(`The list takes ${parsed.error}.`)
      done({ list: parsed.value })
    }
    buttons(c, save, () => done(null), opts.list.length ? { label: `Remove for ${layerWords(opts.layer)}`, run: () => done({ list: null }) } : undefined)
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
  return asking<{ pattern: string; template: string } | { unset: true }>(app, (m, done) => {
    m.setTitle(opts.pattern === undefined ? 'Add a template rule' : `Pages in ${opts.pattern === '*' ? 'any folder' : opts.pattern}`)
    const c = m.contentEl
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
    c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn('wiki') })
    const save = () => {
      const p = folderPattern(pattern)
      if ('error' in p) return void error.setText(`The folder is ${p.error}.`)
      if (!template) return void error.setText('Choose a template.')
      done({ pattern: p.pattern, template })
    }
    buttons(c, save, () => done(null), opts.pattern !== undefined ? { label: 'Remove rule', run: () => done({ unset: true }) } : undefined)
  })
}

export interface PropertyEditOptions {
  /** The property being changed; absent when adding one. */
  property?: SearchProperty
  /** The kinds a property takes, from the CLI's rows when the wiki has one. */
  types?: string[]
  /** Names the wiki indexes already, so an added one is new. */
  taken: string[]
}

/** One `[search.properties]` entry: the frontmatter key, its kind, how it matches. */
export function editProperty(app: App, opts: PropertyEditOptions): Promise<{ property: SearchProperty } | { unset: true } | null> {
  const types = opts.types?.length ? opts.types : PROPERTY_TYPES
  return asking<{ property: SearchProperty } | { unset: true }>(app, (m, done) => {
    const was = opts.property
    m.setTitle(was ? `Indexed property ${was.name}` : 'Index a property')
    const c = m.contentEl
    c.createEl('p', { cls: 'llm-wiki-muted', text: 'The search engine stores this frontmatter key with each page, so a filter on it runs in the engine. The index picks it up on its next update.' })
    let name = was?.name ?? ''
    let type = was?.type ?? 'text'
    let match = was?.match ?? 'exact'
    let boost = was?.boost !== null && was?.boost !== undefined ? String(was.boost) : ''
    const error = c.createDiv({ cls: 'llm-wiki-config-error' })
    if (!was)
      new Setting(c).setName('Property').setDesc('The key as it is spelled in the frontmatter.').addText((t) => {
        t.setPlaceholder('Status').onChange((v) => (name = v))
        window.setTimeout(() => t.inputEl.focus(), 0)
      })
    new Setting(c).setName('Kind').addDropdown((d) => {
      for (const t of types) d.addOption(t, t)
      d.setValue(type).onChange((v) => (type = v))
    })
    new Setting(c).setName('Match').setDesc('Prefix lets a filter on projects/ match projects/alpha.').addDropdown((d) => {
      d.addOption('exact', 'Exact').addOption('prefix', 'Prefix').setValue(match).onChange((v) => (match = v))
    })
    new Setting(c).setName('Boost').setDesc('Checkbox properties only, optional: how much a page with it ticked rises in the ranking, like 1.25.').addText((t) => {
      t.setPlaceholder('None').setValue(boost).onChange((v) => (boost = v))
    })
    c.createEl('p', { cls: 'llm-wiki-muted llm-wiki-config-lands', text: landsIn('wiki') })
    const save = () => {
      const n = was ? { name: was.name } : propertyName(name)
      if ('error' in n) return void error.setText(`The property is ${n.error}.`)
      if (!was && opts.taken.includes(n.name)) return void error.setText(`${n.name} is indexed already.`)
      const b = boost.trim()
      if (b && type !== 'checkbox') return void error.setText('Only a checkbox property takes a boost.')
      if (b && !/^\d{1,4}(\.\d{1,4})?$/.test(b)) return void error.setText('The boost is a number, like 1.25.')
      done({ property: { name: n.name, type, match, boost: b ? Number(b) : null } })
    }
    buttons(c, save, () => done(null), was ? { label: 'Stop indexing', run: () => done({ unset: true }) } : undefined)
  })
}
