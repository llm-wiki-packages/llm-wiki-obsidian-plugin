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
item is a stopped job) / `llm-wiki · running Joe's mailbox` (only when nothing
needs a person) / `llm-wiki · not ready`. Click opens the dashboard. A job
that stops between two polls raises an Obsidian Notice; writes whose row
visibly changes (accept, pause, remove…) raise none.

### The view (main area tab; brain ribbon icon, command "Open dashboard")
Header: title, one health pill (`ok` or `N need you`; a button: hover lists
what needs you, click opens the Overview from any tab), refreshed time,
Refresh (icon), a gear for the plugin settings. Seven tabs, remembered per leaf:
Overview, Jobs, Skills, Ingest, Credentials on the left; Search and Chat on
the right. A note opened from the view goes to a new tab (Cmd-click: a
split), never into the view's own leaf. Chat and Search are panes built once and kept across tab
switches; a snapshot never redraws them. Text is selectable everywhere.

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
  wiki yet", what a job and a skill are, **Add a source…** and **Browse skills**.
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
agent. Clicking a row opens the job's detail dialog. "Add a source…" asks one
line in plain words and hands it to chat as `/llm-wiki:add <text>`. Nothing
on screen says running or due that the ticket store does not.

### Job detail dialog
Name; slug · kind · schedule · skill. The Next state in words with the
verdict's reasons. *What it needs on this machine*: each credential slot with
Set / Replace credential. *Last runs*: the job's tickets newest first (stage,
ok / stopped / dropped, reason, when, runtime, Retry on a stopped one).
Footer: Run / Pause / Replace credential, Ask the agent (the prompt carries
the state, the reason and the last failure), Close.

**Skills** — three groups.
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
**Credentials** — *Stored on this machine*: every credential by name, kind
(secret / folder / login) and state pill (verified · failed · stale · empty ·
not verified yet), who uses it; Replace… (the accent only when it is broken
and used), Remove (confirm names who loses it), Log in for a harness login;
"Add a credential…". *Needed by an enabled skill*: each empty required slot
with **Set credential**.

