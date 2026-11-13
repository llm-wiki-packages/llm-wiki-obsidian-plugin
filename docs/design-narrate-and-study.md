# Design: narrate a page, and this week's study guide

Status: brainstorm, 2026-11-12. Nothing here is built. Facts checked against
llm-wiki-ops 0.18.0 and main (0.19.0), and llm-wiki-skills 0.15.0.

Two asks:

1. **Narrate.** A button that reads a page aloud: as written, as a natural
   script an LLM writes for the ear, or as a summary. On a bundle root: catch
   me up on what changed.
2. **Study guide.** A student marks notes for this week's focus, and has them
   summarized, narrated and quizzed on a schedule.

## 1. What the wiki can do today

| Piece | State | Where |
| --- | --- | --- |
| Read one page aloud now, as written | Built | `narrate <page> mode=read`. Local TTS (pocket-tts), no model. Markdown is stripped; nothing rewrites it for the ear |
| Voice a script of turns | Built | `narrate <page> mode=podcast` voices the page's first ` ```webvtt ` block |
| Write a script from pages | Built, as a new page | `podcast [focus]` skill: a two-host episode page under `wiki/podcasts/`, `covers:` the pages, `narrate.modes: podcast` |
| Audio quiz | Built, as a new page | `quiz-show` skill |
| A page's audio record | Built | `narrate.render.<mode>`: `file, transcript (.vtt), voice, engine, at, hash`, or `error` |
| Is the audio older than the text? | Built | `page list filter=audio:stale` (the record's hash against the page's) |
| Queue audio for later | Built | `narrate.modes` on a page or a root; the hourly `ops-narrate` job renders what is queued |
| Study guide page type | Built (student preset) | `type: guide` in `wiki/guides/`, with `covers` and `audience` |
| A study plan from weak spots | Built | `study-plan` skill and a paused daily job |
| One-off and trigger jobs | Built | `jobs add <slug> routines=… every=once`, `routines[].args` as the skill's focus, `triggers: [{on: pages, select: [...]}]` |
| A script for ONE page, kept with that page | **Missing** | Both script writers make a new page |
| Style knobs (length, tone) | **Missing** | Only `voice` and `cast` |
| A "this week" selection | **Missing** | No `week` or `focus` key, no selector for "the pages a guide lists" |

Costs a person should see before a click:

- **As written:** local CPU only. About a minute or two per page. No model.
- **Anything with a script** (natural, summary, two hosts, catch me up, quiz): a frontier model writes it. It runs as a job. Minutes, and it costs money.
- **No narrate engine set up:** nothing can be voiced. The menu says so and links to the setup.

## 2. Narrate

### 2.1 One button, one menu

A headphones action in the note header. A click opens a small menu, not a
dialog. Each choice says what it costs, in plain words.

```
🎧 Listen
 ───────────────────────────────
 ▶ Play                       4:12     (only when audio exists)
 ───────────────────────────────
 Read it as written           local · ~1 min
 Read it to me                writes a script · ~3 min
 Short summary                writes a script · 2-min listen
 Talk it through              two hosts · new episode page
 Quiz me on it                quiz show · new episode page
 ───────────────────────────────
 Voice: Alba ▾      Length: Full ▾
```

- **Read it as written** runs `narrate <page> mode=read` now. It works
  today.
- **Read it to me** is the ask in the brief: an LLM rewrites the page for
  the ear (it reads the tables out as sentences, skips the citations, says
  "first… then…"), then the TTS voices it. One narrator. It needs upstream
  work (§5, ask 1).
- **Short summary** is the same path with `length=short`.
- **Talk it through** and **Quiz me on it** run the `podcast` and
  `quiz-show` skills with this page as the focus, as a one-off job. They
  work today. Each makes an episode page, and the note links to it.
- Two style knobs only: **voice** (from `[narrate.voices]` and
  `machine voices`) and **length** (Full, Short). Tone ("friendly",
  "exam prep") goes into the wiki's policy overlay, not a per-click menu.
  More knobs on every click make a worse menu.

### 2.2 The audio state, on the page

The `narrate.render.*` keys are in the metadata cache, so the header icon
needs no CLI call:

| State | Header icon | Words on hover |
| --- | --- | --- |
| No audio | 🎧 outline | `Listen to this page` |
| Queued, or a script is being written | 🎧 with a clock | `Writing the script…` / `Waits for the next narrate pass` |
| Ready | 🎧 filled | `Listen · 4:12 · Alba` |
| Older than the text | 🎧 with an amber dot | `The audio is older than the text. Record again` |
| Failed | 🎧 with a red dot | the engine's error, and `Try again` |

