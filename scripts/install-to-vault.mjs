// Copies the built plugin into a vault: `npm run install-to-vault -- /path/to/vault`.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const vault = process.argv[2] ?? process.env.OBSIDIAN_VAULT
if (!vault) {
  console.error('usage: npm run install-to-vault -- /path/to/vault   (or set OBSIDIAN_VAULT)')
  process.exit(2)
}
if (!existsSync(join(vault, '.obsidian'))) {
  console.error(`${vault}: no .obsidian/ here; is it a vault?`)
  process.exit(2)
}
if (!existsSync('main.js')) {
  console.error('main.js is missing; run `npm run build` first')
  process.exit(2)
}
const dest = join(vault, '.obsidian', 'plugins', 'llm-wiki')
mkdirSync(dest, { recursive: true })
for (const f of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(f, join(dest, f))
console.log(`installed to ${dest}; reload Obsidian (Ctrl/Cmd-R) or toggle the plugin`)
