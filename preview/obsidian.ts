// A stand-in for the `obsidian` module, enough to render the views in a browser for screenshots.
// Not shipped: esbuild aliases `obsidian` here for the preview bundle only.
/* eslint-disable */

type ElOpts = { cls?: string | string[]; text?: string; type?: string; placeholder?: string; value?: string; attr?: Record<string, string> }

function apply(el: HTMLElement, o?: ElOpts | string) {
  if (typeof o === 'string') o = { cls: o }
  if (!o) return el
  if (o.cls) el.classList.add(...(Array.isArray(o.cls) ? o.cls : o.cls.split(' ').filter(Boolean)))
  if (o.text !== undefined) el.textContent = o.text
  if (o.type) (el as HTMLInputElement).type = o.type
  if (o.placeholder) (el as HTMLInputElement).placeholder = o.placeholder
  if (o.value !== undefined) (el as HTMLInputElement).value = o.value
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, v)
  return el
}
const P = HTMLElement.prototype as any
P.createEl = function (tag: string, o?: ElOpts | string) { return this.appendChild(apply(document.createElement(tag), o)) }
P.createDiv = function (o?: ElOpts | string) { return this.createEl('div', o) }
P.createSpan = function (o?: ElOpts | string) { return this.createEl('span', o) }
P.empty = function () { this.replaceChildren() }
P.setText = function (t: string) { this.textContent = t }
P.addClass = function (...c: string[]) { this.classList.add(...c) }
P.removeClass = function (...c: string[]) { this.classList.remove(...c) }
P.toggleClass = function (c: string, on: boolean) { this.classList.toggle(c, on) }
P.hasClass = function (c: string) { return this.classList.contains(c) }
P.toggle = function (on: boolean) { this.style.display = on ? '' : 'none' }
P.hide = function () { this.style.display = 'none' }
P.show = function () { this.style.display = '' }

export function setIcon(el: HTMLElement, name: string) {
  el.replaceChildren()
  const i = document.createElement('i')
  i.setAttribute('data-lucide', name)
  el.appendChild(i)
  ;(window as any).__icons?.()
}

export class Component {
  private children: Component[] = []
  addChild<T extends Component>(c: T): T { this.children.push(c); c.load(); return c }
  removeChild<T extends Component>(c: T): T { this.children = this.children.filter((x) => x !== c); c.unload(); return c }
  load() { this.onload() }
  unload() { this.onunload() }
  onload() {}
  onunload() {}
  registerDomEvent(el: EventTarget, ev: string, fn: (e: any) => void) { el.addEventListener(ev, fn) }
  registerEvent() {}
}

export class App {
  workspace: any
  vault: any
  metadataCache: any
  constructor() {
    this.workspace = {
      on: () => ({}),
      requestSaveLayout: () => {},
      openLinkText: async (p: string) => console.log('open', p),
      getLeavesOfType: () => [],
      getActiveFile: () => null,
      trigger: () => {},
      offref: () => {},
    }
    this.vault = { adapter: {} }
    this.metadataCache = { getCache: () => null }
  }
}

export class WorkspaceLeaf { constructor(public app: App) {} }

export class ItemView extends Component {
  contentEl: HTMLElement
  app: App
  constructor(public leaf: WorkspaceLeaf) {
    super()
    this.app = leaf.app
    this.contentEl = document.createElement('div')
    this.contentEl.className = 'view-content'
  }
  getState(): any { return {} }
  async setState() {}
}

export class Plugin { app = new App(); addCommand() {} }
export class PluginSettingTab {}
export class FileSystemAdapter {}
export const debounce = (fn: any) => Object.assign((...a: any[]) => fn(...a), { cancel() {} })

export class Notice {
  constructor(text: string, ms = 4000) {
    const host = document.querySelector('.notice-container') ?? document.body.appendChild(apply(document.createElement('div'), 'notice-container'))
    const n = host.appendChild(apply(document.createElement('div'), { cls: 'notice', text }))
    setTimeout(() => n.remove(), ms)
  }
}

export class Modal {
  modalEl: HTMLElement
  contentEl: HTMLElement
  titleEl: HTMLElement
  private bg: HTMLElement
  constructor(public app: App) {
    this.bg = apply(document.createElement('div'), 'modal-container')
    this.bg.appendChild(apply(document.createElement('div'), 'modal-bg'))
    this.modalEl = this.bg.appendChild(apply(document.createElement('div'), 'modal'))
    this.titleEl = this.modalEl.appendChild(apply(document.createElement('div'), 'modal-title'))
    this.contentEl = this.modalEl.appendChild(apply(document.createElement('div'), 'modal-content'))
  }
  setTitle(t: string) { this.titleEl.textContent = t; return this }
  open() { document.body.appendChild(this.bg); this.onOpen() }
  close() { this.onClose(); this.bg.remove() }
  onOpen() {}
  onClose() {}
}

export class FuzzySuggestModal<T> extends Modal {
  getItems(): T[] { return [] }
  getItemText(_: T): string { return '' }
  onChooseItem(_: T) {}
  renderSuggestion(item: { item: T }, el: HTMLElement) { el.textContent = this.getItemText(item.item) }
  setPlaceholder(p: string) { (this as any).placeholder = p }
  onOpen() {
    this.modalEl.classList.add('prompt')
    const input = this.contentEl.createEl('input', { type: 'text', placeholder: (this as any).placeholder ?? '', cls: 'prompt-input' })
    const list = this.contentEl.createDiv({ cls: 'prompt-results' })
    for (const it of this.getItems()) {
      const row = list.createDiv({ cls: 'suggestion-item' })
      this.renderSuggestion({ item: it }, row)
      row.addEventListener('click', () => { this.close(); this.onChooseItem(it) })
    }
    input.focus()
  }
}

