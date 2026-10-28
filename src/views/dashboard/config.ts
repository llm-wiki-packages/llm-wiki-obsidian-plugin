// More > Config: the wiki's config as this machine reads it, which layer says
// each value, and a way to change the ones the tab can. A setup that takes
// more than a value (an engine to install, a search backend) goes to the
// agent. The plugin's own settings are a click away, and point back here.
import { TFile, TFolder } from 'obsidian'
import { button, empty, pill, section } from '../../ui/dom'
import { editKnob, editList, editProperty, editTemplate } from '../../ui/configModal'
import { CliError } from '../../wiki/cli'
import {
  KNOBS, SEARCH_GROUP, SEARCH_PATHS, SEARCH_PROPERTIES, TEMPLATES, defaultWords, patchOf, propertyRows, propertyWords, sourceOf, spellKey, targetOf, templateRows, valueWords,
  type ConfigRow, type ConfigRows, type Knob, type KnobGroup, type Layer,
} from '../../wiki/config'
import { layout } from '../../wiki/layout'
import type { SearchStatus } from '../../wiki/model'
import type { TabContext } from './index'

type Read = ConfigRows | { error: string }
type Rows = Record<string, ConfigRow>
const VALUES = 'config.rows'
const LOADING = 'config.loading'

/** One `config get` answers every row; read once, then again when asked or after a change. */
function load(ctx: TabContext): void {
  const { cli, wiki } = ctx.plugin
  if (!cli || !wiki || ctx.memo[LOADING]) return
  ctx.memo[LOADING] = true
  void cli.run<ConfigRows>('wiki.config.get', { wiki: wiki.key })
    .then((got) => (ctx.memo[VALUES] = got), (e: unknown) => (ctx.memo[VALUES] = { error: e instanceof CliError ? e.short : String(e) }))
    .finally(() => {
      ctx.memo[LOADING] = false
      ctx.redraw()
    })
}

export function renderConfig(root: HTMLElement, ctx: TabContext): void {
  const read = ctx.memo[VALUES] as Read | undefined
  const top = root.createDiv({ cls: 'llm-wiki-config-intro' })
  top.createDiv({ cls: 'llm-wiki-muted', text: 'The wiki’s settings as this machine reads them: what applies, and whether the wiki or this machine sets it. A change is saved where the value is set now.' })
  const bar = top.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Plugin settings', () => ctx.plugin.openSettings(), { icon: 'settings', title: 'How Obsidian’s Brain plugin behaves: chat, search, saving edits' })
  button(bar, 'Read again', () => load(ctx), { icon: 'refresh-cw' })
  if (!read) {
    load(ctx)
    root.createDiv({ cls: 'llm-wiki-notice', text: 'Reading the config…' })
    return
  }
  if ('error' in read) return void root.createDiv({ cls: 'llm-wiki-notice', text: `Could not read the config: ${read.error}` })
  for (const [layer, why] of Object.entries(read.problems ?? {}))
    if (why) root.createDiv({ cls: 'llm-wiki-notice', text: `${layer === 'wiki' ? 'The wiki’s config (.llm-wiki.toml)' : 'This machine’s config (.llm-wiki.local.toml)'} did not parse, so none of it applies: ${why}` })
  for (const g of KNOBS) group(root, g, read.rows, ctx)
}

function group(root: HTMLElement, g: KnobGroup, rows: Rows, ctx: TabContext): void {
  const body = section(root, g.heading, { actions: (bar) => {
    if (!ctx.plugin.actions) return
    if (g.knobs.some((k) => k.key === TEMPLATES)) button(bar, 'Add a rule…', () => void changeTemplate(ctx, undefined, undefined), { icon: 'plus' })
    if (g.knobs.some((k) => k.key === SEARCH_PROPERTIES)) button(bar, 'Index a property…', () => void changeProperty(ctx, rows, undefined), { icon: 'plus' })
    if (g.chat) button(bar, g.chat.label, () => ctx.act({ kind: 'ask', prompt: ask(g.chat!.ask, rows, ctx.snapshot.search) }), { icon: 'message-square' })
  } })
  if (g.desc) body.createDiv({ cls: 'llm-wiki-muted llm-wiki-config-desc', text: g.desc })
  if (g.id === SEARCH_GROUP) backendsRow(body, ctx.snapshot.search)
  for (const k of g.knobs) {
    const row = rows[k.key]
    if (!row) {
      line(body, k.name, k.desc).createSpan({ cls: 'llm-wiki-muted', text: 'not known to this CLI' })
      continue
    }
    if (k.key === TEMPLATES) templateList(body, row, ctx)
    else if (k.key === SEARCH_PROPERTIES) propertyList(body, k, row, rows, ctx)
    else if (k.key === SEARCH_PATHS) pathRows(body, k, row, ctx)
    else if (row.type === 'list<str>') listRow(body, k, row, rows, ctx)
    else knobRow(body, k, row, rows, ctx)
  }
}

