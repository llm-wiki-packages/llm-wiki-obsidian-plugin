# LLM Wiki for Obsidian

Chat with an agent, search, and operate an [llm-wiki](https://github.com/simple10/llm-wiki-plugins)
wiki from inside Obsidian. The vault is the wiki; the plugin is a command center
over the machine's `llm-wiki-cli`.

**Status: first usable build.** Dashboard (overview, jobs, pages), chat, search,
a status-bar health line and the commands below. Desktop only, since the plugin
spawns local processes.

## What it does

One view, **LLM Wiki** (the brain icon in the ribbon, the status bar item, or
*LLM Wiki: Open dashboard*), opened as a tab in the main area; drag it into a
side split to keep it beside a note. Seven tabs: Overview, Jobs, Skills,
Ingest and Credentials on the left for managing the wiki, Search and Chat on
the right for talking to it. A note opened from the view (a search hit, a
link in a reply, an Ingest row) opens in a new tab, never in the view's own
place; Cmd-click opens a split. The health pill in the header reads `ok` or `N
need you`, lists what needs you on hover, and opens the Overview from any tab;
the gear opens the plugin settings.

- **Overview**: one sentence about what is moving; **Needs you**, one row and
  one button per item (a job that cannot run here until a credential is set,
  a stopped job whose credential went stale, a parked ticket, a doctor
  finding with the fix it names, a drifted skill, a conflict, a stale index);
  **Running and due** cards; pages waiting for curation; **Last day**, the
  runs in words. A wiki with no jobs gets one card that says what a job and a
  skill are, with Add a source and Browse skills. Without a runner on this
  machine, one notice with an Install-the-runner hand-off.
- **Jobs**: grouped by state (needs you, running, due, scheduled, manual,
  paused), each row with its schedule, last run (a failure shows its reason)
  and what it is waiting on in plain words, one primary button (Set or
  Replace credential, Run, Resume) and a menu for the rest. Click a row for
  the **job detail dialog**: state and reasons, what it needs on this
  machine, its last runs with Retry, Ask the agent with the failure attached.
  **Add a source…** asks one question and hands it to the agent in chat as
  `/llm-wiki:add …`. Run all due; Pause all / Resume all. The row's state is
  read back from the tickets, never assumed from the click.
- **Skills**: the units the wiki holds and this machine loads, which Obsidian
  hides under `.llm-wiki/skills` and `.agents/skills`: enabled here, in the
  wiki but not enabled here, available from the package (with each unit's
  description and what it will need). One pill at most per row (credential
  missing or stale, differs from the wiki, update available), the jobs using
  it, one button (Set or Replace credential, Run job, Enable, Add). Click a
  row for the **inspector**: what it needs on this machine, the jobs using it,
  SKILL.md and its enable and usage notes rendered, Add a source with it.
- **Ingest**: the intake pipeline top to bottom. **New under sources/**:
  files the wiki has not taken up, with **Adopt** (`page adopt`). Then
  **Awaiting curation**: drafts grouped by the folder they landed in, Accept
  all per folder; click opens the note; **Accept** and **Reject…** go through
  `page curate`; one button hands the queue to the agent with
  `/llm-wiki:curate`.
- **Credentials**: every credential the CLI holds for this wiki, by name,
  kind and state, never a value, with who uses it; Replace, Remove, Log in,
  Add. Below, what an enabled skill still needs, with **Set credential**.
  The credential dialog says in words what is needed, pipes the secret to the
  CLI's stdin, binds it to the skill (or one job), and then retries a stopped
  job or runs a due one, in the same step.
  That queue needs a CLI that reports page change state; an older one says so.

The dashboard polls every 10 s while something is running, every minute while
open, every 5 minutes otherwise, and again after every chat turn. The status
bar reads `llm-wiki · ok`, `2 need you`, `1 stopped`, or `running <job>`, with
`· no runner` when none is installed; clicking it opens the dashboard. A job
that stops between two polls raises a Notice.

**Chat** (a tab of the view): a Claude Code session at the wiki root, with the
wiki's own committed `.claude/settings.json` in force (write guard,
`op record`, the llm-wiki skills). It can run jobs and edit pages; a job it
runs for you is composed into its own jail by the CLI, credentials included.
The chat never sees a credential, and the verbs that would print one are
denied in every permission mode. Multi-turn until **New chat** (top left);
**Continue last chat** picks the last session back up. Tool rows read in words
("Running inbox-joe"); the command is on hover and in the permission card.
Suggested prompts sit above an empty transcript, tuned to the note you have
open.

The row under the box holds everything the next turn runs with, saved as the
defaults (the Chat settings change the same values):

- **Skills…** lists the `/llm-wiki:` slash skills; typing `/` at the start of
  a line lists them too (a setting turns that off).
- **Permissions**: Ask first, Auto-accept edits, Auto (a classifier approves
  routine actions), or Full access. **Read-only** sets the CLI's read floor
  (`LLM_WIKI_PERMISSIONS=read`, what `wiki --read-only` sets) and takes away
  the file-editing tools; a shell command can still write unless Ask first
  stops it. **Sandbox** runs each turn jailed through `harness run` in the
  named sandbox, whose profile decides whether it writes; a sandboxed turn
  never asks and starts fresh (see `docs/ux.md`, Known gaps).
- **Model** and **Effort**: the aliases until the first reply, then the
  models and effort levels the harness reports.
- A ring shows how full the context window is, with the numbers on hover.
- **Send** turns into a red **Stop** while the agent works (Esc stops too).

A **Default skill** setting starts every new chat with that skill typed into
the box, e.g. `/llm-wiki:search `, so what runs is on screen and one
backspace away.

Wikilinks and URLs in a reply open on click; a reply has a Copy button on
hover; text is selectable everywhere.

**Search** (a tab of the view): `search query` through the CLI, no model
involved; results open as notes.

**Chat skills**: *Run a skill…* (a command, and the **Skills…** button in chat)
lists the same `/llm-wiki:` slash skills, read from the llm-wiki plugin Claude Code
has installed, with what each does and what it takes, and turns the pick into
a chat turn such as `/llm-wiki:research <goal>`. The wiki's own skill units
live on the dashboard's Skills tab.

**Commands**: Open dashboard, Open chat, Open search, Run a job… (a fuzzy list;
the fastest Run there is), Open a job…, Add a source…, Set a credential…, Run a
skill…, Ask the agent about this note, Refresh the dashboard, Re-detect wiki
and binaries. Every row takes focus and opens on Enter.

## Requirements

- Obsidian 1.7.2 or later on macOS or Linux.
- The llm-wiki distribution installed on the machine: `llm-wiki-cli` on the
  login shell's PATH, or its path set in the plugin settings.
- The vault is a registered wiki (`llm-wiki-cli machine wikis ls` lists it at
  the vault's path). If the path differs (a symlink), set the wiki key in the
  plugin settings.
- Chat: the `claude` binary on the login shell's PATH, or its path set
  in the settings, logged in. The session runs as that binary does in a
  terminal: same settings, same login. Note Anthropic's Agent SDK terms on
  offering claude.ai login in third-party products.
- The chat's Sandbox switch: the wiki has an enabled `read-search` sandbox
  (`llm-wiki-ops sandboxes seed read-search`, then `sandboxes enable read-search`).

## Install on your machine (before a release exists)

```sh
git clone https://github.com/llm-wiki-packages/llm-wiki-obsidian-plugin.git && cd llm-wiki-obsidian-plugin
npm install
npm run build
npm run install-to-vault -- /path/to/your/vault
```

Then in Obsidian: Settings → Community plugins → turn off Restricted mode
(if on) → enable **LLM Wiki**. The ribbon's brain icon opens the view; the
command palette has **LLM Wiki: Open chat** and **Open search**, which land on
those tabs. The status bar shows which wiki the vault resolved to, or why it
did not.

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
| `src/chat/claudeSdk.ts` | the chat backend on `@anthropic-ai/claude-agent-sdk`, driving the user's own `claude` |
| `src/chat/harnessRun.ts` | the sandboxed chat backend on `harness run --stream` |
| `src/views/composer.ts` | the row under the chat box: permission panel, model and effort lists, context ring, `/` list |
| `src/chat/skills.ts` | the `/llm-wiki:` slash skills, read from the installed Claude Code plugin's `skills/*/SKILL.md` |
| `src/wiki/model.ts` | what the dashboard shows: `Snapshot`, jobs with a plain-words `next`, attention items with one action |
| `src/wiki/snapshot.ts` | CLI answers into a `Snapshot`; the one place that knows the answers' field names |
| `src/wiki/actions.ts` | the writes a click makes, each one verb, each answering one sentence |
| `src/views/dashboard/` | the one view: `index.ts` (header, tabs, action routing), one file per data tab |
| `src/views/chat.ts`, `src/views/search.ts` | the Chat and Search panes the view hosts |
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

The plugin runs local processes: `llm-wiki-cli` and, for the chat, `claude`,
which talks to Anthropic's API with the user's own login or API key. It reads
and writes files outside the vault only through those processes, as they do
in a terminal. No telemetry.