### 2.3 The player

- A thin bar pinned to the bottom of the note. It is not the audio embed the
  CLI writes at the top of the body. The bar stays in view while the person
  scrolls and reads along.
- Play and pause, ±15 s, speed (1×, 1.25×, 1.5×, 2×), and the mode when the
  page has more than one (`As written · Script`).
- **Follow along** (build later): the `.vtt` transcript has times. In reading
  view, highlight the paragraph being read and scroll it into view. A
  click on a paragraph seeks to it. For "as written" this maps closely. For
  a script, highlight the section the script cue came from.
- Leaving the note keeps playing. The status bar shows `▶ Membranes 2:10`,
  and a click returns to the note.

### 2.4 After a script job lands

A script job lands a page with `narrate.modes` queued, and the hourly pass
would voice it up to an hour later. The plugin closes that gap. When the job
it started lands, it runs `narrate` on that page at once and raises one
Notice: `Membranes is ready to listen to. Play`.

### 2.5 On a bundle root: catch me up

The root's Listen menu adds:

```
 Catch me up on course-bio
   Since I last listened (Nov 5)     12 pages changed
   This week                          8 pages
   Pick a date…
```

- The count comes from `git changed <folder> filter=since:<date>`, before
  any model runs.
- It runs `podcast` with the focus `changes under sources/course-bio since
  2026-11-05`, as a one-off job, and the episode links to each page it
  covers.
- "Since I last listened" is kept by the plugin, per root, on this machine.
- With nothing changed, the choice is greyed out, with `Nothing changed
  since Nov 5`.

## 3. This week's study guide

### 3.1 The model: one guide page per week

