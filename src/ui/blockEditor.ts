// Job-owned blocks in the editor (llm-wiki-plugins #4188): a block belongs to its writer, and the writer's next
// landing writes its own text there, setting a person's edit aside to `_versions/` and listing it in `ops.set_aside`.
// So the editor tints each block and names its writer, warns once when a person starts editing one, keeps an
// `edits=discard` block read-only, and offers the diff against the text a landing set aside.
import { ChangeSet, EditorState, StateEffect, StateField, Transaction, type ChangeSpec, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { editorInfoField, MarkdownView, Modal, Notice, TFile, type App } from 'obsidian'
import type LlmWikiPlugin from '../main'
import { blockText, bodyOf, lineDiff, parseBlocks, setAsideByBlock, setAsideOf, type Block, type SetAside } from '../vault/blocks'
import { button, relativeTime } from './dom'

/** A fence run, a marker, or a frontmatter delimiter on a line: a change there may move what is a block. */
const STRUCTURE = /<!--|`{3}|~{3}|^\s*-{2,}\s*$/

/**
 * Whether a change leaves every block where it was: no line added or removed, nothing typed or deleted that could make
 * or break a marker or a fence, on a line that holds neither. Then the blocks are kept, not parsed again.
 */
export function keepsBlocks(tr: Transaction): boolean {
  let keeps = true
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!keeps) return
    const changed = tr.startState.doc.sliceString(fromA, toA) + inserted.toString()
    if (/[\n<>`~\ufeff]/.test(changed)) keeps = false
    else if (STRUCTURE.test(tr.startState.doc.lineAt(fromA).text) || STRUCTURE.test(tr.state.doc.lineAt(fromB).text) || STRUCTURE.test(tr.state.doc.lineAt(toB).text)) keeps = false
  })
  return keeps
}

/** The blocks of the document, parsed again on a change that may move them. */
export const blocksField = StateField.define<Block[]>({
  create: (state) => parseBlocks(state.doc.toString()),
  update: (value, tr) => (!tr.docChanged || keepsBlocks(tr) ? value : parseBlocks(tr.newDoc.toString())),
})

/** The page's metadata moved (a landing wrote `ops.set_aside`): redraw the labels. */
export const refreshBlocks = StateEffect.define<null>()

/** A person typing, deleting, pasting or dragging; never a reload of the file from disk, which is the CLI's write. */
export function personEdit(tr: Transaction): boolean {
  return tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move')
}

/** The block's character span: from its opening marker's first character to its closing marker's last. */
function span(doc: Text, b: Block): { start: number; end: number } {
  return { start: doc.line(b.first + 1).from, end: doc.line(b.last + 1).to }
}

/**
 * Whether one change, `[from, to)` in `doc` replaced by `text`, reaches into the block or breaks its markers. A change
 * inside the block reaches it; one at its edge reaches it only when, after it, the opening marker no longer starts its
 * line or the closing marker no longer ends its line. So a line typed above or below a block, or an empty line beside
 * it deleted, is outside it; text typed onto a marker line, or a line joined onto one, is not.
 */
export function reaches(doc: Text, b: Block, from: number, to: number, text = ''): boolean {
  const { start, end } = span(doc, b)
  if (from < end && to > start) return true
  if (from === to && from > start && from < end) return true
  if (to === start) {
    // What will stand right before the opening marker: the end of the text put in, or what is left before `from`.
    const before = text ? text.at(-1) : from > 0 ? doc.sliceString(from - 1, from) : '\n'
    return before !== '\n'
  }
  if (from === end) {
    const after = text ? text[0] : to < doc.length ? doc.sliceString(to, to + 1) : '\n'
    return after !== '\n'
  }
  return false
}

/** The blocks a transaction's changes reach, read off the document before them. */
export function reached(tr: Transaction): Block[] {
  const blocks = tr.startState.field(blocksField, false) ?? []
  if (!blocks.length) return []
  const hit = new Set<Block>()
  tr.changes.iterChanges((from, to, _fb, _tb, inserted) => {
    for (const b of blocks) if (reaches(tr.startState.doc, b, from, to, inserted.toString())) hit.add(b)
  })
  return [...hit]
}

/**
 * The transaction with every change that reaches a read-only block dropped and the rest kept, or null when none
 * does. A multi-cursor edit or a replace-all keeps its other changes.
 */
