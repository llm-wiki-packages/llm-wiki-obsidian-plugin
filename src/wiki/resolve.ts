// Finding the binaries and the wiki. Electron does not inherit the login
// shell's PATH, so the plugin asks the shell for it once and searches that.
import { execFile } from 'node:child_process'
import { accessSync, constants, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

let shellPath: Promise<string> | null = null

/** PATH as the user's login shell sees it, cached for the plugin's life. */
export function loginShellPath(): Promise<string> {
  if (shellPath) return shellPath
  shellPath = new Promise((done) => {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    const child = execFile(shell, ['-ilc', 'printf "%s" "$PATH"'], { timeout: 8000, env: process.env }, (err, stdout) => {
      done(!err && stdout.trim() ? stdout.trim() : process.env.PATH ?? '')
    })
    child.on('error', () => done(process.env.PATH ?? ''))
  })
  return shellPath
}

const EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin'), join(homedir(), 'bin')]

/** The PATH the plugin runs children with: the login shell's, then the common places, deduplicated. */
export async function effectivePath(): Promise<string> {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...(await loginShellPath()).split(delimiter), ...(process.env.PATH ?? '').split(delimiter), ...EXTRA_DIRS]) {
    if (dir && !seen.has(dir)) {
      seen.add(dir)
      out.push(dir)
    }
  }
  return out.join(delimiter)
}

function executable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** An absolute path for `name`: the override when one is set, else the first hit on the effective PATH. */
export async function findBinary(name: string, override?: string): Promise<string | null> {
  if (override?.trim()) {
    const p = resolve(override.trim().replace(/^~(?=$|\/)/, homedir()))
    return executable(p) ? p : null
  }
  for (const dir of (await effectivePath()).split(delimiter)) {
    const p = join(dir, name)
    if (executable(p)) return p
  }
  return null
}

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/** The registered wiki whose root is the vault, or null when the vault is not one. */
export function matchWiki<T extends { path: string; key: string }>(rows: T[], vaultPath: string, keyOverride?: string): T | null {
  if (keyOverride?.trim()) return rows.find((r) => r.key === keyOverride.trim()) ?? null
  const vault = real(vaultPath)
  return rows.find((r) => real(r.path) === vault) ?? null
}
