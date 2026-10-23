# LLM Wiki for Obsidian

Chat with an agent, search, and operate an [llm-wiki](https://github.com/simple10/llm-wiki-plugins)
wiki from inside Obsidian. The vault is the wiki; the plugin is a command center
over the machine's `llm-wiki-cli`.

**Status: first usable build.** Dashboard (overview, jobs, pages), chat, search,
a status-bar health line and the commands below. Desktop only, since the plugin
spawns local processes.

## What it does

**Dashboard**, a tab in the main area (ribbon icon, or the status bar item, or
*LLM Wiki: Open dashboard*):

- **Overview**: one health sentence; **Needs you** (doctor findings with the
  fix they name, parked tickets, conflicts, a stale index), each with one
  button; **Running and due**, with a notice when this machine has no runner,
  since then jobs only run when you press Run; pages waiting for curation;
  **Recent** runs.
- **Jobs**: every job with its schedule, last run and what it is waiting on in
  plain words (due now, in 40m, paused, held, blocked and why, needs a
  credential, running with a spinner). **Run** starts it now through `jobs request`; **Pause**/**Resume**.
  **Add a job…** asks one question and hands it to the agent in chat as
  `/llm-wiki:add …`, which decides the rest. The row's state is read back from
  the tickets, never assumed from the click.
- **Skills**: the units the wiki holds and this machine loads, which Obsidian
  hides under `.llm-wiki/skills` and `.agents/skills`: enabled here, in the
  wiki but not enabled here, available from the package. One pill at most per
  row (credential missing, differs from the wiki, update available), the jobs
  using it; **Set credential**, **Run job**, **Enable** (hands
  `/llm-wiki:enable <name>` to chat), **Inspect** (what it needs on this
  machine, the jobs using it, SKILL.md and its enable and usage notes rendered
  in a dialog). Below, **Credentials**: what this wiki may use on this machine,
  names and states only, who uses each; **Replace…**, **Remove**, **Log in**,
  **Add a credential…**. The credential dialog pipes the secret to the CLI's
  stdin and binds it to the skill, or to one job, in the same step.
- **Pages**: pages awaiting curation. Click opens the note beside the
  dashboard; **Accept** and **Reject…** go through `page curate`. One button
  hands the queue to the agent with `/llm-wiki:curate`. Below it, **Not yet in
  the wiki**: files under `sources/` the wiki has not taken up, with **Adopt**
  (`page adopt`). That queue needs a CLI that reports page change state; an
  older one leaves it empty.

The dashboard polls every 10 s while something is running, every minute while
open, every 5 minutes otherwise. The status bar reads `llm-wiki · ok`,
`2 need you`, or `running <job>`; clicking it opens the dashboard.

**Chat** (right sidebar), two modes:

- **Agent**: a Claude Code session at the wiki root, with the wiki's own
  committed `.claude/settings.json` in force (write guard, `op record`, the
  llm-wiki skills). It can run jobs and edit pages, and asks you in the pane
  before any tool it would prompt for. A job it runs for you is composed into
  its own jail by the CLI, credentials included; the chat never sees a
  credential, and the verbs that would print one are denied. Multi-turn until
  **New chat**. Three suggested prompts sit above an empty transcript, tuned to
  the note you have open.
- **Ask**: one jailed, read-only `harness run` question per turn, the same thing
  the reference dashboard's Ask runs. It cannot change anything.

**Search** (right sidebar): `search query` through the CLI; results open as notes.

**Chat skills**: *Run a skill…* (a command, and the **Skills…** button in chat)
lists the `/llm-wiki:` slash skills, read from the llm-wiki plugin Claude Code
has installed, with what each does and what it takes, and turns the pick into
a chat turn such as `/llm-wiki:research <goal>`. The wiki's own skill units
live on the dashboard's Skills tab.

**Commands**: Open dashboard, Open chat, Open search, Run a job… (a fuzzy list;
the fastest Run there is), Add a job…, Run a skill…, Ask the agent about this
note, Refresh the dashboard, Re-detect wiki and binaries.

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
| `src/chat/harnessRun.ts` | the Ask backend on `harness run --stream` |
| `src/chat/skills.ts` | the `/llm-wiki:` slash skills, read from the installed Claude Code plugin's `skills/*/SKILL.md` |
| `src/wiki/model.ts` | what the dashboard shows: `Snapshot`, jobs with a plain-words `next`, attention items with one action |
| `src/wiki/snapshot.ts` | CLI answers into a `Snapshot`; the one place that knows the answers' field names |
| `src/wiki/actions.ts` | the writes a click makes, each one verb, each answering one sentence |
| `src/views/dashboard/` | the main-area view: `index.ts` (header, tabs, action routing), one file per tab |
| `src/views/chat.ts`, `src/views/search.ts` | the sidebar panes |
| `src/ui/` | DOM helpers, the prompt and confirm modals, the credential dialog, the skill inspector |
| `docs/cli-shapes.md` | the CLI answers the plugin reads, field by field |
| `docs/ux.md` | what a person sees and can do, surface by surface; the review log |
| `preview/` | renders the views in a browser over fixture data, for screenshots without Obsidian |

Another harness is another file under `src/chat/` implementing `ChatBackend`,
plus one case in `main.ts`'s `backend()`.

## Rules the plugin keeps

- **Fixed argv.** Nothing typed into Obsidian reaches a command line except as
  one validated argument after `--`.
- **Read floor by default.** Every CLI call runs with `LLM_WIKI_PERMISSIONS=read`
  and `llm-wiki-cli wiki --read-only`, except the writes a click asks for,
  listed in one place (`WRITES` in `src/wiki/cli.ts`): run, pause and resume a
  job, retry a ticket, accept or reject a page, adopt a page, reindex, and
  `harness run`.
- **Nothing on screen says running or due that the ticket store does not.**
  Run is optimistic for one poll; the row's state comes from `tickets ls`.
- **The agent is attended.** The session carries `LLM_WIKI_SESSION_ATTENDED=1`
  because a person is watching the pane and clicking the permission cards.
- **No credential in a transcript.** `credentials get` is a denied tool pattern.

## Disclosures

The plugin runs local processes: `llm-wiki-cli` and, in Agent mode, `claude`,
which talks to Anthropic's API with the user's own login or API key. It reads
and writes files outside the vault only through those processes, as they do
in a terminal. No telemetry.