export function withoutReadOnly(tr: Transaction): { kept: ChangeSpec[]; hit: Block } | null {
  const blocks = (tr.startState.field(blocksField, false) ?? []).filter((b) => b.discard)
  if (!blocks.length) return null
  const kept: ChangeSpec[] = []
  let hit: Block | null = null
  tr.changes.iterChanges((from, to, _fb, _tb, inserted) => {
    const text = inserted.toString()
    const into = blocks.filter((b) => reaches(tr.startState.doc, b, from, to, text))
    if (into.length) hit = innermost([...(hit ? [hit] : []), ...into])
    else kept.push({ from, to, insert: text })
  })
  return hit ? { kept, hit } : null
}

/** The innermost of several blocks reached: the one whose writer rewrites the text typed. */
function innermost(blocks: Block[]): Block | null {
  return blocks.reduce<Block | null>((best, b) => (!best || b.first >= best.first ? b : best), null)
}

function fileOf(state: EditorState): TFile | null {
  return state.field(editorInfoField, false)?.file ?? null
}

/** The once-per-session notices, keyed by page and block. */
class Said {
  private readonly keys = new Set<string>()
  first(key: string): boolean {
    if (this.keys.has(key)) return false
    this.keys.add(key)
    return true
  }
}

class Label extends WidgetType {
  constructor(
    private readonly plugin: LlmWikiPlugin,
    private readonly block: Block,
    private readonly aside: SetAside | null,
    private readonly path: string | null,
  ) {
    super()
  }

  eq(other: Label): boolean {
    return other.block.address === this.block.address && other.block.discard === this.block.discard && other.aside?.path === this.aside?.path && other.path === this.path
  }

  toDOM(view: EditorView): HTMLElement {
    const el = createSpan({ cls: `llm-wiki-block-label${this.block.discard ? ' is-discard' : ''}` })
    el.createSpan({ text: this.block.writer, attr: { title: ownerWords(this.block) } })
    if (this.block.discard) el.createSpan({ cls: 'llm-wiki-block-tag', text: 'read-only' })
    if (this.aside) {
      const b = el.createEl('button', { cls: 'llm-wiki-block-aside', text: 'Your edit was set aside: compare' })
      b.title = `${this.aside.path}${this.aside.at ? `, ${relativeTime(this.aside.at)}` : ''}`
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        openSetAside(this.plugin, view, this.block.address, this.aside!)
      })
    }
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}

/** What a block's owner does to a person's edit, in one sentence. */
export function ownerWords(b: Pick<Block, 'writer' | 'discard'>): string {
  return b.discard
    ? `${b.writer} generates this block whole: an edit here is dropped on its next run, so it is read-only.`
    : `${b.writer} owns this block: its next run writes its own text here, and your edit is set aside in _versions/.`
}

function decorations(plugin: LlmWikiPlugin, view: EditorView): DecorationSet {
  const { state } = view
  const blocks = state.field(blocksField, false) ?? []
  if (!blocks.length) return Decoration.none
  const file = fileOf(state)
  const fm = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : undefined
  const asides = setAsideByBlock(setAsideOf(fm), blocks)
  const ranges = []
  for (const b of blocks) {
    for (let n = b.first; n <= b.last; n++) {
      const edge = n === b.first ? ' is-first' : n === b.last ? ' is-last' : ''
      ranges.push(Decoration.line({ class: `llm-wiki-block${b.discard ? ' is-discard' : ''}${edge}` }).range(state.doc.line(n + 1).from))
    }
    ranges.push(Decoration.widget({ widget: new Label(plugin, b, asides.get(b.address) ?? null, file?.path ?? null), side: 1 }).range(state.doc.line(b.first + 1).to))
  }
  return Decoration.set(ranges, true)
}

/** The editor extension: the blocks, their tint and labels, the warning, and the read-only rule. */
export function blockExtension(plugin: LlmWikiPlugin): Extension {
  const warned = new Said()
  const refused = new Said()
  const highlight = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorations(plugin, view)
      }
      update(u: ViewUpdate): void {
        const moved = u.startState.field(blocksField, false) !== u.state.field(blocksField, false)
        if (moved || u.transactions.some((t) => t.effects.some((e) => e.is(refreshBlocks)))) this.decorations = decorations(plugin, u.view)
        else if (u.docChanged) this.decorations = this.decorations.map(u.changes)
      }
    },
    { decorations: (v) => v.decorations },
  )
  // An `edits=discard` block takes no person's edit: the next run would drop it anyway. Undo and redo pass: refusing
  // one would leave it at the top of the history, and every later undo would be refused with it.
  const readOnly = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !personEdit(tr)) return tr
    const out = withoutReadOnly(tr)
    if (!out) return tr
    const key = `${fileOf(tr.startState)?.path ?? ''}#${out.hit.address}`
    if (refused.first(key)) new Notice(`${ownerWords(out.hit)} Edit the page around it instead.`, 8000)
    if (!out.kept.length) return []
    const event = tr.annotation(Transaction.userEvent)
    // Each cursor follows its own kept insert, as the person's edit would have left it.
    const changes = ChangeSet.of(out.kept, tr.startState.doc.length)
    return { changes, selection: tr.startState.selection.map(changes, 1), effects: tr.effects, ...(event ? { userEvent: event } : {}), scrollIntoView: tr.scrollIntoView }
  })
  // The first edit a person makes in a block a writer owns gets one notice, per page and block, per session.
  const warn = EditorView.updateListener.of((u) => {
    for (const tr of u.transactions) {
      if (!tr.docChanged || !personEdit(tr)) continue
      const b = innermost(reached(tr).filter((x) => !x.discard))
      if (!b) continue
      const key = `${fileOf(tr.startState)?.path ?? ''}#${b.address}`
      if (warned.first(key)) new Notice(ownerWords(b), 10_000)
    }
  })
  return [blocksField, highlight, readOnly, warn]
}

