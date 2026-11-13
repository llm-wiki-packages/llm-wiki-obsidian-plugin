// The Why? panel: where each lent value on a page comes from, the page's own
// part, and what the next write would change (`page explain`). Read-only.
import { Keymap, Modal } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { rootName } from '../vault/lends'
import { CliError } from '../wiki/cli'
import { explainLines, type ExplainAnswer } from '../wiki/explain'

export function openExplain(plugin: LlmWikiPlugin, path: string): void {
  new ExplainModal(plugin, path).open()
}

class ExplainModal extends Modal {
  constructor(private readonly plugin: LlmWikiPlugin, private readonly path: string) {
    super(plugin.app)
    this.modalEl.addClass('llm-wiki', 'llm-wiki-explain-modal')
  }

  onOpen(): void {
    this.setTitle(`Where ${this.path.split('/').at(-1)?.replace(/\.md$/, '') ?? this.path} gets its values`)
    void this.draw()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  /** A root's name that opens it; a modifier click opens it in a new tab. */
  private rootLink(parent: HTMLElement, root: string): void {
    const a = parent.createEl('a', { cls: 'llm-wiki-explain-root', text: rootName(root), attr: { href: '#', 'aria-label': root } })
    a.addEventListener('click', (e) => {
      e.preventDefault()
      const file = this.app.vault.getFileByPath(root)
      if (!file) return
      this.close()
      void this.app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(file)
    })
  }

  private async draw(): Promise<void> {
    const { cli, wiki } = this.plugin
    const el = this.contentEl
    el.empty()
    if (!cli || !wiki) {
      el.createDiv({ cls: 'llm-wiki-muted', text: this.plugin.problem ?? 'The wiki has not been found yet.' })
      return
    }
    const wait = el.createDiv({ cls: 'llm-wiki-muted', text: 'Reading…' })
    let a: ExplainAnswer
    try {
      a = await cli.run<ExplainAnswer>('wiki.page.explain', { wiki: wiki.key, path: this.path })
    } catch (e) {
      wait.setText(e instanceof CliError ? e.message : String(e))
      return
    }
    wait.remove()
    const { keys, notes } = explainLines(a)
    if (!a.chain?.length && !keys.length) {
      el.createDiv({ cls: 'llm-wiki-muted', text: 'No bundle root above this page, and no lent value on it.' })
      return
    }
    if (a.chain?.length) {
      const chain = el.createDiv({ cls: 'llm-wiki-explain-chain' })
      chain.createDiv({ cls: 'llm-wiki-explain-label', text: a.chain.length === 1 ? 'The root above this page' : 'The roots above this page, nearest first' })
      for (const r of a.chain) {
        const row = chain.createDiv({ cls: 'llm-wiki-explain-chain-row' })
        this.rootLink(row, r.root)
        row.createSpan({ cls: 'llm-wiki-muted', text: r.lends.length ? ` lends ${r.lends.join(', ')}` : ' lends nothing' })
      }
    }
    if (keys.length) {
      const t = el.createEl('table', { cls: 'llm-wiki-table llm-wiki-explain-keys' })
      const head = t.createEl('thead').createEl('tr')
      for (const h of ['Key', 'On this page', 'Comes from', 'The next write']) head.createEl('th', { text: h })
      const body = t.createEl('tbody')
      for (const k of keys) {
        const tr = body.createEl('tr')
        tr.createEl('td', { cls: 'llm-wiki-explain-key', text: k.key })
        tr.createEl('td', { text: k.value })
        const from = tr.createEl('td')
        for (const f of k.from) {
          const line = from.createDiv()
          line.createSpan({ text: `${f.what} ` })
          if (f.root) {
            line.createSpan({ cls: 'llm-wiki-muted', text: 'from ' })
            this.rootLink(line, f.root)
          } else line.createSpan({ cls: 'llm-wiki-muted', text: 'this page’s own' })
        }
        tr.createEl('td', { cls: k.replaces ? 'llm-wiki-explain-replaces' : k.next ? '' : 'llm-wiki-muted', text: k.next ?? 'Nothing' })
      }
    }
    for (const n of notes) el.createDiv({ cls: 'llm-wiki-explain-note', text: n })
  }
}
