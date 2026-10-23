import { button, empty, pill, relativeTime, section } from '../../ui/dom'
import { confirm } from '../../ui/modals'
import type { Action, CredentialView, SkillView } from '../../wiki/model'
import { unboundSlot } from '../../wiki/snapshot'
import type { TabContext } from './index'

/** The units the wiki holds and this machine loads, which Obsidian itself hides; then the credentials they spend. */
export function renderSkills(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const enabled = snapshot.skills.filter((s) => s.state === 'enabled')
  const installed = snapshot.skills.filter((s) => s.state === 'installed')
  const available = snapshot.skills.filter((s) => s.state === 'available')

  const on = section(root, 'Enabled on this machine', { count: enabled.length })
  if (!enabled.length) empty(on, 'No skill is enabled here yet.', 'A job runs only where its skill is enabled. Pick one below, or add a job and let the agent set it up.')
  for (const s of enabled) skillRow(on, s, ctx)

  if (installed.length) {
    const held = section(root, 'In the wiki, not enabled here', { count: installed.length })
    for (const s of installed) skillRow(held, s, ctx)
  }

  if (available.length) {
    const more = section(root, 'Available from the package', { count: available.length })
    more.createDiv({ cls: 'llm-wiki-muted', text: 'Not in this wiki yet. Add one and the agent installs and enables it.' })
    for (const s of available) skillRow(more, s, ctx)
  }

  renderCredentials(root, ctx)
}

/** What a click on the skill's own button should do: fix its credential, run its one job, or hand its command to chat. */
export function skillAction(s: SkillView): { label: string; icon: string; cta: boolean; action: Action | { kind: 'run-job'; slug: string } | { kind: 'jobs' } } | null {
  const slot = unboundSlot(s)
  if (s.state === 'enabled' && slot) return { label: slot.credential ? 'Replace credential' : 'Set credential', icon: 'key-round', cta: true, action: { kind: 'credential', skill: s.name, slot: slot.name, ...(slot.credential ? { name: slot.credential } : {}) } }
  if (s.state === 'enabled' && s.jobs.length === 1) return { label: 'Run job', icon: 'play', cta: false, action: { kind: 'run-job', slug: s.jobs[0]! } }
  if (s.state === 'enabled' && s.jobs.length > 1) return { label: 'Jobs', icon: 'list', cta: false, action: { kind: 'jobs' } }
  // A channel skill's usage wants a ticket only the runner has; a person runs it through a job.
  if (s.state === 'enabled' && s.usage && !/ticket=/.test(s.usage)) return { label: 'Run', icon: 'play', cta: false, action: { kind: 'ask', prompt: s.usage } }
  if (s.state === 'installed') return { label: 'Enable', icon: 'power', cta: true, action: { kind: 'ask', prompt: `/llm-wiki:enable ${s.name}` } }
  if (s.state === 'available') return { label: 'Add', icon: 'plus', cta: false, action: { kind: 'ask', prompt: `/llm-wiki:enable ${s.name}` } }
  return null
}

export function runSkillAction(a: NonNullable<ReturnType<typeof skillAction>>['action'], ctx: TabContext): Promise<void> {
  const actions = ctx.plugin.actions
  if (a.kind === 'run-job') return actions ? ctx.write(() => actions.runJob(a.slug)) : Promise.resolve()
  if (a.kind === 'jobs') {
    ctx.goTo('jobs')
    return Promise.resolve()
  }
  return ctx.act(a)
}

function skillRow(parent: HTMLElement, s: SkillView, ctx: TabContext): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row is-link' })
  row.addEventListener('click', () => void ctx.act({ kind: 'inspect', skill: s.name }))
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const title = main.createDiv({ cls: 'llm-wiki-row-title' })
  title.createSpan({ text: s.name })
  if (s.venue) title.createSpan({ cls: 'llm-wiki-muted', text: ` · ${s.venue}` })
  const p = problem(s)
  if (p) pill(title, p.text, p.tone)
  const detail = s.state === 'enabled'
    ? (s.jobs.length ? `${s.jobs.length === 1 ? 'Job' : 'Jobs'}: ${s.jobs.join(', ')}` : 'No job uses it yet.')
    : s.description || (s.state === 'installed' ? 'Enable it here to run its jobs on this machine.' : '')
  if (detail) main.createDiv({ cls: 'llm-wiki-row-detail', text: detail })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  const a = skillAction(s)
  if (a) button(bar, a.label, () => runSkillAction(a.action, ctx), { icon: a.icon, cta: a.cta })
}

/** The one pill a row earns: a broken or missing credential first, then drift, then an update. Silence means fine. */
export function problem(s: SkillView): { text: string; tone: 'warn' | 'info' } | null {
  const slot = s.state === 'enabled' ? unboundSlot(s) : undefined
  if (slot) return { text: slot.credential ? `credential ${slot.problem ?? 'broken'}` : 'credential missing', tone: 'warn' }
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
  body.createDiv({ cls: 'llm-wiki-muted', text: 'Stored on this machine for this wiki. A value is never shown again.' })
  if (!snapshot.credentials.length) empty(body, 'No credentials yet.', 'A skill that pulls from a signed-in service needs one; its row says so once it is enabled.')
  for (const c of snapshot.credentials) credentialRow(body, c, ctx, actions)
}

function credentialRow(parent: HTMLElement, c: CredentialView, ctx: TabContext, actions: TabContext['plugin']['actions']): void {
  const row = parent.createDiv({ cls: 'llm-wiki-row' })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const title = main.createDiv({ cls: 'llm-wiki-row-title' })
  title.createSpan({ text: c.name })
  title.createSpan({ cls: 'llm-wiki-muted', text: ` · ${KIND[c.kind] ?? c.kind}` })
  const stale = c.uses.find((u) => u.problem)
  if (c.state === 'failed') pill(title, 'failed', 'error')
  else if (stale) pill(title, stale.problem ?? 'stale', 'warn')
  else if (c.state === 'verified' || c.state === 'ok') pill(title, c.verified ? `verified ${relativeTime(c.verified)}` : 'verified', 'ok')
  else if (c.state === 'none') pill(title, 'empty', 'warn')
  else pill(title, 'not verified yet')
  const uses = c.uses.map((u) => u.job ?? u.skill ?? '')
  main.createDiv({ cls: 'llm-wiki-row-detail', text: c.kind === 'harness' ? 'Used by chat and by every skill that runs a model session' : uses.length ? `Used by ${uses.join(', ')}` : 'Not used by any skill or job' })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!actions) return
  if (c.kind === 'harness') {
    if (c.state === 'failed' || c.state === 'none') button(bar, 'Log in', () => ctx.write(() => actions.loginCredential(c.name)), { icon: 'log-in', cta: true })
    return
  }
  button(bar, 'Replace…', () => ctx.plugin.credentialModal({ name: c.name, kind: c.kind === 'dir' ? 'dir' : 'value' }), { icon: 'refresh-cw', cta: c.state === 'failed' || Boolean(stale) })
  button(bar, 'Remove', async () => {
    const who = c.uses.map((u) => u.job ?? u.skill).filter(Boolean)
    const ok = await confirm(ctx.plugin.app, { title: `Remove ${c.name}?`, body: who.length ? `${who.join(', ')} will lose it and cannot run here until another credential is bound.` : 'It is not bound anywhere.', cta: 'Remove' })
    if (ok) await ctx.write(() => actions.removeCredential(c.name))
  }, { icon: 'trash-2' })
}
