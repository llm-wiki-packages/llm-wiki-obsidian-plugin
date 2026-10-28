# LLM Wiki Brain for Obsidian

Chat with an agent, search, and operate an [llm-wiki](https://github.com/simple10/llm-wiki-plugins)
wiki from inside Obsidian. The vault is the wiki; the plugin is a command center
over the machine's `llm-wiki-cli`.

**Status: first usable build.** Dashboard (overview, jobs, pages), chat, search,
a status-bar health line and the commands below. Desktop only, since the plugin
spawns local processes.

## What it does

One view, **Brain** (the brain icon in the ribbon, the status bar item, or
*LLM Wiki Brain: Open dashboard*), opened as a tab in the main area; drag it into a
side split to keep it beside a note. Chat, Search, Overview, Reports and Changes on
the left, the everyday tabs; **More** on the far right opens a second row
with Jobs, Skills, Credentials and Config, for running the wiki, and reopens the one
last used. A note opened from the view (a search hit, a
link in a reply, a Changes row) opens in a new tab, never in the view's own
place; Cmd-click opens a split. The health pill in the header reads `ok` or `N
need you`, lists what needs you on hover, and opens the Overview from any tab;
the gear opens the plugin settings.

- **Overview**: one sentence about what is moving, with Search, History and
  Runner pills; **Needs you**, one row and one button per item (a job that
  cannot run here until a credential is set, a stopped job whose credential
  went stale, a parked ticket, a doctor finding with the fix it names, a
  drifted skill, a conflict, a stale index); the **Fleet**, every machine
  joined to the wiki around the shared remote, when there is more than one;
  **Jobs**, running and next up, with Run now; one line about today's
  content. A wiki with no jobs gets one card that says what a job and a skill
  are, with Add a source and Browse skills. Without a runner anywhere, one
  notice with an Install-the-runner hand-off.
- **Reports**: the briefs the agents wrote under `wiki/reports/`, newest
  first, read from the vault with no CLI call. The daily-report skill writes
  a markdown record, `YYYY-MM-DD.md`, and a standalone HTML brief beside it,
  which the record names in `dashboard:`; this tab pairs them. The latest
  leads with its lede and the items it says need you, with **Open the brief**
  and **Read the record**; the earlier ones are a list by day. **Template**
  opens `_template.html`, the look every brief borrows. Under them, the
  vault's other HTML files. With no report yet, it names the job that writes
  them (`ops-morning`, paused in a fresh wiki).
- **Changes**: **New**, the pages a job brought in or you dropped into
  `sources/` that nobody has judged, grouped by the job or the folder (a
  big group folds to one row) with **Accept** (into the wiki, through `page
  curate`), **Draft** (hold it; ticks the `Draft` box) and **Archive…**
  (`page curate reject=`); **Drafts**, every page you are holding, beside a
  live preview; **Activity**, the week's commits by who made them, each with
  the files it added, edited or deleted. A strip on top lists the edits here
  not in history yet, with **Save now**. Every file name opens its diff.
- **Jobs**: grouped by state (needs you, running, due, scheduled, manual,
  paused), each row with its schedule, last run (a failure shows its reason)
  and what it is waiting on in plain words, one primary button (Set or
  Replace credential, Run, Resume) and a menu for the rest. Click a row for
  the **job detail dialog**: state and reasons, what it needs on this
  machine, its last runs with Retry, Ask the agent with the failure attached.
  **Add a source…** asks one question and hands it to the agent in chat as
  `/brain:add …`. Run all due; Pause all / Resume all. The row's state is
  read back from the tickets, never assumed from the click. Below, **What a
  job can run**: the skills whose mode includes `pipeline` (the plugin's
  routines and the units with a stage), each with its stages, the jobs naming
  it and **Enable** where it is not enabled here.
- **Skills**: the units the wiki holds and this machine loads, which Obsidian
  hides under `.llm-wiki/skills` and `.agents/skills`: enabled here, in the
  wiki but not enabled here, available from the package (with each unit's
  description and what it will need). One pill at most per row (credential
  missing or stale, differs from the wiki, update available), the jobs using
  it, one button (Set or Replace credential, Run job, Enable, Add). Click a
  row for the **inspector**: what it needs on this machine, the jobs using it,
  SKILL.md and its enable and usage notes rendered, Add a source with it.
- **Credentials**: every credential the CLI holds for this wiki, by name,
  kind and state, never a value, with who uses it; Replace, Remove, Log in,
  Add. Below, what an enabled skill still needs, with **Set credential**.
  The credential dialog says in words what is needed, pipes the secret to the
  CLI's stdin, binds it to the skill (or one job), and then retries a stopped
  job or runs a due one, in the same step.
- **Config**: the wiki's own settings (`.llm-wiki.toml` and this machine's
  `.llm-wiki.local.toml`), apart from the plugin's, which link to each other.
  One `config get` reads every row; each value says which layer sets it, and
  a change is written back to that layer through `config set --wiki|--local`.
  Template rules, searched and unindexed folders, indexed properties, job
  defaults, the settle window, run caps and logging are edited in place.
  Search backends and transcription are shown, and **Change search setup** or
  **Set up transcription** hands the change to the agent.
  That queue needs a CLI that reports page change state; an older one says so.