/** A row's name and detail on the left; returns the right side, for the value. */
function line(parent: HTMLElement, name: string, detail?: string, key?: string): HTMLElement {
  const row = parent.createDiv({ cls: 'llm-wiki-row llm-wiki-config-row' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: name })
  if (detail) main.createDiv({ cls: 'llm-wiki-row-detail', text: detail })
  if (key) main.title = key
  return row.createDiv({ cls: 'llm-wiki-config-side' })
}

/** Which layer a value comes from, as a pill: the wiki's, this machine's, both, or neither. */
function sourcePill(parent: HTMLElement, source: Layer | 'both' | null, over?: boolean): void {
  const words = { wiki: 'wiki', local: 'this machine', both: 'wiki + this machine' } as const
  const el = pill(parent, source ? words[source] : 'default', source === 'wiki' ? 'info' : 'muted')
  el.addClass('llm-wiki-config-source', `is-${source ?? 'unset'}`)
  el.title = source === 'wiki' ? 'Set in the wiki’s config, which every machine reads'
    : source === 'local' ? `Set in this machine’s config${over ? ', over the wiki’s own value' : ''}`
    : source === 'both' ? 'The wiki’s list, with what this machine adds'
    : 'Set in neither layer: the default applies'
}

function value(side: HTMLElement, row: ConfigRow, knob: Knob): void {
  const set = sourceOf(row) !== null
  const text = set ? valueWords(row.type, row.value) || '—' : defaultWords(knob, row)
  side.createSpan({ cls: `llm-wiki-config-value${set ? '' : ' is-unset'}`, text })
}

/** A pencil for a knob the tab edits, when some layer may hold it. */
function pencil(side: HTMLElement, k: Knob, row: ConfigRow, rows: Rows, ctx: TabContext, open: (layer: Layer) => Promise<void>): void {
  const layer = targetOf(k, rows)
  if (k.edit !== 'value' || !ctx.plugin.actions || !layer) {
    if (row.why) side.title = `Not changed from here: ${row.why}`
    return
  }
  button(side, '', () => void open(layer), { icon: 'pencil', title: `Change ${k.name.toLowerCase()}` })
}

function knobRow(parent: HTMLElement, k: Knob, row: ConfigRow, rows: Rows, ctx: TabContext): void {
  const side = line(parent, k.name, k.desc ?? row.doc, k.key)
  value(side, row, k)
  sourcePill(side, sourceOf(row), 'wiki' in row.in)
  pencil(side, k, row, rows, ctx, async (layer) => {
    const actions = ctx.plugin.actions
    const change = await editKnob(ctx.plugin.app, { knob: k, row, layer })
    if (!change || !actions) return
    await ctx.write(() => ('set' in change ? actions.setConfig(k.key, change.set, layer, k.name) : actions.unsetConfig(k.key, layer, k.name)))
    load(ctx)
  })
}

/** A list the layers replace, edited where it is set now. */
function listRow(parent: HTMLElement, k: Knob, row: ConfigRow, rows: Rows, ctx: TabContext): void {
  const side = line(parent, k.name, k.desc ?? row.doc, k.key)
  value(side, row, k)
  sourcePill(side, sourceOf(row), 'wiki' in row.in)
  pencil(side, k, row, rows, ctx, (layer) => changeList(ctx, k, row, layer, k.name))
}

