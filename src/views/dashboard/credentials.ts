import { button, empty, pill, relativeTime, section } from '../../ui/dom'
import { confirm } from '../../ui/modals'
import type { CredentialView } from '../../wiki/model'
import { slotWords } from '../../wiki/slots'
import type { TabContext } from './index'

const KIND: Record<string, string> = { value: 'secret', dir: 'folder', harness: 'login' }

/** Every credential this machine holds for the wiki: name, kind and state, never a value. */
export function renderCredentials(root: HTMLElement, ctx: TabContext): void {
  const { snapshot } = ctx
  const actions = ctx.plugin.actions
  const body = section(root, 'Stored on this machine', {
    count: snapshot.credentials.length,
    actions: (bar) => button(bar, 'Add a credential…', () => ctx.plugin.credentialModal({}), { icon: 'plus' }),
  })
  body.createDiv({ cls: 'llm-wiki-muted', text: 'Held for this wiki by the llm-wiki CLI, outside the vault. A value is never shown again; a job that needs one gets it inside its own jail.' })
  if (!snapshot.credentials.length) empty(body, 'No credentials yet.', 'A skill that pulls from a signed-in service needs one; its row on the Skills tab says so once it is enabled.')
  for (const c of snapshot.credentials) credentialRow(body, c, ctx, actions)
  const missing = snapshot.skills.filter((s) => s.state === 'enabled').flatMap((s) => s.slots.filter((x) => x.credential === null && x.required).map((x) => ({ skill: s.name, slot: x.name })))
  if (!missing.length) return
  const need = section(root, 'Needed by an enabled skill', { count: missing.length })
  for (const m of missing) {
    const row = need.createDiv({ cls: 'llm-wiki-row' })
    const main = row.createDiv({ cls: 'llm-wiki-row-main' })
    main.createDiv({ cls: 'llm-wiki-row-title', text: `${m.skill} needs ${slotWords(m.slot).what}` })
    main.createDiv({ cls: 'llm-wiki-row-detail', text: `Its jobs cannot run on this machine until one is set.` })
    button(row.createDiv({ cls: 'llm-wiki-row-actions' }), 'Set credential', () => ctx.plugin.credentialModal({ skill: m.skill, slot: m.slot }), { icon: 'key-round', cta: true })
  }
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
  main.createDiv({ cls: 'llm-wiki-row-detail', text: c.kind === 'harness' ? 'Used by Ask mode and by every skill that runs a model session' : uses.length ? `Used by ${uses.join(', ')}` : 'Not used by any skill or job' })
  const bar = row.createDiv({ cls: 'llm-wiki-row-actions' })
  if (!actions) return
  if (c.kind === 'harness') {
    if (c.state === 'failed' || c.state === 'none') button(bar, 'Log in', () => ctx.write(() => actions.loginCredential(c.name)), { icon: 'log-in', cta: true })
    return
  }
  button(bar, 'Replace…', () => ctx.plugin.credentialModal({ name: c.name, kind: c.kind === 'dir' ? 'dir' : 'value' }), { icon: 'refresh-cw', cta: (c.state === 'failed' || Boolean(stale)) && c.uses.length > 0 })
  button(bar, 'Remove', async () => {
    const who = c.uses.map((u) => u.job ?? u.skill).filter(Boolean)
    const ok = await confirm(ctx.plugin.app, { title: `Remove ${c.name}?`, body: who.length ? `${who.join(', ')} will lose it and cannot run here until another credential is bound.` : 'It is not bound anywhere.', cta: 'Remove' })
    if (ok) await ctx.write(() => actions.removeCredential(c.name), true)
  }, { icon: 'trash-2' })
}
