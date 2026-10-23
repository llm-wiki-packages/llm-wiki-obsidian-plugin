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
`llm-wiki · ok` / `llm-wiki · 2 need you` / `llm-wiki · 1 stopped` (when every
item is a stopped job) / `llm-wiki · running Joe's mailbox` / `llm-wiki · not
ready`, with `· no runner` appended when none is installed. Click opens the
dashboard. A job that stops between two polls raises an Obsidian Notice.

### Dashboard (main area tab; ribbon icon, command "Open dashboard")
Header: title, one health pill (`ok` or `N need you`), refreshed time, Refresh,
Chat. Four tabs, remembered per tab leaf.

**Overview** — do I need to do anything?
- One sentence: "2 things need you. Running Curate…. 1 job is due now."
- *Needs you* (count = the pill): one row per item, one button each.
  Sources: a job whose skill has an empty credential slot here (**Set
  credential**), a stopped job whose credential is stale or failed (**Replace
  credential**, which also retries the stopped ticket, with **Retry** beside
  it), any other parked ticket (**Retry**), a ticket in review (**Ask the
  agent**), a blocked job (**Ask the agent**), a doctor warn/fail row (**Fix
  with the agent**), a drifted skill (**Inspect**), an unreadable job, a handoff
  problem, a git conflict (**Open**), search engine not ready (**Reindex**).
  Info rows (an update available, an enabled skill with an empty optional slot)
  follow under a small "Also" label, uncounted. With no runner installed, one
  notice here with **Install the runner** (a chat hand-off).
- *Running and due*: up to four cards, then "and N more"; a click opens the
  job's detail dialog.
- A wiki with no jobs shows one card instead: "Nothing is pulling into this
  wiki yet", what a job and a skill are, **Add a job…** and **Browse skills**.
- *Waiting for curation*: count, first five paths, how many new files under
  sources/ are not yet in the wiki; Review goes to Pages.
- *Last day*: "3 runs, 1 failed. 2 pages are waiting for review." then the
  runs in words (Scheduled pass, Harvest yt-subs · failed, with the summary).

**Jobs** — a table grouped by state (Needs you, Running, Due, Scheduled,
Manual, Paused), soonest first inside a group; a filter field above 10 rows.
Columns: Job (name, slug · kind), Every, Last (relative time; a failure shows
its reason in red), Next (Due now / Queued / Running 3m · ticket / Paused /
Held until / in 9h / Blocked: why / **Needs a credential** / **Credential
stale**; "When you press Run" when no runner is installed). One primary
button per row: Set or Replace credential, Run when due (or always, without a
runner), Resume when paused; a "…" menu holds Run now, Pause, Details, Ask the
agent. Clicking a row opens the job's detail dialog. "Add a job…" asks one
line in plain words and hands it to chat as `/llm-wiki:add <text>`. Nothing
on screen says running or due that the ticket store does not.

### Job detail dialog
Name; slug · kind · schedule · skill. The Next state in words with the
verdict's reasons. *What it needs on this machine*: each credential slot with
Set / Replace credential. *Last runs*: the job's tickets newest first (stage,
ok / stopped / dropped, reason, when, runtime, Retry on a stopped one).
Footer: Run / Pause / Replace credential, Ask the agent, Close.

**Skills** — three groups then credentials.
- *Enabled on this machine*: name · venue, one pill at most (`credential
  missing` / `credential stale` › `differs from the wiki` › `update
  available`), the jobs using it. One button: **Set credential** or **Replace
  credential** when a slot is empty or broken; else **Run job** (one job) /
  **Jobs** (several) / **Run** (a skill with a typable usage line). Clicking
  the row opens the inspector.
- *In the wiki, not enabled here*: the unit's description; **Enable** → chat
  `/llm-wiki:enable <name>`.
- *Available from the package*: rows with the unit's description (read from
  the package cache's SKILL.md); **Add** → chat `/llm-wiki:enable <name>`.
- *Credentials*: name · kind (secret / folder / login), a state pill always
  (verified 2d ago / failed / stale / empty / not verified yet), "Used by …";
  a harness login says it is used by chat and every model session.
  **Replace…** (same dialog, name fixed; primary when failed or stale),
  **Remove** (confirm names who loses it), **Log in** for a harness login
  that is failed or empty. "Add a credential…" opens the dialog with nothing
  prefilled.

**Pages** — *Awaiting curation* rows (title from frontmatter, path, folder):
click opens the note; Accept, Reject… (one-line reason); "Ask the agent to
curate". *Not yet in the wiki*: files under sources/ the wiki has not adopted:
Adopt / Adopt all. An older CLI says it cannot tell.

### Inspect (skill dialog)
Header: state · version · package, then the unit's description sentence. *What it needs on this machine*: each slot
(required/optional, bound credential or "not set") with **Set credential**.
Facts: jobs using it, what a new job asks for, the CLI's warnings. Tabs Skill /
Enabling / Usage render SKILL.md and the unit's reference notes (the files
Obsidian hides). Footer: Run / Enable / Install and enable, Close.

### Credential dialog
Title "Credential for channel-gmail" (or "Add a credential", "Replace x").
One sentence in words: "channel-gmail needs a token or key on this machine."
Name (prefilled `<skill>-token` or `-profile`), Kind only when the slot does
not already say (Secret value / Folder on this machine), the secret (password
field, piped to the CLI's stdin, never argv) or a folder path. *Bind to*
appears only when the skill has several jobs: the skill (checked; covers every
job) and each job (overrides for that job only). The button reads Save, Save
and bind, or Save and retry when it came from a stopped job. Errors stay in
the dialog; the Notice never carries the value. The write runs as an attended
session because a person clicked.

### Chat (right sidebar)
Mode select Agent / Ask. Agent = a Claude Code session at the wiki root,
unjailed, with the wiki's hooks, permission cards in the pane ("Run this?",
Allow / Deny), `credentials get` denied. Ask = one jailed `harness run` per
turn, read-only. New chat, **Skills…** (a fuzzy list of the llm-wiki slash
skills read from the installed Claude Code plugin; asks for arguments; starts
the turn). Chips: three prompts by the active note. Composer with Send / Stop.
Every dashboard hand-off lands here prefilled, not sent. A tool row for an
llm-wiki command reads in words ("Running inbox-joe", "Reading the job
list"), the command itself on hover; the permission card keeps the raw
command. Chips on an empty chat: "What needs attention in this wiki?", "What
did the wiki learn since yesterday?", "Add a source…".

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
- **Cycle 2 (2026-10-23)**: fable review 1 folded. A stopped job whose
  credential is stale or failed routes to Replace credential (retry rides
  along) instead of a bare Retry; credential problems show on the job row,
  the skill row, the credential row and in both dialogs; a job detail dialog
  with its last runs; the first-morning card; "when you press Run" and an
  Install-the-runner hand-off without a runner; jobs grouped by state with
  one primary button and a menu, a filter above 10 rows; available skills as
  rows with their description; chat tool rows in words; the quieten list
  (health sentence, Also label, credentials wording, read-failure sentence).
