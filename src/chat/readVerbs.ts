// The `llm-wiki-ops` verbs that only read, as permission rules Ask first runs
// without asking: a lookup the brain skills make a dozen times a turn is no
// more a decision than a Read. Mirrors the CLI's registry (`Registration.writes`
// false, ops 0.18.0) until the wiki's seeded `.claude/settings.json` carries
// the list itself (llm-wiki-plugins #3695).

/**
 * Read verbs, by their full path. `hooks *` is left out: a hook's verbs run on the harness's behalf. `page decisions` is
 * left out too: the registry calls it a read, but its `--write` rebuilds a page, and a prefix rule would allow that.
 */
export const READ_VERBS = [
  'agents list', 'config get', 'config lint', 'config list', 'denylist check', 'denylist list', 'doctor',
  'engines list', 'engines show', 'extract',
  'git changed', 'git conflicts', 'git log', 'git status',
  'guard', 'inboxes fixes list', 'inboxes info', 'inboxes list',
  'jobs check', 'jobs due', 'jobs list', 'jobs show', 'local list',
  'op latest', 'op log', 'op logs', 'op show', 'op since',
  'packages list', 'packages show',
  'page backlinks', 'page block list', 'page block read', 'page diff', 'page explain', 'page graph', 'page health',
  'page history', 'page links', 'page lint', 'page list', 'page read', 'page template', 'page types', 'page written',
  'policy get', 'policy list', 'reference',
  'sandboxes check', 'sandboxes login-check', 'sandboxes list', 'sandboxes show', 'sandboxes why',
  'search query', 'search status', 'skills diff', 'skills doctor', 'skills list', 'skills search',
  'status', 'tickets list', 'tickets open', 'tickets show', 'tickets wait', 'version', 'whereami',
] as const

/** The groups, so `llm-wiki-ops <group> --help` reads too. */
const GROUPS = [...new Set(READ_VERBS.map((v) => v.split(' ')[0]!))]

/** Every read verb as typed: a `list` verb also answers to `ls`, its CLI alias. */
function spellings(): string[] {
  return READ_VERBS.flatMap((v) => (v.endsWith(' list') ? [v, v.replace(/ list$/, ' ls')] : [v]))
}

/**
 * Claude Code permission rules for the read verbs, with and without the
 * global `--json` in front. A prefix rule matches one command of a compound
 * line, so `… | head -60` still has its other half judged on its own.
 */
export function readRules(): string[] {
  const rules = ['Bash(llm-wiki-ops --help:*)', 'Bash(llm-wiki-ops --version:*)']
  for (const v of spellings()) rules.push(`Bash(llm-wiki-ops ${v}:*)`, `Bash(llm-wiki-ops --json ${v}:*)`)
  for (const g of GROUPS) rules.push(`Bash(llm-wiki-ops ${g} --help:*)`)
  return rules
}