/** `search.paths` is a union: the wiki's list, and what this machine adds, each its own row. */
function pathRows(parent: HTMLElement, k: Knob, row: ConfigRow, ctx: TabContext): void {
  const wiki = row.in.wiki as string[] | undefined
  const local = row.in.local as string[] | undefined
  const shared = line(parent, k.name, k.desc ?? row.doc, k.key)
  shared.createSpan({ cls: `llm-wiki-config-value${wiki ? '' : ' is-unset'}`, text: valueWords(row.type, wiki ?? row.default) || '—' })
  sourcePill(shared, wiki ? 'wiki' : null)
  if (ctx.plugin.actions && row.writable_in.includes('wiki')) button(shared, '', () => void changeList(ctx, k, row, 'wiki', k.name), { icon: 'pencil', title: 'Change the wiki’s folders' })
  const mine = line(parent, 'Also searched on this machine', 'Folders only this checkout searches, added to the wiki’s.')
  mine.createSpan({ cls: `llm-wiki-config-value${local?.length ? '' : ' is-unset'}`, text: local?.length ? valueWords(row.type, local) : 'none' })
  if (local) sourcePill(mine, 'local')
  if (ctx.plugin.actions && row.writable_in.includes('local')) button(mine, '', () => void changeList(ctx, k, row, 'local', 'This machine’s folders'), { icon: 'pencil', title: 'Change this machine’s folders' })
}

async function changeList(ctx: TabContext, k: Knob, row: ConfigRow, layer: Layer, name: string): Promise<void> {
  const actions = ctx.plugin.actions
  if (!actions) return
  const own = row.in[layer]
  const union = row.combine === 'union'
  const change = await editList(ctx.plugin.app, {
    title: name,
    desc: k.desc ?? row.doc,
    list: Array.isArray(own) ? own.map(String) : [],
    layer,
    placeholder: Array.isArray(row.default) ? row.default.map(String).join('\n') : undefined,
    fallback: union && layer === 'local' ? undefined : `With no list here: ${layer === 'local' && 'wiki' in row.in ? `the wiki’s, ${valueWords(row.type, row.in.wiki) || 'none'}` : `the default, ${valueWords(row.type, row.default) || 'none'}`}.`,
  })
  if (!change) return
  const did = change.list === null ? `${name} removed` : `${name}: ${change.list.join(', ') || 'none'}`
  await ctx.write(() => actions.patchConfig(patchOf(k.key.split('.'), change.list), layer, did, name))
  load(ctx)
}

function templateList(parent: HTMLElement, row: ConfigRow, ctx: TabContext): void {
  const rules = templateRows(row.value)
  if (!rules.length) return void empty(parent, 'No templates: a new page starts empty.')
  for (const r of rules) {
    const side = line(parent, r.pattern === '*' ? 'Any other folder' : r.pattern)
    side.createSpan({ cls: 'llm-wiki-config-value', text: r.template })
    sourcePill(side, 'wiki')
    if (ctx.plugin.actions) button(side, '', () => void changeTemplate(ctx, r.pattern, r.template), { icon: 'pencil', title: 'Change or remove' })
  }
}

async function changeTemplate(ctx: TabContext, pattern: string | undefined, template: string | undefined): Promise<void> {
  const actions = ctx.plugin.actions
  if (!actions) return
  const { templates, folders } = vaultChoices(ctx)
  const change = await editTemplate(ctx.plugin.app, { pattern, template, templates, folders })
  if (!change) return
  const folder = (p: string) => (p === '*' ? 'Template for any folder' : `Template for ${p}`)
  const key = (p: string) => spellKey([...TEMPLATES.split('.'), p])
  if ('unset' in change) {
    if (pattern === undefined) return
    await ctx.write(() => actions.unsetConfig(key(pattern), 'wiki', folder(pattern)))
  } else {
    await ctx.write(() => actions.setConfig(key(change.pattern), change.template, 'wiki', folder(change.pattern)))
  }
  load(ctx)
}

function propertyList(parent: HTMLElement, k: Knob, row: ConfigRow, rows: Rows, ctx: TabContext): void {
  const props = propertyRows(row.value)
  line(parent, k.name, k.desc ?? row.doc, k.key).createSpan({ cls: 'llm-wiki-config-value is-unset', text: props.length ? '' : 'none' })
  for (const p of props) {
    const side = line(parent, p.name, undefined, spellKey([...SEARCH_PROPERTIES.split('.'), p.name]))
    side.parentElement?.addClass('is-sub')
    side.createSpan({ cls: 'llm-wiki-config-value', text: propertyWords(p) })
    sourcePill(side, 'wiki')
    if (ctx.plugin.actions) button(side, '', () => void changeProperty(ctx, rows, p.name), { icon: 'pencil', title: 'Change or stop indexing' })
  }
}