The dashboard polls every 10 s while something is running, every minute while
open, every 5 minutes otherwise, and again after every chat turn. The status
bar reads `llm-wiki · ok`, `2 need you`, `1 stopped`, or `running <job>`, with
`· no runner` when none is installed; clicking it opens the dashboard. A job
that stops between two polls raises a Notice.

**Chat** (a tab of the view): a Claude Code session at the wiki root, with the
wiki's own committed `.claude/settings.json` in force (write guard,
`op record`, the brain skills). It can run jobs and edit pages; a job it
runs for you is composed into its own jail by the CLI, credentials included.
The chat never sees a credential, and the verbs that would print one are
denied in every permission mode. Multi-turn until **New chat** (top left);
**Continue last chat** picks the last session back up. Tool rows read in words
("Running inbox-joe"), grey beside the reply; a row opens on a click to show
the whole command, an edit as a diff, and the output, and calls made back to
back fold into one counted group. A file the agent reads or edits opens on a
click.
An answered permission card folds away. Suggested prompts sit above an empty
transcript: the newest source to summarize, what's new, a video to add.

The row under the box holds everything the next turn runs with, saved as the
defaults (the Chat settings change the same values):

- **Skills…** lists the `/brain:` slash skills; typing `/` at the start of
  a line lists them too (a setting turns that off).
