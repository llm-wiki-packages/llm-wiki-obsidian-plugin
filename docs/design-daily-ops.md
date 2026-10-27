# Design: daily operations after the page-state and templates CLI work

**Status:** proposal (2026-10-27), not built.
**Reads:** llm-wiki-plugins #3663/#3668 (page templates, `page template`), #3669
(page state model: `Draft`, `Archive`, sticky acceptance, derived `status`),
`git commit` (the sweep), `git sync`, `page history`, `git log`.

## What changed on the CLI side, in one list

| Capability | Verb | What the plugin gets |
| :--- | :--- | :--- |
| Template fill as a patch | `page template <page>` / `page template dest=<dir> title=` | `add` (keys to add), `dates`, `body`, `unexpanded`; writes nothing |
| Templates on CLI writes | `page create` resolves `[page.templates]`; `page edit template=` fills gaps | agents and jobs already get templates; only Obsidian's own "New note" does not |
| Three facts, one status | `Draft` and `Archive` checkboxes, a non-empty `verified` = accepted; `status` derived and mirrored | `page ls` rows carry `draft`, `archive`, `curate_candidate`, derived `status`, `change`, `behind` |
| Sticky acceptance | edits never send an accepted page back to curation | "Waiting for you" stops refilling with pages the user already accepted and then edited |
| Hold | `Draft: true` | a person can park a page; nothing automatic takes it |
| The sweep | `git commit` with no paths | adopts new sources, observes edits, mirrors status, commits grouped by author; holds pages inside the settle window |
| Sync | `git sync`, `git flush` | pull with rebase then push; **a dirty tree defers the pull** |
| History | `page history <path>`, `git log [path] filter=since:/op:/actor:` | commits with `op`, `actor`, `session` trailers |

**Asks to file on llm-wiki-plugins** (filed together once the list is closed):