**Ingest** — the intake pipeline, top to bottom, with one line saying so.
*New under sources/*: files the wiki has not adopted: Adopt / Adopt all;
an older CLI says it cannot tell. *Awaiting curation*: drafts grouped by
the folder they landed in, each group with **Accept all in <folder>**; rows
(title from frontmatter, path): click or Enter opens the note; Accept,
Reject… (one-line reason); "Ask the agent to curate".

### Inspect (skill dialog)
Header: state · version · package, then the unit's description sentence. *What it needs on this machine*: each slot
(required/optional, bound credential or "not set") with **Set credential**.
Facts: jobs using it, what a new job asks for, the CLI's warnings. Tabs Skill /
Enabling / Usage render SKILL.md and the unit's reference notes (the files
Obsidian hides). Footer: Run job / Enable / Install and enable, **Add a source with it** (chat
`/llm-wiki:add a new source using the <name> skill (it will need: mailbox): `),
Close. For a unit not yet installed, the package manifest says what it will
need and what a new job asks for, before Add.

### Credential dialog
Title "Credential for channel-gmail" (or "Add a credential", "Replace x").
One sentence in words: what is needed ("channel-gmail needs a token or key on
this machine"), what stale means for a folder ("sign in again inside that
profile and save, or point at a fresh folder"), and what the save does next.
Name (prefilled `<skill>-token` or `-profile`; the format hint appears only on
a bad name), Kind only when the slot does not already say, the secret
(password field, piped to the CLI's stdin, never argv; Enter saves) or a
folder path. *Bind to* appears only when the skill has several jobs. The
button reads Save, Save and bind, **Save and retry** (a stopped job: the
ticket is retried and the pass run at once, so a machine without a runner
does not wait) or **Save and run** (the skill's one job can run now). Errors
stay in the dialog; the Notice names the end state and never the value. The
write runs as an attended session because a person clicked.

### Chat (tab)
**New chat** at the top left (a list of past chats joins it later);
**Continue last chat** beside it on an empty pane picks the last session back
up. One kind of chat: Claude at the wiki root, unjailed, with the wiki's
hooks, `credentials get` denied in every mode. A permission card offers
Allow, **Allow for this turn**, Deny. A failed turn puts the prompt back in
the box. The duration sits on the bubble's hover.

The box, then one row under it: **Skills…** at the left (a fuzzy list of the
`/llm-wiki:` slash skills; asks for arguments; starts the turn), the
permission button, Model, Effort, then the context ring and **Send** at the
right. The ring and Send stay together when the row wraps.

- Permission button: the mode's name ("Ask first", "Full access ·
  read-only", "Sandbox: read-search"). Its panel lists Ask first,
  Auto-accept edits, Auto (disabled for a model without it), Full access,
  then a Read-only switch and a Sandbox switch with the sandbox's name.
  Sandbox on greys the modes and Read-only: a jailed turn never asks, and its
  profile decides writes. The sandboxed chat is one session that keeps the
  conversation and closes after the idle minutes set in settings; Stop
  interrupts the turn and keeps the session, and a session that ended is
  replaced with a note that earlier turns are forgotten. Switching in or out
  mid-chat leaves a note in the transcript, since each side does not see the
  other's turns.
- Model: Default, then the aliases (Opus, Sonnet, Haiku) until the first
  reply brings the harness's own list; a typed model in settings is kept.
  Effort: Default, Low to Max, levels the model lacks greyed.
- Ring: the context in use over the window, warning-colored from 80%; hover
  shows "Context window · 33% · 331k/1m" and a bar. Sandboxed, it follows the jailed session.
- Send: one button. While a turn runs it is red, spins, and says Stop.
- `/` at the start of a line opens a list of skills above the box (name,
  arguments, first sentence); arrows move, Enter or Tab takes, Escape shuts.
  A setting turns it off.

Every control writes the settings, so the next chat starts the same way. The
**Default skill** setting types `/<skill> ` into each new chat's box.
Chips: three prompts by the active note. A wikilink or URL in a reply opens on
click (Cmd-click in a new tab); a finished reply shows a Copy button on hover.
Every dashboard hand-off lands here prefilled, not sent. A tool row for an
llm-wiki command reads in words ("Running inbox-joe", "Reading the job
list"), the command itself on hover; the permission card keeps the raw
command. Chips on an empty chat: "What needs attention in this wiki?", "What
did the wiki learn since yesterday?", "Add a source…".

### Search (tab)
One field; a pause in typing or Enter searches, and a new search kills the one
in flight. Results with title, path and snippet; click opens the note. "No
pages match" for zero hits, the degradation reason when the engine is
degraded, and **Ask the agent about this** carrying the query.

### Commands
Open dashboard / chat / search, Run a job… (fuzzy), Open a job… (fuzzy, the
detail dialog), Add a source…, Set a credential… (fuzzy over empty or broken
slots), Run a skill… (fuzzy), Ask the agent about this note, Refresh,
Re-detect, **Accept this draft** and **Reject this draft…** (on the active
note when it is a draft). Rows in every list take focus and open on Enter;
Escape in the composer stops a running turn.

### Not ready
A card instead of the dashboard: "llm-wiki-cli was not found" or "This vault
is not a registered wiki" with the registered wikis as one-click choices
(for a vault under another path), the two commands to copy, **Re-detect** and
**Open settings**. A detect whose outcome differs from the last launch raises
one Notice naming the wiki and the binary; settings say what a missing
`claude` costs (Agent chat).

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
6. **Ask something**: chat; Read-only or the Sandbox switch for an answer that changes nothing.

## How to look at it without Obsidian

`node preview/build.mjs`, serve the repo (`python3 -m http.server 8765`), open
`preview/index.html` in a browser with `?tab=jobs|skills|pages`,
`&modal=credential|skill|replace`, `&chat=turn`, `&theme=dark`, `&pane=search`.
It renders the real views over fixture data with a stand-in for Obsidian's API.

## Known gaps

- **A sandboxed chat has no memory** (owner, 2026-10-23): fixed by `harness run --conversation` (llm-wiki-plugins #3557). One jailed session now keeps the chat; this plugin needs the CLI that ships it.

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
- **Cycle 3 (2026-10-23)**: fable review 2 folded. Save and retry now runs
  the pass (a retried ticket on a runner-less machine no longer waits);
  the dashboard refreshes when a chat turn ends and after each tool call
  that changes the wiki; the credential dialog says what stale means and
  what the save does next; available units show their needs from the
  package manifest and the inspector offers "Add a source with it";
  "Last day" rows name the job and open its dialog; Pages groups drafts by
  folder with Accept all; the no-runner note sits once in the Scheduled
  group header, relative times return, long lists fold; a not-ready card
  with exits; slot keys never reach the screen (one `slots.ts`); Run all
  due, Pause all / Resume all; keyboard rows and two new commands; chat
  status noise cut; Credentials moved above the package catalog.
- **Cycle 4 (2026-10-23)**: fable review 3 folded. The retry path is whole:
  Replace credential from the Overview, the job row and the job dialog all
  carry the stopped ticket and its job, and a bare Retry runs the pass where
  no runner would; the dashboard refreshes after a tool finishes, not when
  it is called, and a refresh asked for mid-read runs again; polls during a
  run are light; redraws keep scroll, filter and expansion; Accept and
  Reject this draft commands; batch writes go in one call or in sequence;
  the older-CLI card; chat defaults to Ask without claude, keeps a failed
  prompt, offers Allow for this turn and Continue last chat; search on
  Enter with cancellation, zero-hit and degraded wording, Ask the agent;
  the quieten list (no session/cost lines, no OK toasts for visible
  changes, launch Notice only on change, status bar needs-you first, no
  "wiki notes" label, "Details" menu item gone, slot rows say the name
  once); registered wikis as choices on the not-ready card; Update in the
  inspector; Change schedule and Remove hand-offs in the job menu.
- **Cycle 5 (2026-10-23)**: fable review 4 ("would I ship it") folded. A run
  that ran and stopped says so, never "did not start"; a retried ticket that
  had already landed says so and is not run; light polls keep the skills
  doctor findings so the health count does not flicker; the retry path
  carries the job from all three entry points, and only the ticket the
  credential explains rides along; at most four CLI processes at once, and
  a full read (credentials included) every five minutes rather than every
  minute; Continue last chat only when claude is there, with the last
  prompt as its note; refresh after a write tool, not after every Read; the
  job dialog follows the snapshot while open; the agent is told never to
  ask for a secret in chat; search cancels its pending debounce on Enter
  and clears on Escape; "stopped" for tickets everywhere; the chat button
  is Commands…; the not-ready card hides the tabs; one accent per dialog.

### Cycle 6 — the owner's first live session (2026-10-23)
Twelve findings from the owner using the branch in a live wiki on a Mac.
Done: wikilinks in a reply open (the view wires its own link clicks); the
AbortSignal error on a later turn was the renderer guard probing through
itself and recursing, fixed with a test that counts what reaches Node; one
view with Chat and Search as tabs instead of two sidebar panes nobody found
(the ribbon showed one icon); standalone Search with a hint; the health pill
is a button with a tooltip; Credentials is its own tab with what enabled
skills still need; Pages is Ingest, ordered as the pipeline runs (new under
sources/, then awaiting curation) with a sentence saying so; text is
selectable and a reply has Copy; Commands… is Skills…; a gear opens the
settings; the icon is a brain; the Debug logging setting says the console's
Verbose level must be on. Confirmed as intended: Agent is unjailed and Ask is
the jailed mode. Open: Ask mode keeps no context between turns (Known gaps).
Review 6 (docs/reviews/2026-10-23-review-6.md) folded the same day: notes
open in a new tab from search, replies and Ingest rows, never in the view's
own leaf; Ingest before Credentials, the Overview button says Ingest, no
section numbers; Refresh is an icon; narrow widths stack row actions under
their text; "jail", "ticket", "sandbox", "skill stage" no longer reach the
screen. Left for later: a "Move to the sidebar" item, drafts grouped by job
name with a "pages written" row that lands on them.
- **Cycle 7 (2026-10-23)**: Ask mode is gone (owner): one chat, with a
  default skill typed into each new chat's box and the sandbox and read-only
  as switches in a permission panel under the box. That row also holds
  Skills…, Model, Effort, a context ring, and one Send / Stop button; New
  chat moved to the top left; `/` lists the skills.
