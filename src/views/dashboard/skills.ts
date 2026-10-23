import { button, empty, pill, section } from '../../ui/dom'
import { confirm } from '../../ui/modals'
import type { CredentialView, SkillView } from '../../wiki/model'
import { relativeTime } from '../../ui/dom'
import type { TabContext } from './index'

/** The units the wiki holds and this machine loads, which Obsidian itself hides; then the credentials they spend. */
export function renderSkills(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const enabled = snapshot.skills.filter((s) => s.state === 'enabled')
  const installed = snapshot.skills.filter((s) => s.state === 'installed')
  const available = snapshot.skills.filter((s) => s.state === 'available')

  const on = section(root, 'Enabled on this machine', { count: enabled.length })
  if (!enabled.length) empty(on, 'No skill is enabled here yet.', 'A job runs only where its skill is enabled. Enable one below, or add a job and let the agent set it up.')
  for (const s of enabled) skillRow(on, s, ctx)

  if (installed.length) {
    const held = section(root, 'In the wiki, not enabled here', { count: installed.length })
    for (const s of installed) skillRow(held, s, ctx)
  }

  if (available.length) {
    const more = section(root, 'Available from the package', { count: available.length })
    more.createDiv({ cls: 'llm-wiki-muted', text: 'Not in this wiki yet. Pick one and the agent installs and enables it.' })
    const names = more.createDiv({ cls: 'llm-wiki-chip-list' })
    for (const s of available) {
      const chip = names.createEl('button', { cls: 'llm-wiki-chip', text: s.name, attr: { title: `Ask the agent to install and enable ${s.name}` } })
      chip.addEventListener('click', () => void ctx.act({ kind: 'ask', prompt: `/llm-wiki:enable ${s.name}` }))
    }
  }

  renderCredentials(root, ctx)
}

function skillRow(parent: HTMLElement, s: SkillView, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const title = main.createDiv({ cls: 'llm-wiki-row-title' })
  title.createSpan({ text: s.name })
  if (s.venue) title.createSpan({ cls: 'llm-wiki-muted', text: ` · ${s.venue}` })
  const p = problem(s)
  if (p) pill(title, p.text, p.tone)
  const detail = s.jobs.length ? `${s.jobs.length === 1 ? 'Job' : 'Jobs'}: ${s.jobs.join(', ')}` : s.state === 'installed' ? 'Enable it here to run its jobs on this machine.' : s.state === 'enabled' ? 'No job uses it yet.' : ''
  if (detail) main.createDiv({ cls: 'llm-wiki-row-detail', text: detail })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  const missing = s.slots.find((x) => x.required && (x.credential === null || x.problem))
  const actions = ctx.plugin.actions
  if (s.state === 'enabled' && missing) button(bar, 'Set credential', () => ctx.act({ kind: 'credential', skill: s.name, slot: missing.name }), { icon: 'key-round', cta: true })
  else if (s.state === 'enabled' && s.jobs.length === 1 && actions) {
    // A channel skill runs through its job; its usage line wants a ticket only the runner has.
    const slug = s.jobs[0]!
    button(bar, 'Run job', () => ctx.write(() => actions.runJob(slug)), { icon: 'play', title: `llm-wiki-ops jobs request ${slug}` })
  } else if (s.state === 'enabled' && s.jobs.length > 1) button(bar, 'Jobs', () => ctx.goTo('jobs'), { icon: 'list' })
  else if (s.state === 'enabled' && s.usage && !/ticket=/.test(s.usage)) button(bar, 'Run', () => ctx.act({ kind: 'ask', prompt: s.usage ?? '' }), { icon: 'play', title: 'Open chat with this skill’s command' })
  if (s.state === 'installed') button(bar, 'Enable', () => ctx.act({ kind: 'ask', prompt: `/llm-wiki:enable ${s.name}` }), { icon: 'power', cta: true })
  button(bar, 'Inspect', () => ctx.act({ kind: 'inspect', skill: s.name }), { icon: 'file-text' })
}

/** The one pill a row earns: a missing credential first, then drift, then an update. Silence means fine. */
export function problem(s: SkillView): { text: string; tone: 'warn' | 'info' } | null {
  const missing = s.slots.filter((x) => x.required && (x.credential === null || x.problem)).length
  if (missing && s.state === 'enabled') return { text: missing === 1 ? 'credential missing' : `${missing} credentials missing`, tone: 'warn' }
  if (s.drifted) return { text: 'differs from the wiki', tone: 'warn' }
  if (s.outdated) return { text: 'update available', tone: 'info' }
  return null
}

const KIND: Record<string, string> = { value: 'secret', dir: 'folder', harness: 'login' }

function renderCredentials(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const actions = ctx.plugin.actions
  const body = section(root, 'Credentials', {
    count: snapshot.credentials.length,
    actions: (bar) => button(bar, 'Add a credential…', () => ctx.plugin.credentialModal({}), { icon: 'plus' }),
  })
  body.createDiv({ cls: 'llm-wiki-muted', text: 'What the skills and their jails may use on this machine. Names and states only; a value is never shown again.' })
  if (!snapshot.credentials.length) empty(body, 'No credentials yet.', 'A skill that pulls from a signed-in service needs one; it asks when it is enabled.')
  for (const c of snapshot.credentials) credentialRow(body, c, ctx, actions)
}

function credentialRow(parent: HTMLElement, c: CredentialView, ctx: TabContext, actions: TabContext['plugin']['actions']): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const title = main.createDiv({ cls: 'llm-wiki-row-title' })
  title.createSpan({ text: c.name })
  title.createSpan({ cls: 'llm-wiki-muted', text: ` · ${KIND[c.kind] ?? c.kind}` })
  if (c.state === 'failed') pill(title, 'failed', 'error')
  else if (c.state === 'verified' || c.state === 'ok') pill(title, c.verified ? `verified ${relativeTime(c.verified)}` : 'verified', 'ok')
  else if (c.state === 'none') pill(title, 'empty', 'warn')
  const uses = c.uses.map((u) => `${u.job ?? u.skill ?? ''}${u.problem ? ` (${u.problem})` : ''}`)
  main.createDiv({ cls: 'llm-wiki-row-detail', text: uses.length ? `Used by ${uses.join(', ')}` : 'Not used by any skill or job' })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!actions) return
  if (c.kind === 'harness') {
    if (c.state === 'failed' || c.state === 'unverified' || c.state === 'none') button(bar, 'Log in', () => ctx.write(() => actions.loginCredential(c.name)), { icon: 'log-in' })
    return
  }
  button(bar, 'Replace…', () => ctx.plugin.credentialModal({ name: c.name, kind: c.kind === 'dir' ? 'dir' : 'value' }), { icon: 'refresh-cw' })
  button(bar, 'Remove', async () => {
    const who = c.uses.map((u) => u.job ?? u.skill).filter(Boolean)
    const ok = await confirm(ctx.plugin.app, { title: `Remove ${c.name}?`, body: who.length ? `${who.join(', ')} will lose it and cannot run here until another credential is bound.` : 'It is not bound anywhere.', cta: 'Remove' })
    if (ok) await ctx.write(() => actions.removeCredential(c.name))
  }, { icon: 'trash-2' })
}