1. **Page identity: one handle, findable, kept unique.**
   - **`id=<document_id>` on the single-page verbs:** `page edit`, `append`,
     `read`, `history`, `diff` and `template`. You give exactly one of a path
     or `id=`. No match is refused. More than one match is refused, naming
     every path; it never guesses. Every answer returns the resolved `path`.
   - **`page ls id=<document_id>`**, with no path needed, plus `job=`,
     `resource=` and `resource_id=`. These are exact single values and are not
     split on commas. Rows gain `title`,
     `resource`, `resource_id` and `job`. `page ls` is the find verb: skills call it before
     they create or edit. A `page upsert` can come later.
   - **An identity cache behind `page ls`**, covering `document_id`,
     `resource`/`resource_id`, `job` and the other hot filters. The duplicate
     checks in `page edit` and lint read it too.
   - **Guard duplicates where ids are written, not in git.** No pre-commit
     hook for now (jails make hooks costly; a follow-up if duplicates bite).
     Instead:
     - `page create` mints a fresh id, so it can't duplicate;
     - `page edit` refuses a `fields=document_id=` that another page already
       carries;
     - the warn-only write guard (`commands/guard`) warns when an agent's write
       leaves two pages with one id;
     - doctor and lint surface the rest (Obsidian "Make a copy", `cp`, a merge).
       Which copy is newer is visible from git.
   - **Every page the CLI writes has an id.** `page create` already mints one
     wherever it writes (`create.py:91`). `page edit` (and `append`) mints one
     on a page that has none, under any tree, so a hand-made `wiki/` or
     `research/` page gains identity the first time the CLI touches it. Hand
     creation in Obsidian stays allowed; an opt-out can come later.
     - This reverses #3669's "a hand-made `wiki/` page carries no identity, by
       design". `IDENTITY_MISSING` stays scoped to `sources/`.
     - An id makes a `wiki/` page observable to the sweep (revision bumps on
       content change, `adopt.py:86`), which is the consistency we want.
   - **`page fix <paths…|id=> [--dry-run] [--force]`: repair what lint can
     repair, in one shot.** Each lint code declares whether `page fix` owns
     it. The first set:

     | Code | Repair |
     | :--- | :--- |
     | `IDENTITY_DUPLICATE` | re-mint the **newer** copy (by git: added later, or uncommitted): a new UUID, revision 1, and the original's `verified`, `generated`, `harvested`, `job` and `resource_id` dropped. A copy is a new, unaccepted page, and a re-pull must not find two pages for one `resource`. A named page that is the older copy is refused, naming the newer |
     | missing identity | mint one |
     | `STATUS_MIRROR_STALE` | rewrite the mirror from the boxes |
     | `UX_KEY_NOT_BOOLEAN` | `"true"`/`"false"` strings become YAML booleans; anything else is reported, not guessed |
     | tags shape | `normalize_tags` |

     - **Re-index in the same call** when an id changed, for both the copy
       and the original. While two pages shared one id, the index held one
       document for both, and either may have won.
     - **No judgment calls.** Lint findings that need a person
       (`ARCHIVE_UNBOXED`, content errors) are reported, not fixed.
     - **No settle window.** It runs when something needs fixing, and every
       repair is frontmatter-only. Writes use compare-and-replace: a save
       landing between read and write is refused, and the page is reported for
       a retry. Allowed on an archived page, since the archive guard covers
       content writes.
     - **Re-minting an identity needs `--force`; everything else does not**,
       minting a missing id included. A changed `document_id` cascades:
       - `sources[].id` citations on `wiki/` pages that resolve by id;
       - the search document keyed by it;
       - job and refresh lookups;
       - anything outside the wiki that recorded it.

       "Newer by git" can also pick wrong. A renamed original reads as added
       later unless history follows renames. Without `--force`, the answer
       names the page it would re-mint and that cascade, and writes nothing.
       `--force` is refused in a scheduled session, as on `page edit`, so an
       identity change always has a person behind it. The plugin passes it for
       a copy it just watched Obsidian make: an uncommitted file whose id
       matches a committed page.
     - **`--dry-run`** answers the plan: per page, what would change.
     - **Callers.** Doctor's `--fix` and lint's fix route both point at it.
       The plugin calls it on a copy it sees Obsidian make.
     - It replaces the `page edit --new-id` idea: one verb that repairs a page,
       not one flag per defect.
   - **Lint and doctor `IDENTITY_DUPLICATE`**, which names every page sharing an
     id, newest first by git, with `page fix <newer>` as the fix.
