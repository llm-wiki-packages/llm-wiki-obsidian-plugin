// More > Config: the wiki's config as this machine reads it, which file says
// each value, and a way to change the ones a single key changes. A setup that
// takes more than a key (an engine to install, search's own table) goes to the
// agent. The plugin's own settings are a click away, and point back here.
import { TFile, TFolder } from 'obsidian'
import { button, empty, pill, section } from '../../ui/dom'
import { editKnob, editTemplate } from '../../ui/configModal'
import { CliError } from '../../wiki/cli'
import { KNOBS, SEARCH_GROUP, knobKeys, placeOf, readAll, spellKey, targetOf, templateRows, valueWords, type ConfigValue, type Knob, type KnobGroup } from '../../wiki/config'
import { layout } from '../../wiki/layout'
import type { SearchStatus } from '../../wiki/model'
import type { TabContext } from './index'

type Read = ConfigValue | { error: string }
const VALUES = 'config.values'
const LOADING = 'config.loading'

/** Read every key once, then again only when asked or after a change. */
function load(ctx: TabContext, keys = knobKeys()): void {
  const { cli, wiki } = ctx.plugin
  if (!cli || !wiki || ctx.memo[LOADING]) return
  ctx.memo[LOADING] = true
  const get = (key: string) => cli.run<ConfigValue>('wiki.config.get', { wiki: wiki.key, configKey: key }).catch((e: unknown) => {
    throw new Error(e instanceof CliError ? e.short : String(e))
  })
  void readAll(keys, get)
    .then((got) => {
      ctx.memo[VALUES] = { ...(ctx.memo[VALUES] as Record<string, Read> | undefined), ...got }
    })
    .finally(() => {
      ctx.memo[LOADING] = false
      ctx.redraw()
    })
}

export function renderConfig(root: HTMLElement, ctx: TabContext): void {
  const values = ctx.memo[VALUES] as Record<string, Read> | undefined
  const top = root.createDiv({ cls: 'llm-wiki-config-intro' })
  top.createDiv({ cls: 'llm-wiki-muted', text: 'The wiki’s settings as this machine reads them: what applies, and whether the wiki or this machine sets it. A change is saved where the value is set now.' })
  const bar = top.createDiv({ cls: 'llm-wiki-row-actions' })
  button(bar, 'Plugin settings', () => ctx.plugin.openSettings(), { icon: 'settings', title: 'How Obsidian’s Brain plugin behaves: chat, search, saving edits' })
  button(bar, 'Read again', () => load(ctx), { icon: 'refresh-cw' })
  if (!values) {
    load(ctx)
    root.createDiv({ cls: 'llm-wiki-notice', text: 'Reading the config…' })
    return
  }
  for (const g of KNOBS) group(root, g, values, ctx)
}

function group(root: HTMLElement, g: KnobGroup, values: Record<string, Read>, ctx: TabContext): void {
  const templates = g.knobs.find((k) => k.type === 'map')
  const body = section(root, g.heading, { actions: (bar) => {
    if (templates && ctx.plugin.actions) button(bar, 'Add a rule…', () => void changeTemplate(ctx, templates, undefined, undefined), { icon: 'plus' })
    if (g.chat) button(bar, g.chat.label, () => ctx.act({ kind: 'ask', prompt: ask(g.chat!.ask, values, ctx.snapshot.search) }), { icon: 'message-square' })
  } })
  if (g.desc) body.createDiv({ cls: 'llm-wiki-muted llm-wiki-config-desc', text: g.desc })
  if (g.id === SEARCH_GROUP) return searchRows(body, ctx.snapshot.search)
  for (const k of g.knobs) {
    const v = values[k.key]
    if (k.type === 'map') templateList(body, k, v, ctx)
    else knobRow(body, k, v, ctx)
  }
}

/** Where a value comes from, as a pill: the wiki's file, this machine's, or neither. */
function sourcePill(parent: HTMLElement, source: string | null | undefined): void {
  const place = placeOf(source)
  const el = pill(parent, place === 'committed' ? 'wiki' : place === 'local' ? 'this machine' : 'default', place === 'committed' ? 'info' : 'muted')
  el.addClass('llm-wiki-config-source', `is-${place ?? 'unset'}`)
  el.title = place === 'committed' ? 'Set in .llm-wiki.toml, which every machine reads' : place === 'local' ? 'Set in .llm-wiki.local.toml, for this machine only' : 'Set in neither file'
}

function knobRow(parent: HTMLElement, k: Knob, v: Read | undefined, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row llm-wiki-config-row' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  main.createDiv({ cls: 'llm-wiki-row-title', text: k.name })
  if (k.desc) main.createDiv({ cls: 'llm-wiki-row-detail', text: k.desc })
  main.title = k.key
  const side = row.createDiv({ cls: 'llm-wiki-config-side' })
  if (!v) return void side.createSpan({ cls: 'llm-wiki-muted', text: '…' })
  if ('error' in v) {
    side.createSpan({ cls: 'llm-wiki-muted', text: 'could not read' }).title = v.error
    return
  }
  side.createSpan({ cls: `llm-wiki-config-value${v.found ? '' : ' is-unset'}`, text: v.found ? valueWords(k, v.value) : k.unset })
  sourcePill(side, v.source)
  const actions = ctx.plugin.actions
  if (k.edit !== 'value' || !actions) return
  button(side, '', async () => {
    const place = targetOf(k, v.source)
    const change = await editKnob(ctx.plugin.app, { knob: k, value: v.value, found: v.found, place })
    if (!change) return
    await ctx.write(() => ('set' in change ? actions.setConfig(k.key, change.set, place, k.name) : actions.unsetConfig(k.key, place, k.name)))
    load(ctx, [k.key])
  }, { icon: 'pencil', title: `Change ${k.name.toLowerCase()}` })
}

