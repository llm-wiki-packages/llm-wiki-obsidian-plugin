# Design: lent keys, and the wiki's state inside a note

Status: proposal, 2026-11-12. Nothing here is built yet. Checked against
llm-wiki-ops 0.18.0 on a scratch wiki. Worked out with a design review
(Fable), whose open questions are answered in section 1.

The goal: a person reading or editing a note can see what the wiki will do
with it, without opening the Brain view.

## 1. How lending works (verified)

A **bundle root** is a page with `ops.root: true`. It sets policy for every
page under its folder. Only `sources/` and `research/` inherit. A root
names the keys it lends in `ops.lends`, and its own values of those keys
are what it lends.

Two kinds of inheritance, which the UI must keep apart:

| | Lent keys (`ops.lends`) | Folder policy |
| --- | --- | --- |
| Examples | `tags`, `course`, `instructor` | `ops.ingest`, `ops.mine`, `ops.refresh`, `ops.edits`, `narrate.*` |
| Where the value lives | Written into each child's own file, recorded in its `ops.lent` | Only on the root; read through on every read |
| Can a child differ? | List: adds its own items, cannot drop a lent one. Single: no, the root wins | A nearer root can |

What a write does to a child (ADR-0077, `lib/page/lend.py`):

- **List key** (tags). The child keeps its own items and gets every lent
  item. A lent item a person removes comes back on the next write. This is
  deliberate: the CLI cannot tell a person's delete from a robot's
  overwrite.
- **Single key** (course). The nearest root's value always wins. A
  different value a person sets on the child is dropped on the next write;
  `page edit` reports it as `dropped`. A value the child had *before* the
  root lent the key is replaced, and nothing keeps a copy.
- **A root stops lending a key.** Each child that still holds the lent
  value loses it. A child that changed the value keeps its own.

Who spreads a root's change to its children:

| Path | Asks first? |
| --- | --- |
| `page edit <root> key=…` (CLI, a person there) | Yes, when it replaces a value a child set itself. The question lists each such page |
| `page lend <folder>` | No |
| The runner's tick | No. It lends to every uncommitted page and to the whole folder of any uncommitted root. It reads the root as it is on disk, half-edited or not |
| The plugin's sweep (`git commit`) | Never lends |
| Any later CLI write to a child | Lends to that one child |

The settle window (about 10 minutes after a save) protects only the page
being written. A child edited just now is passed over. The root itself is
not protected: the tick fans out from a root you are still typing in.

What follows for the plugin:

- **No runner on this machine.** The plugin sweeps, and nothing spreads a
  root edit until a job or a CLI command writes each child. The children
  silently go stale. The plugin's Apply is the only prompt way to spread it.
- **A runner on this machine.** The plugin does not sweep, and the runner
  spreads the edit within one tick, with no question. A plugin-side
  confirmation cannot stop it (section 5, upstream asks 1 and 2).

The data the UI needs:

- **`ops.lent` on each child, and `ops.lends` on each root.** The
  metadata cache has both, so the row markers need no CLI call.
- **`page lend <folder> --dry-run`.** For each page and key it gives
  `{value, added, removed, from: {value: root}, own}`. `own: true` means
  the lend replaces a value the page set itself. A child with an empty
  answer is up to date. This is what "pending" means: the children the
  dry-run would change.
- **`page explain <page>`.** It gives the root chain, each root's lends
  and values, and for each key `{value, own, lent, stale}`.

## 2. Root editing

Principles: never guess when the person is done; never open a modal on
your own; show pending state all the time; one click to apply.

### 2.1 Rows

Each lent row in Properties gets a lend icon before the key (an arrow into
layers). The tooltip reads `Lent to 42 pages under sources/course-bio`. A
row whose value differs from what the children hold gets an accent dot and
a left border. The dry-run decides that, not a diff against git.

### 2.2 The lend bar

One bar sits under Properties on a root. It is never modal and never takes
focus.

```
Properties
  ⇣ tags        biology  course  genetics  [+]     ●
  ⇣ course      BIO-202                            ●
  ⇣ instructor  Dr. Lee
    title       Biology 101
  More ▸
┌─────────────────────────────────────────────────────────┐
│ ⇣ Lends 3 keys to 42 pages                              │
│ 2 changes not applied yet. 1 replaces a value a page    │
│ set itself.                       [Review]  [Put back]  │
└─────────────────────────────────────────────────────────┘
```