2. **`resource_id`: the page's upstream identity, beside `resource`.**
   - Today `resource` is a plain string, the URL fetched. Every reader checks
     `isinstance(str)` (`known_pages`, `refresh._page_for`, the landing), and
     search reads it as `canonical_url`. **That stays as it is:** `resource` is
     the link.
   - **New well-known key `resource_id`:** an opaque string naming the item
     within its `resource`. `resource` alone need not be unique (one Gmail
     URL, one course page, one SPA route can back many pages);
     **`resource` + `resource_id` is**, among one job's committed pages.
     Examples:
     - `youtube:<video id>`;
     - `gmail:day:2026-10-27`, `gmail:msg:<id>`;
     - `notion:<page id>`;
     - `section-3` for one of many pages from a single item.

     The unit chooses the value and must keep it stable. A page with no
     `resource_id` is keyed by its `resource` alone, as today: URL jobs keep
     working with no migration.
   - **`resource` is a URI, not only a URL.** OKF §4.1 already says "a URI
     identifying the underlying asset". `note-format` (the `resource` rows in
     both tables) says "the URL fetched" and changes to say URI. Display and
     search link it only when it is `http(s)`.
   - **Lookups are exact single values**: `page ls job=<slug> resource=<uri>
     resource_id=<id>` (just `resource=` for a unit that writes no id).
     `known[]`, refresh's page lookup and the landing match the same pair.
     The same match through `filter=prop:` needs the quoting in ask 3.
   - **Search indexes both by default:** `resource` and `resource_id` are
     stored as properties (configurable search properties landed on main,
     2026-10-27), so `filter=prop:resource_id=…` runs on the engine too.
     Make them built-in defaults, or `NOTE_FIELDS` entries like
     `document_id` (byte-exact), rather than lines in the seeded
     `[search.properties]`. Seed lines would reach new wikis only (ADR-0006),
     and the engine needs a reindex when the set changes.
   - **Why not an object `resource: {url, id}` hashed whole:**
     - every reader's string check would treat it as absent, so pages would be
       scraped again;
     - Obsidian's Properties panel cannot edit nested objects;
     - a unit adding one field later would silently change every page's
       identity;
     - YAML and Obsidian round-trips would need canonical hashing;
     - OKF reads `resource` as a URI.
   - **Re-pulls:** find with `page ls job= resource= resource_id=`, then
     `page edit id=`, or `page create` when there is no match. A rename or move
     is safe because the identity travels with the file. #3669 no longer sets
     `Draft` on a re-pull, so no landing logic is left to fix.
   - **Companion issue on llm-wiki-skills:**
     - every unit looks up before it writes and edits by `id=`;
     - units whose URL is unstable or absent write `resource_id`:
       `channel-gmail` (ledger days), `channel-notion-tasks`, and `web-page`
       (SPAs);
     - URL units canonicalize `resource` (tracking parameters stripped).

     A unit-side id map under `_raw/` is not needed now. If one comes, it is a
     cache rebuildable from pages, because `_raw/` is machine-local and
     prunable.
3. **Quoted selector values.** `filter=kind:"a,b"` takes the quoted value
   whole: commas are literal, `\"` and `\\` escape inside, an unterminated
   quote is refused, and quoting is per value (`filter=tag:"a,b",c` ORs two).
   Today `VALUE_DELIMITER = ","` has no escape, so a URI or tag containing a
   comma cannot be matched. From a shell the whole argument must be
   single-quoted (`'filter=prop:resource="some,uri"'`), or the shell eats
   the quotes. Argv callers (the plugin, skill scripts) pass them through as
   is.
4. **`git status`** (read): the uncommitted paths under the swept trees, each
   added, modified, deleted or untracked, plus `unpushed` and `behind`.
   `status` gives counts only.
5. **Reading and diffing page versions.** All of these share one grammar for
   a version, `at=`:
   - `sha:<sha>` is a commit;
   - `rev:<n>` is the newest commit carrying `document_revision: n`. The
     revision is an integer, and not every commit bumps it: box flips and
     mirrors do not;
   - `saved` is `HEAD`, the last committed version;
   - `date:<YYYY-MM-DD>` is the page as of that day.

   The verbs:
   - `page read <path> at=<version>`: the existing window arguments
     (`section=`, `line=`, …) apply to that version.
   - `page diff <path> [from=<version>] [to=<version>]`. It defaults from
     `saved` to the working copy, and `commit=<sha>` is that commit's own
     change. The answer is structured: frontmatter key changes, typed
     (added, removed or changed), kept apart from the body's unified hunks.
   - `page history` rows gain `revision` and the `path` the page had at that
     commit, and history follows renames (`--follow`). Once renames are
     allowed, a renamed page must not lose its past.

   `git diff` stays out of it: page versions are the page group's business.
6. **`git log` with each commit's files** (A/M/D), and more than one path or a
   tree as the filter. Needed for the Activity feed. `op show` has paths, but
   only per op or session.
7. **The resolved layout**, in `status` or a read verb: which dirs feed the
   wiki, which hold `wiki/` pages, and where raw captures and templates live.
   The plugin reads this and never parses TOML.