function templateList(parent: HTMLElement, k: Knob, v: Read | undefined, ctx: TabContext): void {
  if (!v) return void parent.createDiv({ cls: 'llm-wiki-muted', text: '…' })
  if ('error' in v) return void parent.createDiv({ cls: 'llm-wiki-muted', text: `Could not read the templates: ${v.error}` })
  const rows = templateRows(v.value)
  if (!rows.length) return void empty(parent, 'No templates: a new page starts empty.')
  for (const r of rows) {
    const row = parent.createDiv({ cls: 'llm-wiki-row llm-wiki-config-row' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: r.pattern === '*' ? 'Any other folder' : r.pattern })
    const side = row.createDiv({ cls: 'llm-wiki-config-side' })
    side.createSpan({ cls: 'llm-wiki-config-value', text: r.template })
    sourcePill(side, v.source)
    if (ctx.plugin.actions) button(side, '', () => void changeTemplate(ctx, k, r.pattern, r.template), { icon: 'pencil', title: 'Change or remove' })
  }
}

async function changeTemplate(ctx: TabContext, k: Knob, pattern: string | undefined, template: string | undefined): Promise<void> {
  const actions = ctx.plugin.actions
  if (!actions) return
  const { templates, folders } = vaultChoices(ctx)
  const change = await editTemplate(ctx.plugin.app, { pattern, template, templates, folders })
  if (!change) return
  const folder = (p: string) => (p === '*' ? 'Template for any folder' : `Template for ${p}`)
  if ('unset' in change) {
    if (pattern === undefined) return
    await ctx.write(() => actions.unsetConfig(spellKey([...k.key.split('.'), pattern]), 'committed', folder(pattern)))
  } else {
    await ctx.write(() => actions.setConfig(spellKey([...k.key.split('.'), change.pattern]), change.template, 'committed', folder(change.pattern)))
  }
  load(ctx, [k.key])
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

function searchRows(parent: HTMLElement, s: SearchStatus | null): void {
  if (!s) return void parent.createDiv({ cls: 'llm-wiki-muted', text: 'The search status could not be read.' })
  const line = (name: string, value: string, detail?: string) => {
    const row = parent.createDiv({ cls: 'llm-wiki-row llm-wiki-config-row' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: name })
    if (detail) main.createDiv({ cls: 'llm-wiki-row-detail', text: detail })
    row.createDiv({ cls: 'llm-wiki-config-side' }).createSpan({ cls: 'llm-wiki-config-value', text: value })
  }
  const backends = s.backends ?? []
  line('Answers from', backends.map((b) => `${backendName(b.name)}${b.available === false ? ' (unavailable)' : ''}`).join(', then ') || '—',
    s.serving ? `Answering now: ${backendName(s.serving)}.` : undefined)
  line('Searched folders', patterns(s.paths) || '—', 'Pages outside these folders are not searched.')
  line('Not indexed', patterns(s.not_indexed) || 'none', 'Searched by grep only, kept out of the search engine.')
  const props = s.properties ?? []
  line('Indexed properties', props.map((p) => `${p.key} (${p.type}${p.match === 'prefix' ? ', prefix' : ''})`).join(', ') || 'none',
    'Frontmatter the search engine stores, so a property filter runs there. Any other property still filters, more slowly.')
}

function backendName(name: string): string {
  return name === 'search_server' ? 'the search engine' : name
}

/** A path list, each local one marked: `paths` adds this machine's to the wiki's. */
function patterns(list: { pattern: string; origin?: string }[] | undefined): string {
  return (list ?? []).map((p) => (p.origin === 'local' ? `${p.pattern} (this machine)` : p.pattern)).join(', ')
}

/** What the agent is asked, with what applies now, so it starts from the same page as the person. */
function ask(what: string, values: Record<string, Read>, s: SearchStatus | null): string {
  const now = (key: string) => {
    const v = values[key]
    if (!v || 'error' in v) return 'unknown'
    return v.found ? `${valueWords({ type: 'text' }, v.value)} (in ${v.source})` : 'not set'
  }
  if (what === 'transcribe') {
    return [
      'Help me set up transcription on this machine. Right now [transcribe] has',
      ['engine', 'diarize_supported', 'model', 'device', 'language'].map((k) => `${k}: ${now(`transcribe.${k}`)}`).join('; ') + '.',
      'Check what this machine can run (the transcribe skill’s check_requirements script), tell me which engine fits and whether it can label speakers, and ask me before changing anything.',
      'Keep each value in the file it is set in now; a new one goes in .llm-wiki.local.toml.',
    ].join(' ')
  }
  const props = (s?.properties ?? []).map((p) => `${p.key} (${p.type}${p.match === 'prefix' ? ', prefix' : ''})`).join(', ') || 'none'
  return [
    'Help me change this wiki’s search setup, the [search] table. Right now:',
    `backends ${(s?.backends ?? []).map((b) => b.name).join(', ') || 'unknown'};`,
    `searched folders ${patterns(s?.paths) || 'unknown'};`,
    `not indexed ${patterns(s?.not_indexed) || 'none'};`,
    `indexed properties ${props}.`,
    'Ask me what I want to change. Keep each value in the file it is set in now (search status says which), [search.properties] stays in .llm-wiki.toml,',
    'and tell me whether the index needs rebuilding afterwards.',
  ].join(' ')
}