- Quiet: `Lends 3 keys to 42 pages`, and `Manage`.
- Pending: after the file write settles (about 1.5 s), the plugin runs the
  dry-run, cancels any older one, and updates the counts. A big folder
  shows `Counting pages…` first.
- Editing several fields makes one bar and one review. There is no prompt
  per field.

The bar does not depend on the row markers. Properties rows are not a
public API and may break on an Obsidian update; the bar is ours. In source
mode the bar carries the message alone.

### 2.3 When to ask

Only a click on **Review** opens the review. Two reminders, no more:

1. Leaving the root with changes pending raises one Notice:
   `course-bio has changes its pages do not have yet. Review`.
2. The status bar adds `· 1 lend waiting`; a click opens the review.

With a runner here, the bar also says, until upstream asks 1 and 2 ship:
`The runner applies this within a few minutes, without asking. Review now.`

### 2.4 The review

```
Apply course-bio/README.md to the pages under it

  course   BIO-101 → BIO-202          42 pages
  tags     + genetics                 42 pages

  ⚠ Replaces 1 value a page set itself. It does not come back.
    week1/membranes.md    course: BIO-303 → BIO-202

  3 pages were edited just now. They get the values later.

                         [Not yet]   [Apply to 42 pages]
```

- Scale first, then the pages whose own values the lend replaces, each a
  link. After 8 rows: `and 14 more`.
- No replaced values: no warning block, but the review still opens. The
  owner asked for a confirmation step.
- **Apply** runs, in order: the sweep, `page lend <folder>`, the sweep
  again. The Notice reads `Applied to 39 pages. 3 wait.`

### 2.5 Not yet, Put back, Undo

- **Not yet** closes the review. The bar stays.
- **Put back**, before Apply, sets the root's lent values back to what the
  children hold. The confirm is inline: `Put back 2 values?`
- **Undo after Apply: not in the first release.** I disagree with the
  review here. Setting the old root values and lending again restores every
  lent value, but a page's own value that the lend replaced is gone. Only
  git history has it. An Undo that half-works is worse than none. The
  review's warning says so instead. A later release can restore replaced
  values from the Apply commit's parent.

### 2.6 Making a root, and changing what it lends

All from menus; nobody types `ops.root` or `ops.lends`, which stay behind
More.

- **Make a root.** In the folder's context menu, `Lend values to pages in
  this folder…`, only under `sources/` and `research/`. Pick the keys from
  the README's own (checkboxes), then the review.
- **Lend one more key.** In the row's menu, `Lend to pages below`. This is
  the riskiest case, since it replaces every own value of that key. The
  review lists them.
- **Stop lending a key.** In the row's menu, `Stop lending`. The review
  says `Removes instructor from 41 pages. 1 page that changed it keeps its
  own.`
- **Stop being a root.** In Manage, `Stop lending from this folder`. Same
  review, for every key.

## 3. Child editing

### 3.1 How a lent value reads

```
  ⇡ course   BIO-101                    from course-bio
  ⇡ tags     (biology⇡) (course⇡) [lab-notes ×]  [+]
    title    Membranes