- **Permissions**: Ask first (asks about writes; the wiki's read verbs run
  without asking), Auto-accept edits, Auto (a classifier approves
  routine actions), or Full access. **Read-only** sets the CLI's read floor
  (`LLM_WIKI_PERMISSIONS=read`, what `wiki --read-only` sets) and takes away
  the file-editing tools; a shell command can still write unless Ask first
  stops it. **Sandbox** runs the chat jailed through
  `harness run --conversation` in the named sandbox, whose profile decides
  whether it writes. One session keeps the whole conversation, never asks,
  and closes after the idle minutes set in Settings → Chat, on New chat, and
  when Obsidian quits. Stop interrupts the turn and keeps the session.
  Needs the CLI that ships `--conversation` (llm-wiki-plugins #3557).
- **Model** and **Effort**: the aliases until the first reply, then the
  models and effort levels the harness reports.
- A ring shows how full the context window is, with the numbers on hover.
- **Send** turns into a red **Stop** while the agent works (Esc stops too).

A **Default skill** setting starts every new chat with that skill typed into
the box, e.g. `/brain:search `, so what runs is on screen and one
backspace away.

Wikilinks and URLs in a reply open on click; a reply has a Copy button on
hover; text is selectable everywhere.

**Search** (a tab of the view): `search query` through the CLI, no model
involved; results open as notes, at the passage's line where it is known. Each
hit shows two lines of the passage that won it, starting near the first query
word, with the query words marked. Each hit is checked against the page as it
is now: a page that is gone reads **page deleted**, and a passage the page no
longer holds reads **text changed**; a line over the results counts them. The
sliders icon opens the filters `search query` takes (folder, not-in-folder,
page type, tag, author, area, source site, a `key=value` property, curation,
captured date range); they show as chips under the field and are kept in the
settings. The refresh icon carries a dot when the index owes something, and
opens **Search index**: one verdict (up to date, N files changed, deleted pages
answering, paths changed, engine not ready), the files waiting and the stale
hits seen, and two passes: **Update index** (`search index`, additive) and
**Rebuild index** (`search reindex`, every file, and removes deleted pages;
asks first). The one marked recommended is the one the verdict calls for.

**Chat skills**: *Run a skill…* (a command, and the **Skills…** button in chat)
lists the same slash skills: every `skills ls` row whose mode includes
`session`, the plugin's as `/brain:<name>` and an enabled unit as `/<name>`,
with what each does and what it takes, and turns the pick into a chat turn
such as `/brain:research <goal>`. A pipeline-only skill such as `wiki-report`
is not listed and can still be typed. From a CLI older than the skill
manifests, whose rows say no mode, the list is read from the brain plugin
Claude Code has installed, as before.

**Every note** gets a history icon in its header, beside Obsidian's own: a
dot while it has edits not yet in history; a click shows when and by whom it
was last saved, the last ten commits, **See edits**, **Save now**, and
**Local snapshots…**. A commit opens what it changed in the page (`page
diff`): properties listed apart from the body, with Older and Newer. History
follows a rename. Renaming a page in Obsidian sets its `title:` to the new
name. A copy made in Obsidian gets its own `document_id` (`page fix
--force`), so the wiki never counts two pages as one.
A page's Properties lead with title, type, description and tags, and the
wiki's bookkeeping (`document_id`, `document_revision`, `generated`,
`verified` and the rest) goes last, folded behind a **More** row that stays
open across notes until closed; the file is not touched (a setting turns it off).
A blank note made in Obsidian starts from the wiki's template for its folder
(`page template`), the same frontmatter a page the agent makes gets. Without
a runner on this machine, edits are saved to history two quiet minutes after
the last one (the CLI's sweep, `git commit`), and with **Save and sync**
pulled and pushed too; a runner does that itself, and the plugin stands back.

**Commands**: Open dashboard, Open chat, Open search, Open changes, Save
edits to history now, Apply the wiki's template to this page, Run a job… (a fuzzy list;
the fastest Run there is), Open a job…, Add a source…, Set a credential…, Run a
skill…, Ask the agent about this note, Refresh the dashboard, Re-detect wiki
and binaries. Every row takes focus and opens on Enter.

### HTML files

Obsidian opens no `.html` file by itself; the plugin does, in a tab of its own,
as a browser would show it. Any such file may have been scraped off the web,
so it is shown in a frame that cannot reach this machine:

- **A sandboxed frame** (`sandbox="allow-scripts"`, no same origin): no reach
  into Obsidian, its storage, the vault or Node; no popups, forms, or
  navigating Obsidian itself.
- **A policy that fetches nothing**, placed first in the page's head (the page
  is parsed with `DOMParser`, which runs and loads nothing, to place it): no
  request to the web, to `localhost` or to `file:`, by fetch, XHR, WebSocket,
  beacon, worker, image, stylesheet or frame. Inline styles and `data:`
  images only. A meta refresh is removed before the page is shown.
- **The page's own scripts are off**, except for a brief in `wiki/reports/`,
  whose tabs and panels need them. Off, only the plugin's bridge runs, by a
  nonce the page cannot know. **</>** in the tab header turns a page's
  scripts on or off for as long as it is open.

The bridge follows a clicked link: a vault path opens in Obsidian
(Cmd-click for a new tab), a web or mail address in your browser. **Copy** in
a brief reaches the clipboard after a click, never without one. A brief has
**‹** and **›** in its header for the day before and after, and a button for
its record. Commands: *Open reports*, *Open the latest report*, and *Open this
report's brief* from a record. If another plugin claimed `.html` first, its
view opens them instead.

