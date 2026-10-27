import { button, empty, pill, section } from '../../ui/dom'
import type { Action, SkillView } from '../../wiki/model'
import { unboundSlot } from '../../wiki/snapshot'
import { slotWords } from '../../wiki/slots'
import type { TabContext } from './index'
import { slash } from '../../chat/skills'

/** The units the wiki holds and this machine loads, which Obsidian itself hides. */
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
}

/** The chat opener for a source that this skill should follow; the add skill asks the rest. */
export function addWith(s: SkillView): string {
  return `${slash('add')} a new source using the ${s.name} skill${s.inputs.length ? ` (it will need: ${s.inputs.map((i) => i.name).join(', ')})` : ''}: `
}

/** What a click on the skill's own button should do: fix its credential, run its one job, or hand its command to chat. */
export function skillAction(s: SkillView): { label: string; icon: string; cta: boolean; action: Action | { kind: 'run-job'; slug: string } | { kind: 'jobs' } } | null {
  const slot = unboundSlot(s)
  if (s.state === 'enabled' && slot) return { label: slot.credential ? 'Replace credential' : 'Set credential', icon: 'key-round', cta: true, action: { kind: 'credential', skill: s.name, slot: slot.name, ...(slot.credential ? { name: slot.credential } : {}) } }
  if (s.state === 'enabled' && s.jobs.length === 1) return { label: 'Run job', icon: 'play', cta: false, action: { kind: 'run-job', slug: s.jobs[0]! } }
  if (s.state === 'enabled' && s.jobs.length > 1) return { label: 'Jobs', icon: 'list', cta: false, action: { kind: 'jobs' } }
  // A pipeline-only skill wants a ticket only the runner has; a person runs it through a job.
  if (s.state === 'enabled' && s.usage && byHand(s)) return { label: 'Run', icon: 'play', cta: false, action: { kind: 'ask', prompt: s.usage } }
  if (s.state === 'installed') return { label: 'Enable', icon: 'power', cta: true, action: { kind: 'ask', prompt: slash('enable', s.name) } }
  if (s.state === 'available') return { label: 'Add', icon: 'plus', cta: false, action: { kind: 'ask', prompt: slash('enable', s.name) } }
  return null
}

/** Whether a person can run it: its mode says `session`; from an older CLI, its usage line wants no ticket. */
export function byHand(s: Pick<SkillView, 'mode' | 'usage'>): boolean {
  return s.mode === undefined ? !/ticket=/.test(s.usage ?? '') : (s.mode?.includes('session') ?? false)
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
  row.tabIndex = 0
  row.addEventListener('click', () => void ctx.act({ kind: 'inspect', skill: s.name }))
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void ctx.act({ kind: 'inspect', skill: s.name })
  })
  const main = row.createDiv({ cls: 'llm-wiki-row-main' })
  const title = main.createDiv({ cls: 'llm-wiki-row-title' })
  title.createSpan({ text: s.name })
  if (s.venue) title.createSpan({ cls: 'llm-wiki-muted', text: ` · ${s.venue}` })
  const p = problem(s)
  if (p) pill(title, p.text, p.tone)
  const needs = s.state === 'available' && s.slots.length ? ` Needs ${s.slots.map((x) => slotWords(x.name).what).join(' and ')}.` : ''
  const detail = s.state === 'enabled'
    ? (s.jobs.length ? `${s.jobs.length === 1 ? 'Job' : 'Jobs'}: ${s.jobs.join(', ')}` : 'No job uses it yet.')
    : (s.description || (s.state === 'installed' ? 'Enable it here to run its jobs on this machine.' : '')) + needs
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