class ButtonComponent {
  buttonEl: HTMLButtonElement
  constructor(parent: HTMLElement) { this.buttonEl = parent.createEl('button') }
  setButtonText(t: string) { this.buttonEl.textContent = t; return this }
  setCta() { this.buttonEl.classList.add('mod-cta'); return this }
  setWarning() { this.buttonEl.classList.add('mod-warning'); return this }
  setDisabled(d: boolean) { this.buttonEl.disabled = d; return this }
  onClick(fn: () => void) { this.buttonEl.addEventListener('click', fn); return this }
}
class TextComponent {
  inputEl: HTMLInputElement
  constructor(parent: HTMLElement) { this.inputEl = parent.createEl('input', { type: 'text' }) }
  setPlaceholder(p: string) { this.inputEl.placeholder = p; return this }
  setValue(v: string) { this.inputEl.value = v; return this }
  getValue() { return this.inputEl.value }
  onChange(fn: (v: string) => void) { this.inputEl.addEventListener('input', () => fn(this.inputEl.value)); return this }
}
class DropdownComponent {
  selectEl: HTMLSelectElement
  constructor(parent: HTMLElement) { this.selectEl = parent.createEl('select', { cls: 'dropdown' }) }
  addOption(v: string, t: string) { this.selectEl.createEl('option', { value: v, text: t }); return this }
  addOptions(o: Record<string, string>) { for (const [v, t] of Object.entries(o)) this.addOption(v, t); return this }
  setValue(v: string) { this.selectEl.value = v; return this }
  getValue() { return this.selectEl.value }
  onChange(fn: (v: string) => void) { this.selectEl.addEventListener('change', () => fn(this.selectEl.value)); return this }
}

export class Setting {
  settingEl: HTMLElement
  infoEl: HTMLElement
  nameEl: HTMLElement
  descEl: HTMLElement
  controlEl: HTMLElement
  constructor(parent: HTMLElement) {
    this.settingEl = parent.createDiv({ cls: 'setting-item' })
    this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' })
    this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' })
    this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' })
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' })
  }
  setName(t: string) { this.nameEl.textContent = t; return this }
  setDesc(t: string) { this.descEl.textContent = t; return this }
  setClass(c: string) { this.settingEl.classList.add(c); return this }
  setHeading() { this.settingEl.classList.add('setting-item-heading'); return this }
  addButton(fn: (b: ButtonComponent) => void) { fn(new ButtonComponent(this.controlEl)); return this }
  addText(fn: (t: TextComponent) => void) { fn(new TextComponent(this.controlEl)); return this }
  addDropdown(fn: (d: DropdownComponent) => void) { fn(new DropdownComponent(this.controlEl)); return this }
  addToggle(fn: (t: any) => void) {
    const el = this.controlEl.createEl('input', { type: 'checkbox' })
    fn({ setValue: (v: boolean) => { el.checked = v; return this }, onChange: (f: any) => { el.addEventListener('change', () => f(el.checked)) } })
    return this
  }
}

/** A toy markdown renderer: paragraphs, headings, code fences, inline code, bold, bullets, links. */
export const MarkdownRenderer = {
  async render(_app: App, md: string, el: HTMLElement) {
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    const inline = (s: string) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[\[([^\]]+)\]\]/g, '<a class="internal-link">$1</a>')
    const out: string[] = []
    const lines = md.split('\n')
    let i = 0
    while (i < lines.length) {
      const l = lines[i]
      if (l.startsWith('```')) {
        const buf: string[] = []
        i++
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
        i++
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      } else if (/^#{1,6} /.test(l)) {
        const n = l.match(/^#+/)![0].length
        out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`)
        i++
      } else if (/^[-*] /.test(l)) {
        const items: string[] = []
        while (i < lines.length && /^[-*] /.test(lines[i])) items.push(`<li>${inline(lines[i++].slice(2))}</li>`)
        out.push(`<ul>${items.join('')}</ul>`)
      } else if (!l.trim()) i++
      else {
        const buf: string[] = []
        while (i < lines.length && lines[i].trim() && !/^(#{1,6} |[-*] |```)/.test(lines[i])) buf.push(lines[i++])
        out.push(`<p>${inline(buf.join(' '))}</p>`)
      }
    }
    el.innerHTML = out.join('')
  },
}

export class MenuItem {
  el: HTMLElement
  constructor(parent: HTMLElement) { this.el = parent.createDiv({ cls: 'menu-item' }) }
  setTitle(t: string) { this.el.createSpan({ text: t }); return this }
  setIcon(_: string) { return this }
  onClick(fn: () => unknown) { this.el.addEventListener('click', () => fn()); return this }
}
export class Menu extends Component {
  private el = apply(document.createElement('div'), 'menu')
  addItem(cb: (i: MenuItem) => unknown) { cb(new MenuItem(this.el)); return this }
  showAtMouseEvent(e: MouseEvent) {
    this.el.style.left = `${e.clientX}px`
    this.el.style.top = `${e.clientY}px`
    document.body.appendChild(this.el)
    const close = () => { this.el.remove(); document.removeEventListener('click', close) }
    setTimeout(() => document.addEventListener('click', close), 0)
    return this
  }
}