8. **Seed `.obsidian`:**
   - `_raw/` in `userIgnoreFilters`, so capture `page.md` files stay out of
     Quick Switcher, search and the graph;
   - `types.json` declaring `Draft` and `Archive` as checkboxes (#3669 left
     this to "filed separately");
   - `showInlineTitle: true` once (1) and (2) ship.
9. *(Optional)* **Search `status:` filter** on the derived status. The plugin
   can drop its `curation` filter, whose `stale` value is gone. #3669 keeps
   the `curation` wire field, so this is a nicety.

**Checked and not needed:**
- **Hand-edit attribution:** sweep commits already carry
  `Actor: user@<machine>` (sessions: `agent@<machine>`).
- **Clearing `Draft` on a named page:** a named `page curate` clears it, so
  Accept works from the plugin.
- **Why a page is a draft:** the plugin can read this from `page history`
  (which op set `Draft`), with no new key.
- **Autostash on sync:** it is refused on purpose. The quiet-window sweep
  leaves a clean tree to pull onto.

Until 4–6 land, the plugin can read the same three things with read-only
`git` calls (`status --porcelain`, `show <sha>:<path>`, `log --name-status`)
behind the same `cli.run` interface. That is a stopgap. The seam stays the CLI.

---

## 1. Templates on "New note"

**Goal:** a page made in Obsidian starts with the same frontmatter that an
agent's `page create` gives it.

**Flow** (the templates spec names it: "the editor buffer is the only writer"):

1. `vault.on('create')`, registered inside `onLayoutReady` so the startup scan
   does not fire it.
2. Act only when **all** of these hold:
   - the file is `.md`, under a content tree (`sources/`, `wiki/`), and not
     under `templates/`;
   - it is empty, or holds whitespace only, when we read it;
   - it was created in this session (`file.stat.ctime` within a few seconds).

   Files from a sync, a pull, the Web Clipper or the CLI already have content,
   or arrive while we are not looking, so they are skipped.
3. Call `page template <path>`, a read. The answer gives `add`, `dates` and
   `body`. On `template: null`, do nothing.
4. Write `add` through `app.fileManager.processFrontMatter`. If the page is
   empty, write the `body` through `vault.process`. Never call `page edit`:
   that would race the user's editor and the settle window.

**The `Untitled` problem.** Obsidian creates `Untitled.md` and the user renames
it a moment later. The seeded `app.json` hides the inline title, so the
`title:` property is the visible title. The fix:

- Expand `{{title}}` from the file stem, unless the stem is `Untitled` or
  `Untitled N`. In that case write `title: ""` and remember the path.
- On the first `vault.on('rename')` of a remembered file, set `title` to the
  new stem if it is still empty.

**Guard rails**

- **Setting:** *Apply the wiki's template to new notes* (on by default when
  `[page.templates]` exists).
- If Templater's "trigger on file creation" or a folder template is active,
  default off and say why in settings. Two template engines on one save
  produce duplicate keys.
- **Command:** *Apply template to this page*. It runs the same fill on any open
  page, existing content included (gaps only). It uses
  `page template <page>`, then `processFrontMatter`.
- **Settings row:** *Template for this folder* shows `page template dest=<dir>`
  for the active file's folder, so "why did I get these properties" has an
  answer.
- **Register `Draft` and `Archive` as checkbox property types** if the vault
  has no type for them (`.obsidian/types.json`), so they render as checkboxes.
  The page-state spec leaves this to "the plugin's or the seed's".

**Cost:** about a day. No CLI change.

---

## 2. Auto-commit (and sync) without a runner

### Is it useful? Yes, mostly because of multi-machine

- **The pull problem.** `git sync` defers the pull on a dirty tree. A Mac with
  hand edits and no runner never pulls, even if something else syncs it. It
  stops receiving as well as sending, and the gap grows silently.
- **Everything else reads git.** Dream finds work through `op since` and
  `git changed`. The Changes feed (§3) and the page icon (§4) read commits. An
  uncommitted edit is invisible to every machine, including other tools on
  this one.