```

- Single key: muted value, a "from" icon, the root's name as a link.
- List key: lent pills get a dashed outline and no `×`. The page's own
  pills look as usual.
- Tooltip: `Comes from course-bio/README.md. Change it there.`

All of this reads `ops.lent` and the folder chain from the metadata cache.

### 3.2 When a person changes one

The plugin cannot block every edit: source mode exists. So, two cues:

- **Single key: a soft block.** A click on the value opens a popover in
  place of the input: `This comes from course-bio. A change here does not
  stay.` `[Open course-bio]`. I drop the review's `Edit anyway` button: it
  invites an edit that the next write undoes.
- **Drift.** When the file differs from `ops.lent`, the row turns amber.
  - Single: `Goes back to BIO-101 on the next write.` `[Set back now]`
    `[Open course-bio]`
  - List: `biology comes back on the next write.`

No modal on a child: the stake is one page, and the CLI repairs it.

### 3.3 Reaching the root; no detach

- The root's name is always a link. A command: `Open this page's bundle
  root`.
- `Why?` opens a panel from `page explain`: the chain, and for each key
  what is the page's own, what is lent, and what a write would change.
- **No per-page detach.** The CLI has none. The two real escapes are named
  in the `Why?` panel: put the page in a subfolder whose own root lends a
  different value (the nearest root wins), or move the page out. A per-page
  decline would be a new CLI key (upstream ask 4).

## 4. Other cues

### Build first

1. **One state line per note**, above Properties. At most three chips, and
   only exceptions; a healthy page shows nothing. Priority: conflict, then
   update waiting, then held because you edited it, then draft or
   archived, then stale. This one surface replaces many small ones.
2. **Update waiting**, with its action: `A job has an update for this
   page. Compare`. It reuses the set-aside diff.
3. **Folder policy**, on roots and children: `Ingest on hold, from
   course-bio`. Read-only, with a link to the root.
4. **Explorer marks, three only**: the lend icon on root folders, a dot on
   a file that needs you (a conflict, an update waiting, a lend waiting),
   and dim text for archived pages.

### Build next

5. **A job's page**: `Written by weekly-digest · 2 days ago`, beside the
   block tint that exists.
6. **Held, in words**: `Jobs leave this page alone because you edited it.`
   `[Let jobs write it again]`. Never the words `unstamped` or
   `settling`.
7. **Stale**, once `stale_after` has passed: `Verified 14 months ago.`
   `[Mark verified]`.
8. **Replaced**, on the old page only: `Replaced by <page>`.
9. **Lint findings**: a count chip that opens a list; gutter marks only
   for findings with a line.
10. **Narrated audio**: a play button in the note header, and `The audio
    is older than the text` only when it is.

### Do not build (noise)

- An unsaved dot on each file in the explorer: it flickers with every
  keystroke. The status bar count is enough.
- Unpushed state on a note: it belongs to the vault, not the page.
- Search-index freshness on a note: show it where search fails, and in
  the Brain view.
- Mined and distilled stamps in the note: keep them behind More, or in the
  Sources panel.
- `settling` as a state: it ends by itself in 10 minutes.
- Any colour on explorer rows for the normal state.

## 5. Upstream asks (llm-wiki-plugins)

Filed: asks 1 and 2 as #4715, asks 3 and 5 as #4716. Ask 4 is #4441 item 2.

1. **The tick waits for a root to settle.** No fan-out from a root saved
   within the settle window, so a half-typed value never spreads.
2. **The tick never replaces a page's own value.** It leaves that page
   stale and reports it (a `whereami` needs-you part, say `lend_waiting:
   [{root, page, key}]`). Only an attended `page edit`, or `page lend`
   with a confirm, replaces own values.
3. **`page lend` asks**, as `page edit:lend` does, when it replaces a
   value a page set itself. Today it does not, so the plugin's review is
   the only question.
4. **Optional: a per-page decline** (for example `ops.keeps: [course]`),
   for owners who need one page to differ without a subfolder. ADR-0077
   rejected reading a *missing* item as a decline; a named key is
   different, but it is the CLI team's call.
5. **Optional: a preview token.** `page lend --dry-run` returns one, and
   `page lend --expect <token>` refuses if the root or a child changed
   since. Apply would then mean exactly what the review showed.

Asks 1 and 2 decide whether the confirmation is real or only advice on a
machine with a runner.

## 6. Order of work

1. Read-only cues: the lend icons on root and child rows, lent pills, the
   `from` link, the `Why?` panel. No writes; low risk. **Built**
   (`src/vault/lends.ts`, `src/vault/lendCues.ts`, `src/ui/explainModal.ts`).
   A child value that differs from `ops.lent` shows no mark yet; that is the
   drift cue of step 5.
2. The lend bar, the dry-run, and the review with Apply.
3. The state line (cues 1 to 3) and the explorer marks.
4. Menus to make a root, lend or stop lending a key.
5. The child's soft block and drift cue.
6. The rest of section 4, as asked.

## 7. Open questions

- With a runner and no upstream fix, is an advisory review good enough to
  ship, or does step 2 wait for asks 1 and 2?
- The dry-run's cost on a folder of 2,000 pages. Measure it before step 2.
- Nested roots: the review must name the root of each value where list
  keys union down the chain.
- Mobile: the plugin is desktop-only today, so the row cues can lean on
  the Properties DOM. The bar and the state line must work without it.
