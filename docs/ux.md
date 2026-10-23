# The plugin's UX, as it stands

The one page that says what a person sees and can do, surface by surface, so a
reviewer can walk the whole experience without reading the code. Kept true on
every push; the review cycles append to the log at the end.

## Who it is for

A person who runs an llm-wiki wiki in an Obsidian vault. Day to day they manage
two things: **jobs** (what pulls into the wiki, on what schedule, with which
credentials, and what went wrong) and **skills** (the per-venue units that do
the pulling, which Obsidian hides under `.llm-wiki/skills` and
`.agents/skills`). They interact through **chat** and **search**.

## Surfaces

### Status bar (bottom of Obsidian)
`llm-wiki · ok` / `llm-wiki · 2 need you` / `llm-wiki · running Joe's mailbox` /
`llm-wiki · not ready`. Click opens the dashboard.

### Dashboard (main area tab; ribbon icon, command "Open dashboard")
Header: title, one health pill (`ok` or `N need you`), refreshed time, Refresh,
Chat. Four tabs, remembered per tab leaf.

**Overview** — do I need to do anything?
- One sentence: "2 things need you. Running Curate…. 1 job is due now."
- *Needs you* (count = the pill): one row per item, one button each.
  Sources: a job whose skill has an empty credential slot here (**Set
  credential**), a parked ticket (**Retry**), a ticket in review (**Ask the
  agent**), a blocked job (**Ask the agent**), a doctor warn/fail row (**Fix
  with the agent**), a drifted skill (**Inspect**), an unreadable job, a handoff
  problem, a git conflict (**Open**), search engine not ready (**Reindex**).
  Info rows (an update available, an enabled skill with an empty optional slot)
  follow, dimmer, uncounted.
- *Running and due*: cards for running and due jobs with Run/Pause. A notice
  when no runner is installed on this machine ("Jobs run when you press Run").
- *Waiting for curation*: count, first five paths, how many new files under
  sources/ are not yet in the wiki; Review goes to Pages.
- *Recent*: the last day's runs with outcome.

**Jobs** — a table: Job (name, slug · kind), Every, Last (relative time +
ok/failed pill), Next (Due now / Queued / Running 3m / Paused / Held until /
in 9h / Blocked / **Needs a credential**), buttons. Run (primary when due),
Pause, Resume; **Set credential** (primary) when the skill's slot is empty
here. "Add a job…" asks one line in plain words and hands it to chat as
`/llm-wiki:add <text>`. Nothing on screen says running or due that the ticket
store does not.

**Skills** — three groups then credentials.
- *Enabled on this machine*: name · venue, one pill at most (`credential
  missing` › `differs from the wiki` › `update available`), the jobs using it.
  Buttons: **Set credential** when a required slot is empty; else **Run job**
  (one job) / **Jobs** (several) / **Run** (a skill with a typable usage line);
  always **Inspect**.
- *In the wiki, not enabled here*: **Enable** → chat `/llm-wiki:enable <name>`;
  **Inspect**.
- *Available from the package*: chips; a click → chat `/llm-wiki:enable <name>`.
- *Credentials*: name · kind (secret / folder / login), state pill (verified
  2d ago / failed / empty), "Used by …" with a binding problem in brackets.
  **Replace…** (same dialog, name fixed), **Remove** (confirm names who loses
  it), **Log in** for a harness login that is failed/unverified. "Add a
  credential…" opens the dialog with nothing prefilled.

**Pages** — *Awaiting curation* rows (title from frontmatter, path, folder):
click opens the note; Accept, Reject… (one-line reason); "Ask the agent to
curate". *Not yet in the wiki*: files under sources/ the wiki has not adopted:
Adopt / Adopt all. An older CLI says it cannot tell.

### Inspect (skill dialog)
Header: state · version · package. *What it needs on this machine*: each slot
(required/optional, bound credential or "not set") with **Set credential**.
Facts: jobs using it, what a new job asks for, the CLI's warnings. Tabs Skill /
Enabling / Usage render SKILL.md and the unit's reference notes (the files
Obsidian hides). Footer: Run / Enable / Install and enable, Close.

### Credential dialog
Title "Credential for channel-gmail" (or "Add a credential", "Replace x").
Name (prefilled `<skill>-<slot>`), Kind (Secret value / Folder on this
machine), the secret (password field, piped to the CLI's stdin, never argv) or
a folder path, *Bind to*: the skill (checked; covers every job of it) and each
job (unchecked; overrides for that job only). Save and bind. Errors stay in the
dialog; the Notice never carries the value. The write runs as an attended
session because a person clicked.

### Chat (right sidebar)
Mode select Agent / Ask. Agent = a Claude Code session at the wiki root,
unjailed, with the wiki's hooks, permission cards in the pane ("Run this?",
Allow / Deny), `credentials get` denied. Ask = one jailed `harness run` per
turn, read-only. New chat, **Skills…** (a fuzzy list of the llm-wiki slash
skills read from the installed Claude Code plugin; asks for arguments; starts
the turn). Chips: three prompts by the active note. Composer with Send / Stop.
Every dashboard hand-off lands here prefilled, not sent.

### Search (right sidebar)
One field, results from `search query` with path and snippet; click opens the
note.

### Commands
Open dashboard / chat / search, Run a job… (fuzzy), Add a job…, Run a skill…
(fuzzy), Ask the agent about this note, Refresh, Re-detect.

### Settings
Paths to `llm-wiki-cli` and `claude` (login shell PATH by default), wiki key
override, default chat mode, model, Ask sandbox and skill, search k, debug.

## Flows the design is judged on

1. **A job needs a credential**: status bar says 1 need you → Overview row
   "Joe's mailbox cannot run on this machine" → Set credential → paste → Save
   and bind → row gone, job reads Due now → Run.
2. **Enable a skill**: Skills → In the wiki, not enabled → Enable → chat runs
   `/llm-wiki:enable channel-youtube` with permission cards → back on Skills
   it is enabled; if it needs a credential the row says so.
3. **Add a source**: Jobs → Add a job… → one line → chat `/llm-wiki:add …`
   → the agent asks what it needs, installs the skill, declares the job.
4. **Update now**: Jobs → Run on the row (no runner needed) → Running 0m →
   ok, pages written → Pages shows them for curation.
5. **Audit access**: Skills → Credentials: what exists, who uses it, what is
   stale or failed; Replace or Remove.
6. **Ask something**: chat, Ask mode for a read-only answer, Agent to act.

## How to look at it without Obsidian

`node preview/build.mjs`, serve the repo (`python3 -m http.server 8765`), open
`preview/index.html` in a browser with `?tab=jobs|skills|pages`,
`&modal=credential|skill|replace`, `&chat=turn`, `&theme=dark`, `&pane=search`.
It renders the real views over fixture data with a stand-in for Obsidian's API.

## Review log

- **Cycle 1 (2026-10-23)**: added the Skills tab (units from `skills ls`, the
  package's catalog, credentials from `credentials ls` + `bindings`), the
  credential dialog, the skill inspector, the unbound job state, the dynamic
  chat skill list. Fable design memo adopted: credentials live under Skills,
  one pill per row, silence means fine.