- **The sweep is more than a commit.** It adopts new `sources/` files (mints
  identity), observes edits (bumps revision), and mirrors `Draft`/`Archive`
  into `status`. Without it, a checkbox ticked in Obsidian reads one way in
  Obsidian and the old way in `page ls`.
- **Obsidian's File Recovery is not a substitute.** Its snapshots are
  per-device, kept 7 days by default, taken every few minutes, never shared,
  and carry no "who". Keep it as the undo-the-last-hour tool, and link to it
  from the history popover (§4).

### Pros and cons

| For | Against / risk | Mitigation |
| :--- | :--- | :--- |
| Edits reach other machines; pulls resume | Push publishes drafts to the remote automatically | Two levels: commit locally (private, default) vs commit and sync (opt-in) |
| History, Changes and the page icon cover hand edits | Sweep writes into files (identity, revision, mirror), seen as external modification | The sweep holds pages inside the settle window, and the mirror arm restores mtime. Run only after the vault has been quiet |
| Box flips mirror within minutes | Many tiny commits | Quiet-window batching: one sweep per burst of editing, not per save |
| Fewer conflicts: smaller divergence between machines | Real conflicts still happen | `git conflicts` already surfaces on Overview; keep it there |
| | Runs twice when a runner exists | Defer when `snapshot.runner` is present ("Handled by the runner on this machine") |
| | Vault also synced by Obsidian Sync or iCloud: two sync systems fight | Detect Obsidian Sync (core plugin enabled) or an iCloud path; allow local commits, refuse auto-sync, explain |
| | CPU on a big vault | Sweep only when a swept path was modified since the last sweep |

### Proposed behaviour

- **Setting:** *Save edits to history*, with three options:
  - **Off.**
  - **Commit on this machine** (default without a runner).
  - **Commit and sync with other machines.**

  When a runner is present, the setting is read-only and reads "Handled by the
  runner".
- **Triggers:**
  - The vault has been quiet for `max(settle_seconds + 30s, 2 min)` after the
    last modify in a swept path: run `git commit` (the sweep).
  - At startup (layout ready) and when the window regains focus after more
    than 10 min: sweep, then `git sync` if syncing.
  - A manual **Save now** in Changes and the command palette.
- **Visible state:** the status bar gains a quiet suffix: `Brain · 3 unsaved`,
  then `Brain · saved`, or `↑2` when unpushed. Changes shows the row described
  in §3.
- **Failure:** a sweep that holds or refuses pages reports them in Changes
  under "Not saved yet". It never raises a Notice per run. Conflicts go to
  *Needs you*.

**Cost:** about a day for local commit, plus a day for sync and the guards. It
works today. It is better with `git status` (gap 1).

---

## 3. Tabs, Overview and Changes (revised 2026-10-27, round 2)

### Tabs

`Chat | Search | Overview | Changes` … `More ▾` → `Jobs | Skills | Credentials`.
Ingest goes away as a name; its work lives in Changes.

### The words: Accept is the verb

A person **accepts sources into the wiki**. Every page under a feeding
directory (today `sources/`; later, whatever the layout config names) is in
exactly one of four states:

| On screen | Facts (#3669) | Means | Actions offered |
| :--- | :--- | :--- | :--- |
| **New** | no status, a curate candidate | a job brought it in, or you dropped it in; nobody has looked | **Accept**, **Draft** (hold it to work on), **Archive…** |
| **Draft** | `Draft: true` | you, or a re-pull, are holding it; nothing automatic touches it | **Accept**, **Archive…** |
| **Accepted** | non-empty `verified` | in the wiki; the agent folds it into wiki pages; edits never take it out | **Back to draft** |
| **Archived** | `Archive: true` | out of search and the agent's reach | **Restore** |

How each action is carried out:

| Action | On a page under a feeding dir | On a `wiki/` page |
| :--- | :--- | :--- |
| **Accept** | `page curate <path>`. Accepts the page; a page that is named in an attended call also has `Draft` cleared. | Untick `Draft`; dream acknowledges the page on its next run |
| **Draft** / **Back to draft** | Tick `Draft` through `processFrontMatter`: an Obsidian save of a key the person owns, which the sweep then mirrors | same |
| **Archive…** | `page curate reject=<reason>` | `page retire reason=` |
| **Restore** | Untick `Archive` (acceptance underneath comes back) | same |

"Accept" means accepting into the wiki. "Publish" was rejected because it
reads as making the page public; "Keep" was too vague. Each button's tooltip states the consequence in the words of
the "Means" column.

### Changes: three subtabs

`New (74) · Drafts (6) · Activity`, with the count on each. The "Not saved
yet" strip from §2 sits above all three, and only when there are unsaved
edits.

**New: what came in.** It answers "what's new" without making you scroll
69 YouTube rows.

- **Grouping**, a toolbar dropdown: *by source* (the page's `job` key, with
  the job's name as the label; a page with no job falls back to its folder),
  *by folder* (the parent directory), or *none*.
- **Collapse rule**: a group with more than *N* items (default 5, set in the
  same toolbar and remembered) shows as one row: "YouTube · Lex Fridman ·
  69 new videos · `sources/youtube/lex` · newest 2h ago". The row has
  **Accept all…** (confirm above 10), **Archive all…**, and **Review** (expands
  the group in place). Smaller groups show their pages directly.
- **Page row**: the title, a one-line excerpt or `summary`, the host, how long
  ago. Actions: **Accept**, **Draft**, **Archive…**, and an overflow menu (Open, Ask
  the agent).
- **Keyboard**: `j`/`k` to move, `y` to accept, `d` to draft, `x` to archive,
  `o` to open, `Enter` to expand a group.

**Drafts: the quick-review queue.**

- Every page with `Draft` set under any lifecycle tree, newest edit first.
- **Layout**: on a wide pane, the list sits on the left and a live preview
  (`MarkdownRenderer`) on the right. On a narrow pane, a row expands to its
  preview. Review → Accept → the next draft is selected, so a queue of drafts
  clears without leaving the tab.
- **Why it is a draft**, shown as a line under the title:
  - "You marked it" (a hand box).
  - "Re-pulled: the source changed after you accepted it". This is #3669's
    `stamp_meta` path. Here the preview offers **What changed**, a diff
    against the last accepted version (needs the CLI's `page diff`).
  - "Research note" (the research skill lands its notes as drafts).
- **Filter chips** by tree and folder.

**Activity**: the feed from round 1 (day → who → files with A/M/D, then diff).
Filter chips: You / Jobs / Agent, and by tree.

### Overview: health, fleet, jobs

Overview becomes the wiki's dashboard. It no longer lists pages, except as one
line pointing at Changes.

1. **Health strip**: one sentence, then three small status pills: *Search*
   (fresh or N stale), *Sync* (saved, N unsaved, ↑ unpushed, ↓ behind),
   *Runner* (here, elsewhere, or none). Each pill opens the place where it is
   fixed. Below the strip, *Needs you*, shown only when it has rows.
2. **Fleet** (only when `status --peers` lists more than this machine):
   - **The picture**: the shared remote at the centre, each machine a node
     around it. The node shows its name, a state dot (ok, stale or stuck, from
     `fleetrow.state`), "seen 3m ago", and a small badge for each stage it holds
     (harvest, process, dream). This machine is outlined and carries its
     ↑/↓ counts.
   - **Edges**: an edge fades with the machine's `last_seen`, and turns red for
     a stuck machine.
   - **A click** on a node lists that machine's jobs and its capabilities.
   - **One machine**: a single compact card ("Only this Mac. Add a machine…").
3. **Jobs**:
   - *Running now*, as live cards.
   - *Due and up next*: the next 6 by time, each with **Run** and the time
     until it runs.
   - **All jobs →** goes to the Jobs tab.
   - The per-job last outcome stays on the Jobs tab. A failure already raises a
     *Needs you* row.
4. **One line**: "Today: 74 new · 6 drafts · 12 edits →", which opens
   Changes.

**Cost:**
- Changes with three subtabs: about 3 days.
- Overview: about 1 day.
- The fleet graphic (SVG, no library): about 1 day.

### One place for layout

Custom layouts are coming (dirs configurable in `.llm-wiki.toml`), so the
plugin keeps **one** module, `src/wiki/layout.ts`, that answers every
path question:

- `isFeed(path)`, `isWiki(path)`, `isLifecycle(path)`, `neverIndexed`,
  `rawDir`, `templatesDir`, `newNoteFolder`.
- It is filled from the CLI's answer: a read verb or `status` field returning
  the resolved layout. That is a fourth small CLI ask. The plugin never parses
  TOML.
- Its built-in defaults are the only place `sources`, `wiki`, `_raw` or
  `templates` are spelled in the plugin.

Prefer the CLI's row fields to path tests wherever the CLI already decided:
`curate_candidate`, `draft`, `archive`, `status`, `behind`. The plugin should
not reimplement "is this page acceptable".

Today's hardcoded spots, which all move:
- `snapshot.ts:232` (`startsWith('sources/')`);
- `searchText.ts:100` (`wiki/index.md`, `wiki/log.md`);
- the Ingest copy;
- the `curationItem` folder guess.

## 4. Page header: saved state and history

**Possible:** `MarkdownView.addAction(icon, title, cb)` puts an icon in the
view header's top-right action group, beside the existing "…". Update it on
`file-open`, `active-leaf-change`, and our own sweep/refresh events.

**The icon, one glyph and a tooltip:**

| State | Icon | Tooltip |
| :--- | :--- | :--- |
| Saved, nothing changed since | `history` (muted) | "Saved · last change 2h ago by Dream" |
| Edited since the last save | `history` + accent dot | "Edited · not saved to history yet" |
| New, never saved | `file-plus` | "New · not in history yet" |
| Outside the wiki's trees / not a git checkout | (hidden) | |

A small lifecycle badge (`Draft`, `New`, `Archived`, `Source changed`) can sit
beside it as text. That is optional: the properties panel already shows the
boxes.

**Clicking it opens a popover (a Menu-like panel) with:**

- the state line, plus **Save now** when edited;
- **Changes since last save** → the diff modal (working copy vs `HEAD`);
- the last 10 commits from `page history`: when, who (You / job / agent op),
  subject. A click opens the diff for that commit (its parent vs the commit);
- **All history…** → the modal with the full list;
- **Local snapshots…** → Obsidian's File Recovery for this file
  (`file-recovery:open`), when the core plugin is on.

**Diff modal:**

- Line diff, rendered side by side on wide panes and unified on narrow ones.
- Frontmatter changes listed apart as "Properties: `Draft` ✓, `tags` +x".
  Most pipeline commits touch only properties, and a text diff of YAML is
  noise.
- Prev/next commit arrows.
- **Restore this version** (writes through `vault.modify` after a confirm; the
  sweep saves it as a normal edit).
- A small dependency (`diff`, ~30 kB) or a hand-rolled Myers diff. Both texts
  come from `page diff` (gap 2) and the vault.

**Cost:** about a day for the icon and popover from `page history` plus
`git status`. About two days for the diff modal. The diff needs gap 2.

---

## 5. Titles, renames, and pipeline pages

**What happens today when a person renames a harvested page.** Traced
through `channel-youtube` and the core extractor at #3669:

- **Where the page lives.** A YouTube page lives at
  `<dest>/<video title>.md`, named from the title. `page.md` is only the
  capture's body copy in `_raw/<job>/…/`.
- **Rename inside the job's `dest`:**
  - The next harvest is **fine**. `known[]` is read from the pages under
    `dest` by their `resource` (`ticket_rows.known_pages`), so the video is
    not pulled again.
  - A refresh that finds the video unchanged is **fine**. Refresh finds the
    page by `resource` (`refresh._page_for`) and restamps the renamed file.
  - A refresh that finds the video **changed** is **a bug: a duplicate.**
    `youtube_note.write_page` calls `page create title=<video title>`, and
    that filename is free now, so a second page lands with the same
    `resource`. The renamed page keeps the old text and your edits. The new
    page is a fresh New candidate. The re-pull's held check and its
    `repulled` Draft both look at the renamed page, not the new one. The core
    extractor has the same shape: `pages.page_rel` only checks whether the
    title-derived name carries this resource.
- **Move out of `dest`** (into another folder): `known[]` no longer sees
  it, so the next harvest pulls the video again as a new page. Another
  duplicate.
- **Citations from `wiki/` pages are safe.** They resolve by `resource`
  and `id`, not by path. Obsidian's `alwaysUpdateLinks` rewrites `[[links]]`
  in other pages, which then show as edited by You: noise, not harm.

**Why `page.md` shows up everywhere.** `_raw/` is a top-level, visible
folder in the vault. The seeded `app.json` ignores only `*.json`, so every
`page.md` capture copy is in Quick Switcher, search, the graph and link
suggestions.

**Proposal:**

1. **CLI and skills: a re-pull finds its page by identity, not by name.**
   It looks up with `page ls job= resource= resource_id=`, then edits with
   `page edit id=`, or creates when there is no match. This is ask 1
   (`id=`) and ask 2 (`resource_id`) in the list at the top, plus the
   llm-wiki-skills companion issue. It is the prerequisite for everything
   below.
2. **Seed and plugin: hide `_raw/`.** Add `_raw/` to `userIgnoreFilters` in
   the seed. For existing vaults, the plugin offers to add it once.
3. **Turn the inline title back on, with one title.**
   - **The filename is the title.** When a file is renamed (by the inline
     title or the explorer), the plugin sets the `title:` property to the new
     name. Two titles can no longer disagree.
   - **Harvested pages** keep the venue's true title in the body's H1 and in
     `source_title`, which youtube already writes when the filename rule
     altered it.
   - **The `Untitled` problem from §1 goes away:** the user types the title
     into the inline title, which renames the file, which updates `title:`.
4. **Until (1) lands:** on renaming a page that carries `job` and
   `resource`, show a Notice: "This page is followed by *job*. A changed
   re-pull will land a second copy under its original name." Offer
   **Undo rename**.

## Suggested order

1. **CLI asks, filed first:**
   - `git status` with paths;
   - `page diff`;
   - `git log` with paths;
   - the resolved layout;
   - a re-pull landing on its resource's page (§5).
2. **`layout.ts`**, and moving every hardcoded path into it. Small, and it
   blocks nothing else.
3. **Templates on New note** (§1), plus hiding `_raw/`.
4. **Changes: New, then Drafts, with Accept/Draft/Archive** (§3), on
   `page ls` rows from #3669.
5. **Overview: health, jobs, then the fleet** (§3).
6. **Auto-commit locally** (§2). Activity becomes truthful for hand edits.
7. **Page icon and popover**, then the diff modal (§4), once `page diff`
   exists.
8. **Inline title back on, with filename = `title:`** (§5), once the
   re-pull fix ships.
9. **Auto-sync** (§2, second level).

## Open questions for the owner

1. Auto-commit default: on without asking when there is no runner, or ask
   once?
2. Should Accept on a page that was accepted before and then re-pulled
   (a pipeline Draft) re-run `page curate`, which appends `verified`? Or should
   it only untick `Draft`? The proposal: re-run curate, so a re-judgment is
   recorded.
3. CLI gaps: own verbs, or a read-only direct `git` from the plugin as a
   stopgap?