/** Every open editor on `path` redraws its labels: the page's `ops.set_aside` may have changed. */
export function refreshEditors(app: App, path: string): void {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view
    if (!(view instanceof MarkdownView) || view.file?.path !== path) continue
    const cm = (view.editor as unknown as { cm?: EditorView }).cm
    cm?.dispatch({ effects: refreshBlocks.of(null) })
  }
}

/** The text a writer's landing set aside, against the block as it reads now. */
function openSetAside(plugin: LlmWikiPlugin, view: EditorView, address: string, aside: SetAside): void {
  new SetAsideModal(plugin.app, view, address, aside).open()
}

class SetAsideModal extends Modal {
  constructor(app: App, private readonly view: EditorView, private readonly address: string, private readonly aside: SetAside) {
    super(app)
    this.modalEl.addClass('llm-wiki', 'llm-wiki-diff-modal')
  }

  onOpen(): void {
    void this.draw()
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private async draw(): Promise<void> {
    const el = this.contentEl
    const { app, aside, address } = this
    const block = (this.view.state.field(blocksField, false) ?? []).find((b) => b.address === address)
    this.setTitle(`Your edit to ${block?.writer ?? address}`)
    el.createDiv({ cls: 'llm-wiki-muted', text: `${block?.writer ?? 'The writer'} wrote its own text here${aside.at ? ` ${relativeTime(aside.at)}` : ''}, and set yours aside in ${aside.path}.` })
    const file = app.vault.getAbstractFileByPath(aside.path)
    if (!(file instanceof TFile)) {
      el.createDiv({ cls: 'llm-wiki-notice', text: `${aside.path} is not in the vault yet; sync, then try again.` })
      return
    }
    const mine = bodyOf(await app.vault.cachedRead(file))
    const blocks = this.view.state.field(blocksField, false) ?? []
    const theirs = block ? blockText(this.view.state.doc.toString(), block, blocks) : ''
    const hunk = el.createDiv({ cls: 'llm-wiki-diff-hunk' })
    const diff = lineDiff(mine, theirs)
    if (diff.every((d) => d.kind === 'same')) hunk.createDiv({ cls: 'llm-wiki-diff-at', text: 'Your text and the block read the same now.' })
    for (const d of diff) {
      const row = hunk.createDiv({ cls: `llm-wiki-diff-line is-block${d.kind === 'mine' ? ' is-removed' : d.kind === 'theirs' ? ' is-added' : ''}` })
      row.createSpan({ cls: 'llm-wiki-diff-sign', text: d.kind === 'mine' ? '−' : d.kind === 'theirs' ? '+' : ' ' })
      row.createSpan({ cls: 'llm-wiki-diff-text', text: d.text })
    }
    el.createDiv({ cls: 'llm-wiki-muted', text: '− your text, set aside · + the block as the writer left it. Copy back what you need, outside the block: the writer owns its block.' })
    const bar = el.createDiv({ cls: 'llm-wiki-row-actions llm-wiki-diff-foot' })
    button(bar, 'Open your text', async () => {
      this.close()
      await app.workspace.getLeaf('tab').openFile(file)
    }, { icon: 'file-text' })
    button(bar, 'Close', () => this.close())
  }
}

/** Wires the extension into every Markdown editor, and redraws labels when a page's metadata moves. */
export function registerBlocks(plugin: LlmWikiPlugin): void {
  plugin.registerEditorExtension(blockExtension(plugin))
  plugin.registerEvent(plugin.app.metadataCache.on('changed', (file) => refreshEditors(plugin.app, file.path)))
}