What remains with a page's scripts **on**: the page can send its own frame to
an address (`location = …`), which is one GET, localhost included. It cannot
read the answer, and the view puts the page back and says so, but the request
has gone; neither the sandbox, the policy nor the Navigation API (off in an
opaque origin) can stop it, and Obsidian gives a plugin no hold on the
network. WebRTC, which no policy covers, has its constructors removed first.
The frame is not a separate OS process: Obsidian's window runs Node, and a
subframe shares its renderer, so a browser exploit in a page would reach as
far as Obsidian does. Scripts off narrows that too.

`docs/html-probe.html` checks all of this inside Obsidian; its comment says how.

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
(if on) → enable **LLM Wiki Brain**. The ribbon's brain icon opens the view; the
command palette has **LLM Wiki Brain: Open chat** and **Open search**, which land on
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

Add `LLM_WIKI_E2E_SANDBOX=<sandbox>` to also hold a real sandboxed chat: a few haiku turns, one stopped. The sandbox must be read-only and logged in, and on Linux the wiki must sit outside `/tmp`, which the jail refuses.

## Layout

| path | what |
| :-- | :-- |
| `src/main.ts` | the plugin: settings, detection of the binaries and the wiki, the views and commands |
| `src/wiki/cli.ts` | the CLI seam. Every argv is spelled here, keyed by verb; every read verb carries the read floor |
| `src/wiki/resolve.ts` | the login shell's PATH, binary lookup, and matching the vault to a registered wiki |
| `src/chat/types.ts` | the chat contract: a backend turns a harness's protocol into `ChatEvent`s and asks permission through one callback |
| `src/chat/claudeSdk.ts` | the chat backend on `@anthropic-ai/claude-agent-sdk`, driving the user's own `claude` |
| `src/chat/harnessRun.ts` | the sandboxed chat backend on `harness run --stream --conversation` |
| `src/views/composer.ts` | the row under the chat box: permission panel, model and effort lists, context ring, `/` list |
| `src/chat/skills.ts` | the slash skills: the `skills ls` rows whose mode includes `session`, or, from an older CLI, the installed Claude Code plugin's `skills/*/SKILL.md` |
| `src/wiki/model.ts` | what the dashboard shows: `Snapshot`, jobs with a plain-words `next`, attention items with one action |
| `src/wiki/snapshot.ts` | CLI answers into a `Snapshot`; the one place that knows the answers' field names |
| `src/wiki/actions.ts` | the writes a click makes, each one verb, each answering one sentence |
| `src/wiki/layout.ts` | where things live in a wiki (feeds, wiki, research, templates, raw) and the two box names; the only place a tree is spelled |
| `src/vault/` | what Obsidian knows of a page, the Draft and Archive boxes, grouping, saving edits to history, templates on new notes |
| `src/ui/pageHistory.ts` | the history icon in every note's header |
| `src/ui/diffModal.ts`, `src/wiki/diff.ts` | one page's change, from `page diff` |
| `src/wiki/config.ts`, `src/ui/configModal.ts` | the `config` contract's row shapes and the keys the Config tab shows, named and grouped; the dialogs that change a value, a list, a template rule, an indexed property |
| `src/views/dashboard/` | the one view: `index.ts` (header, tabs, action routing), one file per data tab |
| `src/views/html.ts`, `src/vault/reports.ts` | the HTML file view, its sandboxed frame and the bridge out of it; the reports, each record paired with its brief |
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
  job, retry a ticket, accept or archive a page, adopt a page, save to
  history and sync (`git commit`, `git sync`), reindex, `config set` and
  `config unset`, and `harness run`.
  The Draft and Archive boxes are ticked through Obsidian, as a person would.
- **The editor's page writes say so.** Accept, Archive, adopt, a copy's
  repair and the sweep run with `LLM_WIKI_SESSION_ORIGIN=editor` (`EDITOR` in
  `src/wiki/cli.ts`), which lifts the CLI's settle window: the person editing
  is the one asking.
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
