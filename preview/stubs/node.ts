// Node built-ins the views import for the desktop plugin; in the browser preview they are inert.
/* eslint-disable */
export const readFile = async (p: string) => `# ${p.split('/').slice(-2).join('/')}\n\nThis is where the unit's note renders. In Obsidian the real file is read from the wiki.\n\n## What this skill does\n\n- harvests the venue into \`_raw/\`\n- processes it into pages under its \`dest\`\n\n\`\`\`sh\nllm-wiki-ops jobs add <slug> skill=channel-gmail options.mailbox=<who>@example.com\n\`\`\``
export const readdir = async () => []
export const join = (...p: string[]) => p.join('/')
export const homedir = () => '/home/preview'
export const spawn = () => { throw new Error('no child processes in the preview') }
export type ChildProcess = unknown
