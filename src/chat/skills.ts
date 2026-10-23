// The llm-wiki skills a person would start by hand, as chat slash commands.
// Operator plumbing (join, enable, sandbox, write-skill) is left to the terminal.

export interface SkillEntry {
  name: string
  /** What it does for you, in one line. */
  description: string
  /** What to type after it, or empty when it takes nothing. */
  args: string
}

export const SKILLS: SkillEntry[] = [
  { name: 'add', description: 'Follow a URL, a mailbox or a feed, or schedule recurring work', args: '<url, channel or task>' },
  { name: 'research', description: 'Research a topic or question from the wiki outward', args: '<goal>' },
  { name: 'curate', description: 'Accept or reject what the pipeline has landed', args: '[path]' },
  { name: 'review', description: 'Go through the change requests the improve pass staged', args: '' },
  { name: 'improve', description: 'Fold the change requests workers and stages filed', args: '' },
  { name: 'dream', description: 'Merge curated content into the wiki’s knowledge', args: '' },
  { name: 'wiki-report', description: 'What happened since a time: a digest of the wiki', args: '[since, e.g. 2d]' },
  { name: 'status', description: 'How the wiki is doing: health, peers, what is unpushed', args: '' },
  { name: 'doctor', description: 'Is this machine set up right for the wiki, and what fixes it', args: '' },
  { name: 'jobs', description: 'Supervise the jobs: due, held, parked, in review', args: '' },
  { name: 'tick', description: 'Run what is due now', args: '' },
  { name: 'search', description: 'Ask what the wiki knows about something', args: '<query>' },
  { name: 'grill', description: 'Be interviewed so the wiki learns who it works for', args: '[topic]' },
  { name: 'transcribe', description: 'Turn a media file or folder into words', args: '<path>' },
  { name: 'remove', description: 'Stop following a source, keeping what was captured', args: '<url or slug>' },
  { name: 'forget', description: 'Purge a scraped URL: its page, its job, everything', args: '<url>' },
  { name: 'policy', description: 'Show or edit the policy overlay for an operation', args: '[name]' },
  { name: 'denials', description: 'Why a unit keeps failing in its jail, and what it needs', args: '' },
]

export function slashCommand(skill: SkillEntry, args = ''): string {
  return `/llm-wiki:${skill.name}${args.trim() ? ` ${args.trim()}` : ''}`
}