The guide is a page, `wiki/guides/2026-W46.md`, `type: guide` (the student
preset's own type). Its `covers` lists the pages. Its body is the student's,
with one line per page they can add a note to:

```yaml
title: Week of Nov 9
type: guide
week: 2026-W46
covers: ["[[membranes]]", "[[cells]]", "[[ch4-genetics]]"]
```

Why a page, and not a `focus:` key on each note:

- **It writes one file, not every note.** Many notes belong to a job (a
  Blackboard harvest). A person key on a job's page meets the held-page and
  re-render rules. A guide page avoids all of that.
- **It is a real page.** It has a reading order and the student's own notes
  per item, and it shows in the graph and in search. It is what a student
  would make by hand.
- **The skills already speak it.** `study-plan` writes `guide` pages. The
  podcast and quiz skills take a focus, and "the pages in
  wiki/guides/2026-W46.md" is a focus they can read today.
- The cost: a job trigger cannot yet select "the pages this guide covers"
  (§5, ask 4). The skills' focus works around that.

The current guide is the one whose week holds today. The first "Add" of a
new week makes it, from the guide template.

### 3.2 Adding to the guide: one gesture everywhere

- **A pin in the note header**, beside Listen: `Add to this week's study
  guide`. Filled when the note is in it; a click again takes it out.
- **The file menu** on one note or many selected notes in the explorer:
  `Add 4 notes to this week`.
- **On a root or a folder:** `Add week1 to this week` adds every page under
  it. One line per page, grouped under the folder's name.
- **A command:** `Add this note to this week's study guide`, for a hotkey.
- **From the guide itself:** an `Add notes…` button with a fuzzy picker.

No dialog on add. A Notice says `Added to Week of Nov 9 · Open`, with
`Undo` for 5 seconds.

### 3.3 Seeing it

- **On a note in the guide:** a chip in the state line, `This week`, which
  links to the guide. Earlier weeks are quiet: the chip only shows for the
  current week.
- **On the guide page:** a panel above the body, one row per page:

```
Week of Nov 9 · 6 pages · 2 listened · quiz Fri
  ☑ membranes        🎧 listened   quiz 4/5
  ☐ cells            🎧 ready
  ☐ ch4-genetics     ✎ summary waits for Sunday's run
  [Add notes…]   [Plan this week ▾]
```

- **The status bar:** `This week: 6 · 2 listened`, only in a student wiki,
  or once a guide exists.
- **Studied** is the student's own tick, a checkbox on the item line in the
  guide's body. Quiz scores come from the quiz logs that `study-plan`
  already reads.

### 3.4 Plan this week: scheduling

`Plan this week ▾` on the guide is a short checklist. Each line is a job.
The guide shows when each runs.

```
Plan this week
  ☑ A summary of each page, in the guide       Sunday 18:00
  ☑ A listening episode of the whole guide     Sunday 18:00
  ☐ Each page read to me                       as I add them
  ☑ A quiz show on Friday                      Friday 18:00
                                               [Save plan]
```

- **One standing job for each line, not one job per week.** For example
  `study-week-listen`, `every=7d`, with routine args `the pages in the
  current week's guide`. The plan carries to the next week by itself.
- "As I add them" is a trigger job on guide pages (`select:
  filter=prop:type=guide`, `throttle: 1d`). Adding pages refreshes the
  audio overnight, not on each click.
- Times sit inside the student preset's evening window (18:00 to 22:00),
  where `study-plan` already runs.
- **The plan's line names the cost:** `Uses the model: about 3 runs a week`.
- **The study-plan skill** (weak spots from quizzes) can add its own
  suggestions to the guide, marked `suggested`. The student keeps or drops
  them. The student's picks always come first.

### 3.5 Who sees "study guide"

The words "study guide", "this week" and "quiz" fit the student preset. In
any other wiki the same feature reads as a **Focus list**, `This week's
focus`, with no quiz line. The plugin picks the words from the wiki's preset,
if the CLI reports it (§7).

## 4. Cues, in the rules of design-lend-and-state.md §4

- The **Listen** icon and the **pin** are header actions on every page.
  They draw from the metadata cache.
- **The state line** gains three chips, all exceptions or this-week only:
  `This week`, `Audio older than the text`, `Narration failed`.
- **Do not build:** a mark in the file explorer for each focused note (the
  guide is the list), a play count, or a `listened` key in the file (it is
  this machine's state, not the page's).

## 5. Upstream asks

Filed as one design-wanted issue, llm-wiki-plugins #4720, with a `narrate`
voice policy the LLM reads before it writes any audio script. A client could
do it by hand today (`harness run` for a script, a file beside the page, a
link in frontmatter), but then each client picks its own paths and rules.

1. **A script for one page, kept with that page.** A skill (say
   `read-aloud <page> [length=full|short]`) writes an ear script: one voice,
   lists and tables put into sentences, citations dropped. The script is
   stored beside the audio (`<dest>/<page>.script.vtt`), not in the page's
   body, and voiced as a new narrate mode `script`, recorded in
   `narrate.render.script`. The page's own text never changes. Asking that
   a skill write into the page body would mix the student's note with a
   machine's.
2. **Style arguments.** `length` on that skill, and a `voice=` on
   `narrate`. Tone stays in a policy overlay.
3. **One narrator for the podcast skill**, for "catch me up" when a student
   wants a brief and not a show.
4. **Optional: a selector for a guide's pages**, for example
   `filter=covered-by:wiki/guides/2026-W46.md`, so a trigger fires when a
   covered page changes.
5. **Optional: the preset in `whereami`**, so the plugin can say "study
   guide" in a student wiki and "focus" elsewhere.

Asks 1 and 2 decide whether "Read it to me" ships. Everything else in §2
and §3 works on 0.18 as it is.

## 6. Order of work

1. **Listen, as written.** The header icon and its states, `narrate <page>
   mode=read`, the player bar, and `Record again` on stale audio. All
   built upstream; adds the verbs `narrate` and `page list filter=audio:`.
   **Built** (`src/ui/listen.ts`, `src/ui/player.ts`, `src/vault/narration.ts`).
   The player is one bar for the window, docked above the status bar, not a
   bar inside the note; it keeps playing across notes. Found on the way: new
   audio reads `stale` at once on 0.18 (llm-wiki-plugins #4721); the plugin
   believes `stale` only when the file changed 2 minutes after the recording.
2. **The study guide.** Add and remove, the guide page, the `This week`
   chip, the guide panel. Plugin-only: it writes one page in `wiki/guides/`.
3. **Talk it through, Quiz me, Catch me up.** One-off jobs over the
   existing skills, and narrate at once when they land. Adds `jobs add`.
4. **Plan this week.** The standing jobs and the trigger.
5. **Read it to me, Short summary.** After upstream asks 1 and 2.
6. **Follow along.** The transcript highlight.

## 7. Open questions

- What a "week" is for a student: the calendar week, or the course's own
  `week3/` folders? The guide could take its title from the syllabus when
  it names weeks.
- Does `whereami` or the config record the preset a wiki was made from?
- Playback on a phone: the plugin is desktop-only. The MP3s are in LFS, so
  a phone gets them only if its sync pulls LFS. An "export this week's
  episode" button could be the answer for now.
- A long page read as written takes minutes on the CPU. Run it in the
  background with progress, or always as a job?
- Should a guide's `covers` hold links (`[[membranes]]`) or paths? Links
  follow a rename in Obsidian; the CLI's `covers` reads both, to check.