async function changeProperty(ctx: TabContext, rows: Rows, name: string | undefined): Promise<void> {
  const actions = ctx.plugin.actions
  if (!actions) return
  const props = propertyRows(rows[SEARCH_PROPERTIES]?.value)
  // The kinds come from a row the wiki already has; `editProperty` falls back to the CLI's list.
  const types = Object.entries(rows).find(([k]) => k.startsWith(`${SEARCH_PROPERTIES}.`) && k.endsWith('.type'))?.[1].values
  const change = await editProperty(ctx.plugin.app, { property: props.find((p) => p.name === name), types, taken: props.map((p) => p.name) })
  if (!change) return
  const at = (n: string) => ['search', 'properties', n]
  if ('unset' in change) {
    if (name === undefined) return
    await ctx.write(() => actions.patchConfig(patchOf(at(name), null), 'wiki', `${name} is no longer indexed`, name))
  } else {
    const p = change.property
    await ctx.write(() => actions.patchConfig(patchOf(at(p.name), { type: p.type, match: p.match, boost: p.boost }), 'wiki', `${p.name} is indexed as ${propertyWords(p)}`, p.name))
  }
  load(ctx)
}

/** The notes under the templates folder, and the vault's folders outside the machinery, for the pickers. */
function vaultChoices(ctx: TabContext): { templates: string[]; folders: string[] } {
  const prefix = `${layout().templates}/`
  const templates: string[] = []
  const folders: string[] = []
  for (const f of ctx.plugin.app.vault.getAllLoadedFiles()) {
    if (f instanceof TFile && f.path.endsWith('.md') && f.path.startsWith(prefix)) templates.push(f.path)
    else if (f instanceof TFolder && f.path !== '/' && !`${f.path}/`.startsWith(prefix) && !f.path.split('/').some((s) => s.startsWith('.') || s.startsWith('_'))) folders.push(f.path)
  }
  return { templates: templates.sort(), folders: folders.sort() }
}

/** What runs, from `search status`: the backends in order, and which answers now. Changing them is setup, for the agent. */
function backendsRow(parent: HTMLElement, s: SearchStatus | null): void {
  const backends = s?.backends ?? []
  const side = line(parent, 'Answers from', s?.serving ? `Answering now: ${backendName(s.serving)}.` : undefined, 'search.backends')
  side.createSpan({ cls: 'llm-wiki-config-value', text: backends.map((b) => `${backendName(b.name)}${b.available === false ? ' (unavailable)' : ''}`).join(', then ') || '—' })
}

function backendName(name: string): string {
  return name === 'search_server' ? 'the search engine' : name
}

/** What the agent is asked, with what applies now, so it starts from the same page as the person. */
function ask(what: string, rows: Rows, s: SearchStatus | null): string {
  const now = (key: string) => {
    const r = rows[key]
    if (!r) return 'unknown'
    const from = sourceOf(r)
    return from ? `${valueWords(r.type, r.value)} (set ${from === 'wiki' ? 'in the wiki’s config' : from === 'local' ? 'on this machine' : 'in both'})` : 'not set'
  }
  if (what === 'transcribe') {
    return [
      'Help me set up transcription on this machine. Right now [transcribe] has',
      ['engine', 'diarize_supported', 'model', 'device', 'language'].map((k) => `${k}: ${now(`transcribe.${k}`)}`).join('; ') + '.',
      'Check what this machine can run (the transcribe skill’s check_requirements script), tell me which engine fits and whether it can label speakers, and ask me before changing anything.',
      'Change it with llm-wiki-ops config set, keeping each value in the layer it is set in now; a new one goes in this machine’s (--local).',
    ].join(' ')
  }
  return [
    'Help me change this wiki’s search setup. Right now:',
    `backends ${(s?.backends ?? []).map((b) => b.name).join(', ') || now('search.backends')};`,
    `searched folders ${now(SEARCH_PATHS)};`,
    `not indexed ${now('search.not_indexed')};`,
    `indexed properties ${propertyRows(rows[SEARCH_PROPERTIES]?.value).map((p) => `${p.name} (${propertyWords(p)})`).join(', ') || 'none'}.`,
    'Ask me what I want to change. Change it with llm-wiki-ops config set, keeping each value in the layer it is set in now (config get search says which),',
    'and tell me whether the index needs updating or rebuilding afterwards.',
  ].join(' ')
}
