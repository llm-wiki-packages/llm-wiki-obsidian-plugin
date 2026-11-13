# Changelog

What changed in the plugin, newest first, and which llm-wiki-ops release
each change was checked against. Kept by hand: add a line under
**Unreleased** in the PR that makes the change.

Each entry says what a person sees. Group lines under **Added**, **Changed**,
**Fixed** or **Removed**. When a change follows the CLI, name the ops release
and, where there is one, the llm-wiki-plugins issue.

## Syncing with the CLI

Do these in order when a new llm-wiki-ops release comes out:

1. Read the release notes: `git log -1 --format=%b <release commit>` in
   llm-wiki-plugins, and the `version-intents/` files of the batch commits
   (`ops: assign the version ...`) between the last checked release and it.
2. Install the release into a scratch venv outside `/tmp`, with its own
   `llm-wiki-install.env` and machine home. Run `init` and `join key=scratch`
   there. Never point it at a real wiki.
3. Run every argv in `src/wiki/cli.ts` `VERBS` against the scratch wiki. A
   `No such command` or an unknown-argument error is a break.
4. Run the end-to-end test: `LLM_WIKI_E2E_BIN=<venv>/bin/llm-wiki-cli
   LLM_WIKI_E2E_VAULT=<scratch wiki> npx vitest run test/e2e.test.ts`.
5. Check the enums the plugin switches on: `verdict.kind`, ticket states,
   `jobs request` outcomes, page states.
6. Regenerate `src/chat/readVerbs.ts` from the registry's read tier.
7. Add the result here, and update `MIN_OPS` in `src/wiki/cli.ts` if the
   plugin now needs the new release.

## Unreleased

Checked against llm-wiki-ops 0.18.0. Needs 0.16.0 or later.

### Fixed

- The "This vault predates the wiki's Obsidian settings" offer no longer
  comes back on every launch after Apply. Newer Obsidian renamed the call
  that reads a property's type, so the plugin missed the types Apply saved.
- Reloading the plugin no longer adds a second Listen or Page history
  icon to each open note.
- The credentials list loads again: `credentials ls` is `credentials list`
  from ops 0.16, and the old name is refused.
- The inbox's remove button works again: `inboxes rm` is `inboxes remove`.
- Ask first no longer asks about each lookup the agent makes: the read
  verbs that run without asking come from the 0.18.0 registry, `list`
  spellings included.
- A job with a parked run shows it as blocked, with the CLI's reason and its
  fix, not as unknown.
- Run on a job whose every run waits to retry says it is waiting, and until
  when, not that it started (`jobs request` `outcome: backoff`).

### Added

- **Listen**: a headphones icon in each wiki page's header. Its menu plays the
  page's audio, or records it as written with this machine's narrate engine
  (`narrate <page> mode=read`: local, no model, a minute or more). Recordings
  wait in line, and a Notice with **Play** says when each is ready. The icon
  shows when the audio is older than the text or the last recording failed. A
  page with a webvtt script can voice it as an episode. A player docked above
  the status bar keeps playing across notes, with ±15 s, speed and media keys.
  With no engine set up, it shows the command the CLI names. The stale cue works
  around llm-wiki-plugins #4721: new audio reads stale on 0.18.
- Lent values in Properties. On a bundle root, each key it lends carries a
  layers mark whose tooltip says how many pages the value reaches. On a page
  under one, a lent value is muted and names its root, and a lent tag is a
  dashed pill with no remove button. A line under Properties says it in words,
  with **Why?**: a panel from `page explain` that lists the roots, each value's
  source, and what the next write changes. Setting: *Mark lent values*.
- A job that runs only on a trigger shows **On a trigger**.
- A CLI older than 0.16 is named at detect, with what to update.

### Changed

- The Inbox names each conflict by the page and the source that disagree,
  not by the record's ids. Click a conflict to see what the wiki says and
  what the new source says, side by side, with their quotes. An empty
  Messages box no longer takes the top of the tab; one line at the
  bottom says there are none.
- An opened conflict asks "Which is right?". **Keep the wiki** closes it
  and archives the ruling with it. **Use the new source** and **Both are
  true** put a ready prompt in chat, so the agent rewrites the page with the
  right citation, then closes the conflict.
- Every list verb is spelled `list` (`ls` still works on the CLI).
- The `extract` stage, formerly `transcribe`, shows as *extracting*.
- The Reports tab names the `morning-brief` skill, formerly `daily-report`.

## History before this file

One line per merged PR, from the git log.

- #26 Job-owned blocks: tint, first-edit notice, read-only discard blocks,
  set-aside diff.
- #25 Jobs check, Re-point on a folder rename, updates waiting and held pages.
- #22 Offer an older vault the wiki's Obsidian settings.
- #21 Draft only on a page: never write frontmatter into a dropped file.
- #20 Support llm-wiki-ops 0.15: approval gate, page shape 3, page conflicts.
- #19 Other HTML skips raw captures; set up the search engine from the plugin.
- #18 A Sources panel on each note, sources in the graph, and sources folded
  in Properties.
- #17 Inbox tab: Reply/Done over the user inbox, and the needs-you count on
  the Overview.
- #15 HTML files open in a sandboxed view; a Reports tab for the morning
  briefs.
- #14 More › Config: the wiki's own settings, beside the plugin's.
- #13 Waiting to be indexed lists search status's `dirty_paths`.
- #12 Read the CLI's #3675 arc: diffs, file lists, layout, copy identity,
  editor origin.
- #11 Skills palette and dashboard filter on manifest mode.
- #10 Chat: tool calls open to show what ran.
- #9 Chat UX pass: plain chips, tool rows that open their page, Ask first
  asks about writes.
- #8 Plain-language message when the settle window holds Accept or Archive.
- #7 Daily-ops redesign, part 1: Changes tab, Overview, templates on new
  notes, history.
- #5 Brain rename, tab reorder with More, search freshness, filters and
  index dialog.
- #4 Spell slash commands through one brain namespace constant.
- #2 Sandboxed chat: one conversation session per chat.
- #1 Command center: dashboard, jobs, pages, status bar, Agent/Ask chat.
