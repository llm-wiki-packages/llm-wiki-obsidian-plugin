// The `llm-wiki-ops` verbs that only read, as permission rules Ask first runs
// without asking: a lookup the brain skills make a dozen times a turn is no
// more a decision than a Read. Mirrors the CLI's registry (`Registration.writes`
// false, ops 0.9.0) until the wiki's seeded `.claude/settings.json` carries
// the list itself (llm-wiki-plugins #3695).

/** Read verbs, by their full path. `hooks *` is left out: a hook's verbs run on the harness's behalf. */
export const READ_VERBS = [
  'agents ls', 'config get', 'denylist check', 'denylist ls', 'doctor',
  'git changed', 'git conflicts', 'git log',
  'guard', 'inboxes fixes ls', 'inboxes info', 'inboxes ls',
  'jobs due', 'jobs ls', 'jobs show', 'local ls',
  'op latest', 'op log', 'op logs', 'op show', 'op since',
  'packages ls', 'packages show',
  'page history', 'page lint', 'page ls', 'page read', 'page template', 'page diff',
  'policy get', 'policy ls', 'reference',
  'sandboxes check', 'sandboxes login-check', 'sandboxes ls', 'sandboxes show', 'sandboxes why',
  'search query', 'search status', 'skills doctor', 'skills ls', 'skills search',
  'status', 'tickets ls', 'tickets open', 'tickets show', 'tickets wait', 'version', 'whereami',
] as const

/** The groups, so `llm-wiki-ops <group> --help` reads too. */
const GROUPS = [...new Set(READ_VERBS.map((v) => v.split(' ')[0]!))]

/**
 * Claude Code permission rules for the read verbs, with and without the
 * global `--json` in front. A prefix rule matches one command of a compound
 * line, so `… | head -60` still has its other half judged on its own.
 */
export function readRules(): string[] {
  const rules = ['Bash(llm-wiki-ops --help:*)', 'Bash(llm-wiki-ops --version:*)']
  for (const v of READ_VERBS) rules.push(`Bash(llm-wiki-ops ${v}:*)`, `Bash(llm-wiki-ops --json ${v}:*)`)
  for (const g of GROUPS) rules.push(`Bash(llm-wiki-ops ${g} --help:*)`)
  return rules
}
