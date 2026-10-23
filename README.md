# LLM Wiki for Obsidian

Chat with an agent, search, and operate an [llm-wiki](https://github.com/simple10/llm-wiki-plugins)
wiki from inside Obsidian. The vault is the wiki; the plugin is a command center
over the machine's `llm-wiki-cli`.

**Status: spike.** Chat and search work. Jobs, skills and the page explorer are
designed and not built. Desktop only, since the plugin spawns local processes.

## What it does

- **Search** (right sidebar): `search query` through the CLI, results open as
  notes in the vault.
- **Chat** (right sidebar), two modes:
  - **Agent**: a Claude Code session at the wiki root, unjailed, with the wiki's
    own committed `.claude/settings.json` in force (write guard, `op record`,
    the llm-wiki skills). It asks you in the pane before any tool it would
    prompt for. A job it runs for you (`llm-wiki-ops jobs request <slug>`) is
    composed into its own jail by the CLI, credentials included; the chat never
    sees a credential, and the verbs that would print one are denied.
    Multi-turn: the session is resumed until you press **New chat**.
  - **Safe**: one jailed, read-only `harness run` question per turn, the same
    thing the reference dashboard's Ask runs. It cannot start a job.

## Requirements

- Obsidian 1.7.2 or later on macOS or Linux.
- The llm-wiki distribution installed on the machine: `llm-wiki-cli` on the
  login shell's PATH, or its path set in the plugin settings.
- The vault is a registered wiki (`llm-wiki-cli machine wikis ls` lists it at
  the vault's path). If the path differs (a symlink), set the wiki key in the
  plugin settings.
- Agent mode: the `claude` binary on the login shell's PATH, or its path set
  in the settings, logged in. The session runs as that binary does in a
  terminal: same settings, same login. Note Anthropic's Agent SDK terms on
  offering claude.ai login in third-party products.
- Safe mode: the wiki has an enabled `read-search` sandbox
  (`llm-wiki-ops sandboxes seed read-search`, then `sandboxes enable read-search`).

## Install on your machine (before a release exists)

```sh
git clone https://github.com/llm-wiki-packages/llm-wiki-obsidian-plugin.git && cd llm-wiki-obsidian-plugin
npm install
npm run build
npm run install-to-vault -- /path/to/your/vault
```

Then in Obsidian: Settings → Community plugins → turn off Restricted mode
(if on) → enable **LLM Wiki**. The ribbon's speech-bubble icon opens chat;
the command palette has **LLM Wiki: Open search** and **Open chat**. The
status bar shows which wiki the vault resolved to, or why it did not.

Once releases exist, [BRAT](https://github.com/TfTHacker/obsidian42-brat)
installs from the GitHub repo and tracks releases.

## Develop

```sh
npm run dev          # esbuild watch; copy or symlink the checkout into <vault>/.obsidian/plugins/llm-wiki
npm run check        # build + lint (eslint-plugin-obsidianmd) + unit tests
```

End-to-end, against a real CLI and a scratch wiki:

```sh
LLM_WIKI_E2E_BIN=$(which llm-wiki-cli) LLM_WIKI_E2E_VAULT=/path/to/wiki npm test -- test/e2e.test.ts
```

## Layout

| path | what |
| :-- | :-- |
| `src/main.ts` | the plugin: settings, detection of the binaries and the wiki, the views and commands |
| `src/wiki/cli.ts` | the CLI seam. Every argv is spelled here, keyed by verb; every read verb carries the read floor |
| `src/wiki/resolve.ts` | the login shell's PATH, binary lookup, and matching the vault to a registered wiki |
| `src/chat/types.ts` | the chat contract: a backend turns a harness's protocol into `ChatEvent`s and asks permission through one callback |
| `src/chat/claudeSdk.ts` | the Agent backend on `@anthropic-ai/claude-agent-sdk`, driving the user's own `claude` |
| `src/chat/harnessRun.ts` | the Safe backend on `harness run --stream` |
| `src/views/` | the search and chat panes, plain DOM on Obsidian's CSS variables |

Another harness is another file under `src/chat/` implementing `ChatBackend`,
plus one case in `main.ts`'s `backend()`.

## Rules the plugin keeps

- **Fixed argv.** Nothing typed into Obsidian reaches a command line except as
  one validated argument after `--`.
- **Read floor by default.** Every CLI call runs with `LLM_WIKI_PERMISSIONS=read`
  and `llm-wiki-cli wiki --read-only`, except `harness run` (it spends model
  budget) and the agent session itself.
- **The agent is attended.** The session carries `LLM_WIKI_SESSION_ATTENDED=1`
  because a person is watching the pane and clicking the permission cards.
- **No credential in a transcript.** `credentials get` is a denied tool pattern.

## Disclosures

The plugin runs local processes: `llm-wiki-cli` and, in Agent mode, `claude`,
which talks to Anthropic's API with the user's own login or API key. It reads
and writes files outside the vault only through those processes, as they do
in a terminal. No telemetry.
