# llm-wiki CLI answer shapes (for the Obsidian plugin's TypeScript client)

How this was produced: field names are copied from the Python `Answer`
dataclasses and the row builders they use, then checked by running the verbs
against a scratch wiki (isolated `HOME`, `init` + `join`). Examples marked
"(real)" are trimmed output of those runs; "(composed)" were built from code
because the scratch wiki had no such data. Anything not confirmed is marked
[unverified].

Source tree (repo `llm-wiki-plugins`, main at `f8b419b52`):
`llm-wiki-ops/v1/plugin/packages/llm-wiki-ops-v1/src/`. Below, `OPS/` is
`llm_wiki_ops/commands/` and `CLI/` is `llm_wiki_cli/commands/` under it.

IMPORTANT, installed vs. main: the CLI installed on this box
(`~/.local/bin/llm-wiki-ops`, uv tool `llm-wiki-ops-v1`, editable into the
package-store cache `@6560c662e3ad`) is 123 commits behind main. Where it
matters, `page ls` differs a lot (see that section). Every shape below is
main's; I ran main's code with the installed interpreter and
`PYTHONPATH=<checkout>/src`. A client must tolerate both until
`just install-local` is re-run.

---------------------------------------------------------------------------
## 0. Conventions that apply to every verb

### 0.1 argv

- Per wiki, machine-global forwarder (what the dashboard spells):
  `llm-wiki-cli wiki [--read-only] <key> <verb...> --json`
  `--read-only` goes BEFORE the key. Unknown key: rc 2, JSON error (see 0.3).
  Dashboard source of truth: `llm-wiki-dashboard/server/src/data/cli.ts`
  (`VERBS`).
- In-wiki: `llm-wiki-ops [--read-only] <verb...> --json` (needs
  `LLM_WIKI_ROOT` or cwd inside the wiki). `llm-wiki-cli wiki --here ...` is the
  same thing.
- Machine verbs: `llm-wiki-cli machine <verb...> --json` (no wiki).
- Tokens are positionals plus `key=value` pairs (`wait=30s`, `reject="why"`,
  `keep=ours`) plus flags (`--peers`, `--verbose`, `--enabled`, `--full`).
- Filters: `filter=<kind>:<value>`. One occurrence = one group; commas inside a
  group OR (`filter=-lint:warning,error`), repeating the key ANDs, a `-` on the
  KIND negates (`filter=-tag:a`). Per-verb kinds are declared in each group's
  `SELECTORS` (`OPS/page/__init__.py:35`, `OPS/op/__init__.py:26`,
  `OPS/git/__init__.py:17`). An undeclared kind is refused (rc 2).
- `since:` takes four shapes: a period (`30m`, `1d`, `2w`; units `smhdw`), a
  git sha (7-40 hex), an op name, or an instant (`common/since.py`). The
  dashboard only uses `1h..999d`/`h|d`.
- Free text that may start with `-` goes after `--` (dashboard does this for
  search).

### 0.2 Success envelope

`--json` prints, to stdout, `indent=2` JSON of the Answer's fields plus:

```json
"_cmd_": { "elapsed_ms": 12, "wiki": "/abs/path|null", "head": "<40-hex sha>|null" }
```

(`common/envelope.py:67` `Cmd`, built in `common/params.py:468` `_emit`.)
`head` is the wiki's HEAD, `null` on an unborn branch or no wiki. `_cmd_` is
never payload; a client should strip it. Fields are emitted as-is, `null`
included (no key is dropped), EXCEPT where noted (e.g. `page ls` `behind` is
only on `wiki/` rows).

### 0.3 Error envelope (differs from the brief!)

Non-streaming `--json` errors are, on STDOUT (not stderr):

```json
{ "error": "<the whole human sentence>", "_cmd_": { "elapsed_ms": 1, "wiki": "...", "head": "..." } }
```

There is NO separate `message` key and no machine key. `error` IS the
sentence (`common/params.py:584`, `llm_wiki_cli/cli.py:79` for forwarder
refusals). Only streaming verbs (`harness run --stream`) emit
`{"type":"error","error":"<key>","message":"..."}` (`params.py:132`
`stream_error`). So a client discriminates on (exit code, sentence text).

Exit codes (`common/exit.py`): `0` done, `1` failed / could not answer
(`Failed`, any unexpected exception - `error` then reads `TypeName: text`), `2`
refused (`Refused`: bad input, a gate said no, read-only session, not joined,
unknown wiki key). An action verb whose answer says "did not happen" prints its
answer AND exits 1 via an `exit_code` property (`jobs request`, `search
index`); that is an answer on stdout, not an error envelope.

Not JSON: click usage errors (unknown verb, bad flag) print plain text to
stderr and exit 2. `--json` anywhere in the tokens makes the forwarder's
refusals JSON.

Dashboard behavior to copy (`cli.ts:284`): treat `rc != 0 || parsed.error` as
failure; parse stdout even when rc != 0.

### 0.4 Read vs write tier, time, ids

Every verb is `r` or `w` (`docs/cli-inventory.md`). Under `--read-only` a `w`
verb is refused before it runs: rc 2, `error: "<verb path> writes, and this
session is read-only"`. The dashboard passes `--read-only` on everything except
`harness run`. Writes also run the commit/push transport after returning.
Instants are UTC strings in three spellings (`...37Z`, `...03+00:00` on
registry `last_seen`, ms precision in `op logs`): parse leniently. Ticket ids
are opaque short hex (`6837700e8464`) [unverified for every stage]. Machine ids
are slugs (`devops1`).

---------------------------------------------------------------------------
## 1. Read verbs

### 1.1 `doctor`

- argv: `wiki --read-only <key> doctor --json` (the `--fix` flag WRITES and is
  refused under `--read-only`; do not send it from a read path).
- Answer: `Doctor`, `OPS/doctor/doctor.py:13`.

```ts
interface DoctorAnswer {
  ok: boolean;            // true iff no row has status "fail"
  overall: "ok" | "warn" | "fail";   // rows taken whole
  worst: { check: string; fix: string | null } | null; // first fail, else first warn, else null
  rows: DoctorRow[];
  failing: string[];      // check names whose status is "fail"
  fixed: string[];        // only after --fix
  declined: object[];     // only after --fix: what it could not run
  agents: { name: string; source: string; path: string; enabled?: boolean }[]; // wiki personas; [] if none [unverified: exact keys]
}
interface DoctorRow {     // llm_wiki_machine/toolcheck.py:28 Row
  check: string;          // see below
  status: "ok" | "warn" | "fail";   // "info" exists only in machine doctor
  detail: string;         // one sentence
  fix: string | null;     // the one command that fixes it; null when ok
}
```

Severity enum: ops `doctor` rows: `ok | warn | fail` (the shared Row type
also has `info`, used by `machine doctor` only: `toolcheck.py:21-24`).
`overall` is `fail` if any fail, else `warn` if any warn, else `ok`.
Check names are an open set (rows appear per condition; real examples:
manifest, ops-version, layout, machine, registry, fleet, jobs, jobs-poll,
errors, credentials, trust, harness, git, busy, sandboxes, sandbox-runtime,
inboxes); do not enum-validate `check`.

Unjoined wiki: succeeds (rc 0) with `ok:false, overall:"fail",
failing:["machine","agents-link","skills-link"], worst:{check:"machine",
fix:"llm-wiki-ops join key=<key>"}` (real).

Example (real, trimmed):

```json
{ "ok": true, "overall": "warn",
  "worst": { "check": "jobs-poll", "fix": "`llm-wiki-cli machine runner install scratch` (add `every=30m` ...)" },
  "rows": [ { "check": "manifest", "status": "ok", "detail": "major 1, requires >=0.7", "fix": null },
            { "check": "jobs-poll", "status": "warn", "detail": "this machine's registry record carries no `every` - a wiki no runner polls", "fix": "`llm-wiki-cli machine runner install scratch` ..." } ],
  "failing": [], "fixed": [], "declined": [], "agents": [] }
```

### 1.2 `status --peers`

- argv: `wiki --read-only <key> status --peers --json`
- Answer: `Status`, `OPS/status/status.py:13`.

```ts
interface StatusAnswer {
  wiki: string;            // absolute path
  ops_dir: string | null;  // ".llm-wiki"
  wiki_id: string | null;  // uuid
  name: string | null;
  key: string | null;      // registry key
  registered: boolean | null;
  machine: string | null;  // this machine's id in this wiki; null when not joined
  joined: boolean;
  ops_version: string;     // "0.7.0"
  ops_major: number;       // 1
  git: { branch: string|null; head: string|null; upstream: string|null;
         dirty: number|null; untracked: number|null; unpushed: number|null; behind: number };
  busy: string | null;     // busy-checkout state + how to end it; null when not busy
  routines: { total: number|null; active: string[]|null; unreadable: {slug:string; reason:string}[] };
  peers: Peer[] | null;    // null unless --peers (or if it failed; reason in problems)
  problems: string[] | null;  // what this answer could not produce; never a verdict
}
interface Peer {
  machine: string;
  capabilities?: Record<string, string | Record<string,string>>; // an OBJECT (unit -> stage words), not an array
  last_seen?: string | null;
  state: "healthy" | "quiet" | "stuck" | "no-cadence" | "unreadable";
  detail?: string;         // only on "unreadable" and on "stuck" rows with no registry entry
}
```

Peer `state` (`common/wiki/machines.py:305-308`, `fleetrow.state`): `healthy`
ticking on its promised cadence; `quiet` overdue (> 2 polls, floor 10 min; a
closed lid, information not a warning); `stuck` raised its hand (push wedged;
or a flag with no registry entry); `no-cadence` registered but promised no
`every`, so never judged; `unreadable` registry entry no reader accepts.
`capabilities` values are stage words `ready | sandbox-unbound | sandbox-off |
no-engine` or unit words `disabled | drifted` (`machines.py:43-44`), plus the
engines `PLUGIN:transcribe`, `PLUGIN:index`.
`git.dirty` counts tracked changes; `untracked` separate; `null` both when git
pre-flight refused (not "clean").

Example (real):

```json
{ "wiki": "/tmp/cs/wiki", "ops_dir": ".llm-wiki", "wiki_id": "5c76e156-...", "name": "wiki", "key": "scratch",
  "registered": true, "machine": "devops1", "joined": true, "ops_version": "0.7.0", "ops_major": 1,
  "git": { "branch": null, "head": null, "upstream": null, "dirty": 76, "untracked": 0, "unpushed": 0, "behind": 0 },
  "busy": null,
  "routines": { "total": 7, "active": ["ops-hourly-host", "ops-nightly-host"], "unreadable": [] },
  "peers": [ { "machine": "devops1", "capabilities": {}, "last_seen": "2026-10-23T06:34:03+00:00", "state": "no-cadence" } ],
  "problems": null }
```

Dashboard type `Status.peers[].capabilities?: string[]` is wrong (object) and
its `state` union is loose; do not copy it. (Older installed CLI also emitted
a `counts` key; main does not.)

### 1.3 `jobs ls --verbose`

- argv: `wiki --read-only <key> jobs ls --verbose --json`. Optional
  `state=active|paused|archived`.
- Answer: `Jobs`, `OPS/jobs/answers.py:39`; row built in `OPS/jobs/ls.py:14` +
  `jobs/jobs.py:824` `row()`.
- Needs a JOINED checkout (rc 2 otherwise, see section 3).

```ts
interface JobsLs { count: number; jobs: JobRow[]; unreadable: {slug:string; reason:string}[]; }
interface JobRow {
  slug: string;
  description: string;
  target: string;           // pipeline job: url/channel it pulls; "" on a routines job
  dest: string | null;      // where pages land; null on a routines job
  route: string | null;
  every: string | null;     // "1h" | "1d" | "once" | ... (period spelling)
  skill: string | null;     // pipeline: harvest unit; routines: FIRST routine's skill only
  stages: StageRow[];       // always 5 rows, in STAGES order (below)
  state: "active" | "paused" | "archived";   // archived only with state=archived
  kind: "pipeline" | "routines";
  claim: "any" | "sticky" | "none";   // who may run it; "none" = every machine runs it on its own state
  machine: string | null;   // pin
  // --- added by `jobs ls` proper (absent on archived rows) ---
  due: boolean;             // owed a run on THIS machine now
  blocked: string | null;   // machine-local reason this box may not pull it (a sentence)
  // --- added by --verbose (absent on archived rows) ---
  verdict: Verdict;         // clock stage's dueness, below
  running: RunningTicket[]; // this machine's active tickets of the job
  window: string | null;    // "02:00-06:00"
  routines: { verb: "skill" | "run" | "op"; name: string; args: string[] }[]; // [] on a pipeline job
}
```

Note: the dashboard's `JobsLs.jobs[].stages[].skipped|holder|stalled|ok_started`
are real; additional stage fields are below. `state=archived` rows use the
bare `jobs.row` shape (+ `_shape` when verbose) with NO stages/due/blocked.

`StageRow` (`jobs/claims.py:353 state_of` + `jobs/status.py:268 row`):

```ts
interface StageRow {
  stage: "harvest" | "transcribe" | "enrich" | "process" | "routine";
  machine: string | null;   // stage pin
  budget: string;           // lease budget "1h"
  skipped: boolean;         // the job declares no such stage (null section)
  holder: string | null;    // machine holding the live lease
  refreshed_at: string | null;
  stalled: boolean;         // holder's lease lapsed
  stolen: string | null;    // machine it was stolen from
  leftover: string[];       // lapsed claims held by machines nobody has heard from
  ok_started: string | null;  // newest ok run's start, any machine
  ran_on: string[];
  failing: string[];        // machines whose last run failed
  attempts: number;         // consecutive failures (max across machines)
}
```

`Verdict` (`OPS/jobs/dueness.py:439 row`; also on `jobs show` and in `jobs
due.jobs[]` partially):

```ts
interface Verdict {
  due: boolean;
  kind: null | "off" | "paused" | "once" | "failed-cap" | "period" | "window" | "requires" | "no-work";
        // the first rung that said no; null when due
  reasons: string[];        // the CLI's own words; e.g. "never run", "paused", "ran recently (last ok ..., every 1h)"
  blocked_by: string[];     // unmet `requires` clauses
  next_at: string | null;   // null when due, or when only the next tick knows (requires, no-work, once, paused, off)
  due_since: string | null;
  last_ok: string | null;   // newest ok.started this clock reads (this machine's alone when claim=none)
  anchor: string | null;    // the stamp the period counted from
  chain: { done: number; of: number } | null;  // routines chain part-way ("chain in progress (k of n)")
}
```

`RunningTicket` (`jobs/active_tickets.py:35`):
`{ id: string; stage: string; machine: string; since: string|null; step: {index:number; name:string}|null }`
(`step` only on a `routine` ticket: `index` counts from 0, `name` is the
routine's value e.g. `PLUGIN:improve`; `machine` is always THIS machine).

Enums: job `state` `active|paused` (plus `archived` view); STAGES `harvest,
transcribe, enrich, process, routine`; routine verbs `skill|run|op`. A fresh
wiki seeds `ops-denials, ops-hourly, ops-hourly-host, ops-morning,
ops-nightly, ops-nightly-host, ops-synthesize`; all `paused` except the two
`*-host` jobs. Example (real, `ops-hourly`, `stages` cut to one of five):

```json
{ "slug": "ops-hourly", "description": "curate what the pipeline has landed, every hour", "target": "", "dest": null,
  "route": null, "every": "1h", "skill": "PLUGIN:curate",
  "stages": [ { "stage": "routine", "machine": null, "budget": "1h", "skipped": false, "holder": null, "refreshed_at": null,
                "stalled": false, "stolen": null, "leftover": [], "ok_started": null, "ran_on": [], "failing": [], "attempts": 0 } ],
  "state": "paused", "kind": "routines", "claim": "any", "machine": null, "due": false, "blocked": null,
  "verdict": { "due": false, "kind": "paused", "reasons": ["paused"], "blocked_by": [], "next_at": null,
               "due_since": null, "last_ok": null, "anchor": null, "chain": null },
  "running": [], "window": null, "routines": [ { "verb": "skill", "name": "PLUGIN:curate", "args": [] } ] }
```

### 1.4 `jobs due`

- argv: `wiki --read-only <key> jobs due --json` (optional `n=` caps each list).
- Answer: `Due`, `OPS/jobs/answers.py:215`; built in `OPS/jobs/due.py:360
  pipeline_due`. Needs a joined checkout.

```ts
interface JobsDue {
  running: DueRunning[];   // this machine's active tickets, oldest first
  pending: DuePending[];   // grouped per (job, stage)
  review: DueReview[];     // tickets carrying a `review` flag
  parked: DueParked[];     // failed-lane tickets + set-aside orphans: want `tickets retry|drop`
  jobs: DueJob[];          // stages due to start on this box that no live peer holds
  caps: Record<Queue, { cap: number; active: number }>;  // [runner.caps]; {} if no caps readable
  handoffs: { outgoing: HandoffOut[]; incoming: HandoffIn[]; waiting: {job,stage,capture,reason}[];
              shipping: {id,job,attempts_left,runs}[]; problems: string[] };
  unreadable: { slug: string; reason: string }[];
}
type Queue = "harvest" | "transcribe" | "enrich" | "process" | "routine" | "handoff";
interface DueRunning { id: string; job: string; stage: Queue; priority: "high"|"normal"|"low";
  age_s: number; runs: number; runtime_s: number;
  last: { status: string|null; reason: string|null; updated_at: string|null } | null; // worker's posted report
  machine: string; started_at: string|null; step: {index:number; name:string}|null }
interface DuePending { job: string; stage: Queue; priority: "high"|"normal"|"low"; count: number;
  oldest_age_s: number; held: number /* before not_before */; reason?: string /* transcribe only: "no engine"-style */ }
interface DueReview { id: string; job: string; stage: Queue; host: string|null; reason: string|null }
interface DueParked { id: string; job: string; stage: Queue; reason: string|null; runs: number; runtime_s: number;
  step: {index:number; name:string}|null }
interface DueJob { slug: string; stage: Queue; due_since: string|null;
  // clock-stage rows only:
  reasons?: string[]; blocked_by?: string[]; last_run?: string|null }
```

`ORPHAN_REASON` for a crashed close's record: `"orphan: a crashed close's
record, set aside"`. `age_s` is seconds (float). Dashboard's `DueRow`
is the union of the first four row types. `handoffs.outgoing[]`:
`{job, stage, capture, age_s}`; `incoming[]`: `{job, stage, capture,
routing_position: number|null}`.

Example (real, with one held pending ticket):

```json
{ "running": [],
  "pending": [ { "job": "demo-doctor", "stage": "routine", "priority": "normal", "count": 1, "oldest_age_s": 39.0, "held": 1 } ],
  "review": [], "parked": [],
  "jobs": [ { "slug": "demo-doctor", "stage": "routine", "due_since": "2026-10-23T06:34:02Z",
              "reasons": ["never run"], "blocked_by": [], "last_run": null } ],
  "caps": { "harvest": {"cap":1,"active":0}, "transcribe": {"cap":1,"active":0}, "enrich": {"cap":2,"active":0},
            "process": {"cap":2,"active":0}, "routine": {"cap":1,"active":0}, "handoff": {"cap":1,"active":0} },
  "handoffs": { "outgoing": [], "incoming": [], "waiting": [], "shipping": [], "problems": [] },
  "unreadable": [] }
```

### 1.5 `jobs show <slug>`

- argv: `wiki --read-only <key> jobs show <slug> --json` (or `url=<url>`
  instead of a slug). Answer `Shown`, `OPS/jobs/answers.py:52`; built in
  `OPS/jobs/show.py:42`. Needs a joined checkout.
- Unknown slug: rc 2, `error: "no job 'x' - `jobs ls` names every job this wiki declares"`.
  `url=` that matches nothing is NOT an error: all fields empty, `job:null`.

```ts
interface JobsShow {
  slug: string | null;
  job: JobRecord | null;     // the folded job.json, verbatim
  dirs: { raw: string; sources: string | null; assets: string };
  route: string | null;
  due: boolean;
  captures: number;          // directories under the job's _raw slice
  stages: StageRow[];        // as in 1.3
  grid: object[];            // pipeline capture grid; [] on routines jobs [unverified shape]
  claim: ClaimView | null;
  verdict: Verdict | null;
  running: RunningTicket[];
}
type ClaimView =
  | { kind: "any" | "sticky"; holder: { machine: string; since: string|null; kind: "any"|"sticky"; text: string } | null }
  | { kind: "none"; machines: { machine: string; last_run: string; outcome: "ok" | "failed" }[] };
interface JobRecord {      // job-record contract; the keys the client may rely on
  v: 1; slug: string; description: string; details?: string[]; state: "active"|"paused";
  every?: string; window?: string; claim: "any"|"sticky"|"none"; machine?: string;
  routines?: ({ skill: string } | { run: string } | { op: string })[] ; // each may carry args[], budget
  added_at: string; added_by: string; updated_at: string;
  // plus harvest/transcribe/enrich/process/requires/meta/options sections on pipeline jobs
}
```

The job record is documented in the `job-record` contract
(`llm_wiki_ops/references/contracts/job-record.md`, sections "The record",
"Dueness", "The ticket"). `details` (prose paragraphs) is what the dashboard
shows as the job description. Example (real, `claim:none` job):

```json
{ "slug": "ops-hourly-host", "job": { "v":1, "slug":"ops-hourly-host", "claim":"none", "every":"1h", "state":"active",
    "routines":[{"op":"index"},{"op":"transcribe"}], "details":["index is the everyday additive pass ..."] },
  "dirs": { "raw": "_raw/ops-hourly-host", "sources": null, "assets": "_raw/ops-hourly-host/assets" },
  "route": null, "due": false, "captures": 0, "stages": [ /* 5 StageRow */ ], "grid": [],
  "claim": { "kind": "none", "machines": [] },
  "verdict": { "due": false, "kind": "no-work", "reasons": ["never run", "no search server is configured here; no transcription engine is declared here"],
               "blocked_by": [], "next_at": null, "due_since": "2026-10-23T06:34:02Z", "last_ok": null, "anchor": null, "chain": null },
  "running": [] }
```

### 1.6 `tickets ls`

- argv: `wiki --read-only <key> tickets ls --json`. Optional key=value
  narrowing (NOT `filter=`): `stage=<queue>`, `state=<state>`, `job=<slug,slug>`.
- Answer: `Tickets`, `OPS/jobs/answers.py:173`; rows `OPS/jobs/tickets_ls.py:13
  ROW_KEYS`. Does not need a joined checkout (works unjoined, empty).

```ts
interface TicketsLs { tickets: TicketRow[]; missing: string[] /* always [] for ls */ }
interface TicketRow {
  id: string;
  stage: "harvest" | "transcribe" | "enrich" | "process" | "routine" | "handoff"; // the queue
  state: "pending" | "active" | "done" | "failed" | "orphan";  // the lane
  slug: string | null;       // owning job
  unit: string | null;       // e.g. "PLUGIN:doctor"
  queued_at: string | null;
  claimed_at: string | null; // set while active
  worker: string | null;
  attempts_left: number | null;   // 3 at mint; failed-lane tickets are at 0
  max_attempts: number | null;
  runs: number | null;       // starts
  runtime_s: number | null;
  not_before: string | null; // held back until
  reason: string | null;     // why it failed / was dropped ("dropped") / was set aside
}
```

Lane meanings (`jobs/queues.py:45-46`, `:141`): `pending` waiting for a pass;
`active` a worker holds it; `done` landed (a dropped ticket lands here with
`reason:"dropped"`); `failed` = "parked" (retry/drop candidates); `orphan` a
crashed close's set-aside record. Bad `stage=`/`state=` -> rc 2 with the
allowed list in the sentence.

Example (real):

```json
{ "tickets": [ { "id": "6837700e8464", "stage": "routine", "state": "pending", "slug": "demo-doctor",
    "unit": "PLUGIN:doctor", "queued_at": "2026-10-23T06:39:37Z", "claimed_at": null, "worker": null,
    "attempts_left": 2, "max_attempts": 3, "runs": 1, "runtime_s": 1,
    "not_before": "2026-10-23T07:39:38Z", "reason": "killed" } ], "missing": [] }
```

### 1.7 `tickets show <id>`

- argv: `wiki --read-only <key> tickets show <id> --json`. Same `Tickets`
  answer (`OPS/jobs/tickets_show.py:55`), but each element is the FULL stored
  record plus `queue`, `state`, `hosts`, `hosts_error`. Unknown id: NOT an
  error: `tickets: []`, `missing: ["<id>"]` (the unjoined run printed rc 0).

```ts
interface TicketShow {
  tickets: (TicketRecord & { queue: Queue; state: "pending"|"active"|"done"|"failed";
      hosts: string[] | null;       // egress a slice would be minted with; null on failure
      hosts_error: string | null })[];
  missing: string[];
}
// TicketRecord (stage "routine" example, real): open-ended; stable keys:
// id, slug, unit, stage, verb ("skill"|"run"|"op"), value, args, routine_index, budget, chain (names),
// chain_started, capture_dir, dest, dirs, requested ({actor,session,at} only when started by `jobs request`),
// queued_at, claimed_at, finished_at, worker, max_attempts, attempts_left, runs, runtime_s, not_before,
// reason, landed_claim, model, harness, effort, model_from, credential ({}), credential_mode, options,
// routine ({op|skill, args, budget}), written (pages a done ticket's report named; done lane only)
```

Treat unknown keys as open data; layout is the "The ticket" section of the
job-record contract. Example: see the real output in section 2.4 (it is the
ticket that `jobs request` minted).

### 1.8 `page ls` (every selector)

- argv: `wiki --read-only <key> page ls [filter=...]... --json`
- Answer: `Listing`, `OPS/page/answers.py:49`; rows built in
  `OPS/page/ls.py:29`. Pages come from a filesystem walk (git not required;
  untracked pages appear), sorted by path, over `sources/`, `wiki/`,
  `research/` (reserved `index.md`, attachments, `_versions/`, dotted names
  excluded).
- Does not need a joined checkout.

Selectors (all `filter=<kind>:<value>`; each takes ONE value, not a comma list,
except `lint`):

| kind | values | effect |
| :--- | :--- | :--- |
| `status` | `draft` `stable` `deprecated` (any string matches literally) | exact status match; pages with no status never match |
| `under` | a directory, e.g. `sources/web`, `research` | walk only there (also changes how `behind` is computed: with `under` the cited sources are read separately) |
| `change` | `new` `edited` `current` `behind` | `behind` is a filter on the row's `behind` list (wiki pages only), not a `change` value; others -> rc 2 `change:x is not one of new, edited, current, behind` |
| `verified` | `yes` | has a `verified[].at` (any entry) |
| `shelf_life` | `past` | frontmatter `stale_after` day is on or before today |
| `lint` | `error` `warning`; groups may OR (`lint:warning,error`) and negate (`-lint:warning,error` = the clean pages) | page has a `page lint` finding of that severity; covers `research/` too |

Row (main's `page ls`):

```ts
interface PageLs { pages: PageRow[]; count: number }
interface PageRow {
  path: string;                       // wiki-relative, e.g. "sources/web/a.md"
  type: string | null;                // frontmatter `type`
  status: string | null;              // "draft" | "stable" | "deprecated" | null (no lifecycle) | any other string (lint flags STATUS_UNKNOWN)
  document_id: string | null;         // uuid; identity under sources/
  document_revision: number | null;
  change: "new" | "edited" | "current" | null;  // null outside sources/ & wiki/, for wiki/log.md, or when unreadable
  needs_verification: boolean;        // content unjudged: see below
  unreadable: boolean;                // frontmatter/body could not be read (then type/status are null)
  behind?: string[];                  // ONLY wiki/ rows: cited sources that moved on since distilled
}
```

NO `title`, NO dates, NO `generated`/`verified`/`stale_after`/`description` on
the row. Title and dates need `page read <path> --frontmatter --json` (answer
`Read`, `OPS/page/answers.py:57`: `{path, frontmatter:{...}, body:null,
start,end,total,anchor,matches,missed}`), or `fields=title,generated,verified`
for chosen keys. In Obsidian use the metadata cache for those instead.

What is "left to do" (derived; `page/lifecycle.py`):
- `change` (hash of content vs `generated.hash`): `new` = no lifecycle verb has
  taken the page up (sources/: no `document_id`; wiki/: no `generated`);
  `edited` = content differs from the last judged/produced hash (or no hash);
  `current` = matches. A human edit flips `current` -> `edited`.
- `needs_verification` (`lifecycle.needs_verification`): under `wiki/` true iff
  `change` in (new, edited) (dream/`page curate` acknowledges); under
  `sources/`/`research/` true iff `status == draft`, or `change == edited` and
  status != deprecated (a deprecated source is never unjudged). `false` for
  unreadable pages.
- `behind` non-empty = a wiki page whose cited sources were re-judged,
  rejected or vanished since `page distill`: needs distill/revise again.
- `status`: `draft` = pipeline product waiting for `page curate`; `stable` =
  curated; `deprecated` = rejected OR retired (they are told apart only by
  `generated.stage == "retired"` / `excluded_reason`, not on the row).
  Absent status = not a pipeline product (e.g. human wiki pages, research).

Example (real, mixed tree):

```json
{ "pages": [
  { "path": "research/r.md", "type": null, "status": null, "document_id": null, "document_revision": null,
    "change": null, "needs_verification": false, "unreadable": false },
  { "path": "sources/web/a.md", "type": "web-page", "status": "draft", "document_id": "20c0ecb0-...", "document_revision": 1,
    "change": "edited", "needs_verification": true, "unreadable": false },
  { "path": "wiki/notes/n.md", "type": "concept", "status": null, "document_id": null, "document_revision": null,
    "change": "new", "needs_verification": true, "unreadable": false, "behind": [] } ],
  "count": 3 }
```

Installed-CLI (`@6560c662e3ad`) difference: `page ls` only lists pages that
CARRY a `status` (or are unreadable), has no `change` and no `behind` keys, only
the `status` and `under` selectors, and `needs_verification` is computed
without `change`. A client that needs `change`/`behind` must feature-detect:
`"change" in row`.

### 1.9 `git changed <dirs> filter=since:<x>`

- argv: `wiki --read-only <key> git changed sources wiki research filter=since:1d --json`
  (dirs are bare tree names; dashboard validates `^[a-z][a-z0-9_-]{0,63}$`; omit
  for the four tracked trees).
- Answer: `Window`, `OPS/git/changed.py:38`.

```ts
interface GitChanged {
  marker: string;   // the point the window counts from: an instant ("2026-10-22T06:41:33Z"), a sha,
                    // or the literal "none" (no `since` or the op never closed: every file) /
                    // "unknown" (a sha this clone lacks, fell back to its instant)
  reason: string;   // "since 1d" | "no filter=since: given - every file" | "<op> has no marker in this clone - every file" | ...
  head: string | null;  // HEAD sha
  files: string[];  // existing files only (deleted files are dropped), de-duplicated, INCLUDES uncommitted
                    // working-tree changes and untracked (non-ignored) files
}
```

Notes: with no `since` it lists EVERY file (not "none changed"). Files are
repo-relative, may include `index.md` pages. A `since` sha that is not a commit
and not in the clone -> rc 2 (`unheld`). Installed CLI errors on an unborn
branch (rc 1, `error: "git log ... failed (128) ..."`); main answers. Example
(real):

```json
{ "marker": "2026-10-23T05:41:34Z", "reason": "since 1h", "head": "cff2eeb2...",
  "files": ["sources/web/a.md", "sources/web/b.md"] }
```

### 1.10 `op since filter=since:<x>`

- argv: `wiki --read-only <key> op since filter=since:1d --json`; also
  `filter=op:<name>` and `filter=outcome:ok|partial|failed|none`.
- Answer: `Since`, `OPS/op/answers.py:136` with rows `Run` (`:111`).

```ts
interface OpSince {
  given: string;         // the since argument as typed
  sha: string | null;    // resolved point
  instant: string | null;
  op: string | null;     // op filter applied
  outcome: string | null; // outcome filter applied (null = all)
  reason: string;        // "since 1d"
  count: number;
  runs: OpRun[];         // newest-first? [unverified order]
}
interface OpRun {
  op: string;            // op name e.g. "pass", "dream", "improve"; "none" when no Op trailer
  outcome: "ok" | "partial" | "failed" | "none";   // op/history.py:43 OUTCOMES + "none" for a missing trailer
  marker: string | null; // sha the run started from
  commit: string;        // the close commit
  summary: string;       // commit subject, e.g. "pass ok"
  when: string;          // instant
  actor: string;         // "<who>@<machine>"
  session: string;       // session id or "none"
}
```

Dashboard reads `runs[].{op,outcome,summary,when,actor}`. A `runs` row is a
CLOSED op (a commit with `Op:`/`Outcome:` trailers); `partial` holds a job's
period (a doctor with a failing row closes partial). Example (real):

```json
{ "given": "3d", "sha": null, "instant": "2026-10-20T06:41:35Z", "op": null, "outcome": null,
  "reason": "since 3d", "count": 1,
  "runs": [ { "op": "pass", "outcome": "ok", "marker": "b0adef97...", "commit": "cff2eeb2...",
              "summary": "pass ok", "when": "2026-10-23T06:39:38Z", "actor": "agent@devops1", "session": "b8c8de2a-..." } ] }
```

### 1.11 `op logs`

- argv: `wiki --read-only <key> op logs filter=limit:50 --json`; selectors
  `since`, `kind` (`event|hook|crash|dispatch`, `common/opslog.py:86`), `event`
  (a name), `limit` (int, dashboard 1-1000).
- Answer: `Logs`, `OPS/op/answers.py:67`. The store is the machine's local
  diagnostic log (not committed), default level `error`, 14-day retention.

```ts
interface OpLogs {
  count: number;            // matching rows after filters (may exceed rows.length)
  kind: string | null; since: string | null;   // the filters applied
  level: "off" | "error" | "info" | "debug";   // this machine's capture level
  retention_days: number;   // 14
  available_from: string | null;  // day of the oldest retained file
  event: string | null;
  noise: number;            // matching rows a producer marked as its own startup noise
  capped: boolean;          // more rows matched than `limit` returned
  rows: OpLogRow[];
  unreadable: { files: string[]; lines: number };
}
type OpLogRow =
  | { kind: "dispatch"; at: string; argv: string[]; rc: number; elapsed_s: number; signal?: string; stderr_tail: string }
  | { kind: "event"; at: string; event: string; fields: Record<string, unknown>; session_id?: string }
  | { kind: "hook" | "crash"; at: string; [k: string]: unknown };   // [unverified field sets]
```

A zero `count` is three different facts (nothing wrong / level `off` / aged
out); read `level` and `available_from`. Installed CLI's dispatch rows lack
the `argv/at/elapsed_s/rc/stderr_tail` keys (older shape). Example (real):

```json
{ "count": 3, "kind": null, "since": null, "level": "error", "retention_days": 14, "available_from": "2026-10-23",
  "event": null, "noise": 0, "capped": false,
  "rows": [ { "argv": ["jobs","request","demo-doctor","wait=30s","--json"], "at": "2026-10-23T06:40:07.104Z",
              "elapsed_s": 30, "kind": "dispatch", "rc": 1, "stderr_tail": "" },
            { "at": "2026-10-23T06:39:38.692Z", "event": "denials-read", "fields": {"count":0,"read":"absent","source":"slice-log"},
              "kind": "event", "session_id": "b8c8de2a-....6837700e8464" } ],
  "unreadable": { "files": [], "lines": 0 } }
```

### 1.12 `search status`

- argv: `wiki --read-only <key> search status --json`. Answer `StatusAnswer`,
  `OPS/search/status.py:29`.

```ts
interface SearchStatus {
  serving: string | null;     // backend that answers a query now: "grep" | "search_server"-style name | null
  engine_configured: boolean; // [search_server] block present
  engine_url: string | null;
  realm: string | null;
  realm_ready: boolean;
  realm_reason: string;       // why not ready ("" when ready)
  collection: string | null;
  index_as_of: { source_commit?: string; [k: string]: unknown } | null; // freshness checkpoint from the engine [unverified other keys]
  qdrant_auth: string | null; // "read-write"|"read-only"|"open"|"none"|"unauthorized"|null (no engine answered)
  corpus_files: number;
  dirty: number | null;       // files offered but not yet indexed; null on a grep-only wiki
  marker_known: boolean | null;
  backends: { name: string; configured: boolean; available: boolean; reason: string }[];
}
```

Example (real, grep-only wiki): `serving:"grep"`, `engine_configured:false`,
`realm_ready:false`, `corpus_files:13`, `dirty:null`,
`backends:[{name:"grep",configured:true,available:true,reason:""}]`.
The dashboard reads only `serving`, `realm_ready`, `realm_reason`,
`corpus_files`.

### 1.13 `skills ls`

- argv: `wiki --read-only <key> skills ls [<glob>] [--enabled|--disabled] [--diff] [filter=stage:<s>] --json`.
  Answer `Listing`, `OPS/skills/ls.py:35`; rows `skills/inventory.py:379`.

```ts
interface SkillsLs { total: number; skills: SkillRow[]; trust: string | null /* why .agents/trust.json is unreadable */ }
interface SkillRow {
  name: string;               // unit name, e.g. "channel-youtube"
  state: "enabled" | "drifted" | "linked" | "installed" | "absent" | "orphaned";
         // enabled/drifted/linked = this machine loads a copy; installed = wiki holds it, machine does not
         // (skills/enablement.py:63-68); drifted = wiki copy moved past the enabled copy
  source: string;             // where it lives (unit.where)
  from: string | null;        // provenance (package id)
  venue: string | null;       // host/venue the unit pulls from
  version: string | null;
  stages: string[];           // pipeline stages it declares
  customized: boolean | null; // wiki copy differs from its package; null = no comparison
  drifted: boolean | null;
  outdated: boolean | null;   // [unverified exact type]
  next: string | null;        // the one command that moves it forward
  warnings: string[];
  mapped: string | null;      // "filled/total" credential bindings, e.g. "1/2"; null if not loaded here
  approve: string | null;     // trust file verdict (e.g. "manual"/"auto"); null if trust unreadable
  changes?: object;           // with --diff
  // exact-name call (<glob> equals a unit name) also adds: manifest, enable_notes, customize_notes,
  // usage_notes, bins[], stage_sandboxes
}
```

Enabled-first ordering. A fresh `init`ed wiki lists none (`total:0`, `trust:null`,
real). Rows composed from code - [unverified against a populated wiki].

### 1.14 `skills search <task>`

- argv: `wiki --read-only <key> skills search "<task words>" [filter=k:10] --json`.
  Answer `Search`, `OPS/skills/search.py:43`.

```ts
interface SkillsSearch {
  task: string; k: number; total: number /* uncapped */; shown: number;
  matches: {
    name: string; source: string; from: string|null;
    state: SkillRow["state"] | "available" | "catalog";  // available = declared package, not installed; catalog = bundled catalog hit
    venue: string|null; version: string|null; stages: string[]; description: string|null;
    matched_on: ("host" | "keyword" | "venue" | "name" | "description")[];  // tiers, highest first [unverified exact tier spellings]
    next: string|null;
  }[];
  warnings: string[];   // e.g. "package llm-wiki-packages/llm-wiki-skills skipped: ... this session is read-only and nothing is cached"
}
```

Under `--read-only` nothing is fetched: a cold package cache gives
`total:0` plus a warning (real). `filter=k:` must be >= 1 (rc 2 otherwise).

### 1.15 `sandboxes ls --enabled`

- argv: `wiki --read-only <key> sandboxes ls --enabled --json` (also
  `--disabled`, glob). Answer `Listing`, `OPS/sandboxes/ls.py:32`. Dashboard
  reads only `{name, enabled}`.

```ts
interface SandboxesLs { sandboxes: SandboxRow[]; unexplained: string[] /* enabled copies no committed template accounts for */ }
interface SandboxRow {
  name: string;               // template stem: harvest, no-network, read-search, slice, wiki-write
  source: string;             // ".llm-wiki/sandboxes/<name>.jsonc" committed template
  path: string;               // ".agents/sandboxes/<name>.jsonc" this machine's enabled copy
  state: "enabled" | "drifted" | "linked" | "installed" | "absent" | "orphaned";
  enabled: boolean;           // the composer opens it (narrower than state)
  drifted: boolean | null;    // template gained a leaf the copy lacks; null = no comparison
  drift_level: "none" | "info" | "warn";  // [unverified exact info/warn spelling]
  next: string;               // command that fixes it, "" when nothing to do
  warnings: string[];
}
```

`--enabled` keeps states enabled|drifted|linked. Example (real): five rows,
all `{"state":"enabled","enabled":true,"drifted":false,"drift_level":"none","next":"","warnings":[]}`.

### 1.16 `inboxes ls`

- argv: `wiki --read-only <key> inboxes ls --json` (give an inbox name, and
  optionally `--all`, to list ITS messages instead). Answer `Inboxes`,
  `OPS/inboxes/answers.py:19`.

```ts
interface InboxesLs { count: number; inboxes: { name: string; state: "declared" | "undeclared" | "malformed"; messages: number }[] }
```

Undeclared inboxes with no held messages are omitted. Named form returns
`Inbox` `{inbox, state, count, messages: object[]}` [row keys unverified].
Real: `improve` and `review`, `declared`, 0 messages each.

### 1.17 `git conflicts`

- argv: `wiki --read-only <key> git conflicts --json`. Answer `Conflicted`,
  `OPS/git/conflicts.py:23`: `{ "pages": string[] }`, paths with two live
  versions (git-unmerged, or `keep=both` markers `<<<<<<<` left in a tracked
  file). Real, none: `{"pages": []}`.

### 1.18 Machine verbs (no wiki; `llm-wiki-cli machine ...`; all read tier)

`machine wikis ls --json` - `Listed`, `CLI/wiki/ls.py:14`:

```json
{ "config": "/home/u/.config/llm-wiki/config.toml", "count": 1,
  "wikis": [ { "key": "scratch", "name": "wiki", "path": "/tmp/cs/wiki" } ] }
```

Types: `{config:string; count:number; wikis:{key:string; name:string; path:string}[]}`.
Registry unreadable -> rc 2 with the reader's sentence. Real on this box: empty
registry (`count:0`).

`machine runner ls --json` - `Listed`, `CLI/runner/ls.py:32`:

```ts
interface RunnerLs {
  record: string;           // ~/.local/state/llm-wiki/runner.json
  count: number;
  wikis: { wiki_key: string;
           installed: { system: "cron"|"launchd"; every: string; entry: unknown; cli: unknown; written_at: string } | null;
           state: { kind: string; detail: string; verified_at: string; backoff_until?: string; hold_until?: string } | null; // a hold; kind e.g. "no-progress" [closed set unverified]
           last_outcomes: { at: string; kind: string; detail?: string; count?: number; last_at?: string }[]; // last 5 of the ring
           outcomes_total: number }[];
  scan: { healthy: string[]; unrecorded: string[]; stale: string[]; unknown: string[] };
       // wiki keys: recorded+on host / on host only / recorded only (deleted behind our back) / recorded but unverifiable
}
```

Real (no runner): `{"record":".../runner.json","count":0,"wikis":[],"scan":{"healthy":[],"unrecorded":[],"stale":[],"unknown":[]}}`.
`installed`'s inner keys are from `record.set_installed` (`CLI/runner/install.py:144`)
- composed, [unverified live]. Outcome `kind`s include `exit-ok`, `exit-nonzero`,
`operator-cleared` (`llm_wiki_machine/record.py`, `CLI/runner/run.py:75-76`).

`machine doctor --json` - `Doctored`, `CLI/doctor/doctor.py:57`:

```ts
interface MachineDoctor { ok: boolean; machine: MachineRow[]; failing: string[] }
interface MachineRow { check: string; status: "ok" | "info" | "warn" | "fail"; detail: string; fix: string | null }
```

Note the rows key is `machine`, not `rows`, and there is no `overall`/`worst`.
Real checks: registry, git, uv, llm-wiki-cli, editable-install-target,
python3.12, python3-on-path, hosts, runner-host, runner/credential,
credentials, credentials-at-rest, config, ... (open set; `registry/<key>`,
`search-route` etc. appear per wiki). Real warn: `runner-host`: "active jobs and
no host entry on this machine: scratch - nothing fires them", fix
`llm-wiki-cli machine runner install scratch`.

(`machine version --json`, used by the dashboard: `{version?, distribution?}`
[unverified fields]. `search query` is out of scope here.)

---------------------------------------------------------------------------
### 1.19 `git log filter=since:<x>`

- argv: `wiki --read-only <key> git log filter=since:7d --json`. Answer
  `History`, `OPS/git/log.py`: `{ marker, reason, commits: [{ sha, at,
  subject, op, actor, session, … }] }`, newest first. `at` is the commit
  time; the trailer keys are lowercased (`Op:` → `op`). A hand edit the sweep
  carried reads `op: "none"`, `actor: "user@<machine>"`; a session's write
  `agent@<machine>`. No file list per commit yet (llm-wiki-plugins #3675).

### 1.20 `page history <path>`

- argv: `wiki --read-only <key> page history <path> --json`. Answer
  `History`, `OPS/page/history.py`: `{ path, commits: [{ sha, at, author,
  subject, op, actor, session }] }`, newest first; a path no commit touched
  answers `commits: []`. Does not follow renames yet (#3675).

### 1.21 `page template <path>`

- argv: `wiki --read-only <key> page template <path> --json`. Answer
  `OPS/page/template.py`: `{ key, template, add, dates, body, unexpanded,
  warnings }`. `add` is what the page lacks, values expanded (a date as
  `YYYY-MM-DD`); `body` the expanded template body when the page body is
  empty, else null; `template: null` when no `[page.templates]` entry
  matches. Writes nothing.

## 2. Write verbs

All are tier `w`: refused under `--read-only` (rc 2). None is an attended
"protected write" (section 3). Run them as
`llm-wiki-cli wiki <key> <verb...> --json` WITHOUT `--read-only`.

### 2.1 `jobs request <slug> [wait=N]`

- argv: `wiki <key> jobs request <slug> [wait=30s] --json`. `wait` is a period
  (`<count><s|m|h|d|w>`), so `wait=120` alone is NOT valid - say `wait=120s`.
- Answer: `Requested`, `OPS/jobs/answers.py:248`; verb `OPS/jobs/request.py:110`.
  Spec: `docs/superpowers/specs/2026-10-14-a-skill-on-request-is-a-job-run.md`
  (status implemented). The spec is history; code below is what runs.
- What it does: refuse in a jail -> parse `wait` -> resolve job and its clock
  stage (`harvest`, or `routine` for a routines job) -> refuse if paused ->
  refuse inside the request gap -> `claim_jobs(strict=True)` (the claim gate:
  lease, push, mint a ticket stamped `requested`) -> `run_pass` for this job
  (looped until nothing of the job is pending/active, or `wait` elapses) ->
  answer read from the lanes and status rows.

```ts
interface Requested {
  slug: string;
  stage: "harvest" | "routine";   // the job's clock stage
  ticket: string;                  // the clock-stage ticket id (also returned when queued_already)
  minted: boolean;                 // false = a ticket was already in flight; this call waited on it
  outcome: "ok" | "failed" | "running";
  produced: object | null;         // clock stage's ok.produced (e.g. captures, routines_done/left); only when outcome == "ok"
  written: string[];               // pages the request's own landings filed
  elapsed_s: number;
  next: string | null;             // the job's newest PENDING ticket (the chain's next hop), else null
  error: string | null;            // null when ok; else the failure's reason
  wait: string | null;             // the period given, or null
}
```

Exit codes (`request.py` + `Requested.exit_code`, `answers.py:267`):

| situation | rc | stdout |
| :--- | :--- | :--- |
| `outcome: ok` | 0 | `Requested` |
| `outcome: failed` | 1 | `Requested` (detail in `error`) |
| `outcome: running` AND `wait` was given (wait elapsed, chain still live) | 1 | `Requested`; poll `tickets show <ticket>` / `jobs due` |
| `outcome: running` and NO `wait` (mint + one pass started the worker) | 0 | `Requested` |
| any refusal before the lease | 2 | `{error}` envelope |
| claim door minted nothing and refused nothing; unexpected exception | 1 | `{error}` envelope |

Refusal sentences (rc 2; discriminate by text/prefix):
- jail: `jobs request is the host's - a jailed supervisor holds, retries, drops, or waits for the pass - it starts nothing and edits no job`
- unknown job: `no job '<slug>' - `jobs ls` names every job this wiki declares`
- bad wait: `wait='x' - a period is <count><s|m|h|d|w>, e.g. wait=6h`
- paused: `<slug>: paused - `jobs resume <slug>` first`
- gap: `<slug>: <stage> landed <N>s ago - a request waits <M>s more (jobs.request_gap_seconds <G>)` (default gap 60 s; machine config `[jobs] request_gap_seconds`, wiki `.llm-wiki.toml` lower wins)
- not joined: `this checkout has not joined the wiki at <path> - `llm-wiki-ops join key=<key>` mints the machine id a claim is filed under, and there is none here`
- claim gate sentences (enablement, binding/credential, trust, pin, engine, a peer's or sticky lease, `jobs request` on a sticky job off its holder): free text, e.g. real `no search server is configured here` for `ops-hourly-host` on a wiki without a search server.
- lost lease: `<slug>: the lease went to <holder|a peer> - nothing minted`
- read-only: `jobs request writes, and this session is read-only`

Example (real: `jobs request demo-doctor wait=30s`, rc 1; the worker was
killed because my scratch mixed the installed plugin scripts with main's
code, so read it as the SHAPE of an elapsed wait, not a healthy run):

```json
{ "slug": "demo-doctor", "stage": "routine", "ticket": "6837700e8464", "minted": true,
  "outcome": "running", "produced": null, "written": [], "elapsed_s": 30,
  "next": "6837700e8464", "error": "killed", "wait": "30s" }
```

A healthy completed request is `{outcome:"ok", written:[...], next:null,
produced:{...}, error:null}` with rc 0 [composed; not reproduced here].
Click handling: a second click inside the gap is a rc-2 refusal; a click while
a ticket is in flight returns `minted:false`.

### 2.2 `jobs pause <slug>` / `jobs resume <slug>`

- argv: `wiki <key> jobs pause <slug> --json`, `... jobs resume <slug> --json`.
- Answer `Stated`, `OPS/jobs/answers.py:105`: `{ "slug": string, "state": "paused" | "active" }`.
  Real: `{"slug":"demo-doctor","state":"paused"}`.
- Idempotent (resume of an active job: rc 0, same answer). Rewrites the job's
  `job.json` (committed). Refusals (rc 2): unknown slug (`no job 'x' - ...`),
  jailed caller (`jobs pause/resume is the host's - ...`), read-only. Does NOT
  require a joined checkout (it succeeded on an unjoined wiki). Takes effect
  on the next tick; a paused job's pending tickets are skipped, not removed.

### 2.3 `jobs run`

- argv: `wiki <key> jobs run [wait=30s] [job=<slug>] --json` (no positional).
- Answer `Passed`, `OPS/jobs/answers.py:230`; verb `OPS/jobs/run.py:762`.

```ts
interface JobsRun {
  landed: string[];     // ticket ids whose finished workers were landed (closed)
  refreshed: string[];  // leases refreshed ("<slug>#<stage>")
  started: string[];    // ticket ids whose workers this pass started
  skipped: { id: string; reason: string }[];  // starts refused (blocked, no credential, queue refusals, lease refresh refused, ...)
  lock: { held: true } | { held: false; skipped: "lock held"; owner: object | null };
        // held:false = another pass held the lock past the bounded wait; every other field is then empty
}
```

Always rc 0 when it answers (a lock-skipped or all-skipped pass is still 0;
`Passed` has no `exit_code`). Refusals rc 2: jailed (`jobs run is the host's -
...`), unjoined, bad `wait`. Real idle pass: `{"landed":[],"refreshed":[],"started":[],"skipped":[],"lock":{"held":true}}`.
Same pass `jobs request` runs, narrowed with `job=`. Starting a worker needs the
sandbox runtime and harness this machine configured; failures show in
`skipped[].reason`.

### 2.4 `tickets retry <id>` / `tickets drop <id>`

- argv: `wiki <key> tickets retry <id> --json`, `... tickets drop <id> --json`.
- `retry`: Answer `TicketRetried`, `OPS/jobs/answers.py:203`:
  `{ "item": string, "queue": Queue, "already_landed": boolean }`. Moves a
  PARKED (`failed` lane) ticket back to `pending` with ONE attempt restored
  (`attempts_left: 1`), drops its `requested` stamp. `already_landed:true` =
  the id was a set-aside `.closing` whose landing had finished; it was deleted,
  nothing put back. Also accepts an orphan (re-lands it into `active`).
- `drop`: Answer `Dropped`, `OPS/jobs/answers.py:343`:
  `{ "item": string, "queue": Queue, "reason": "dropped" | null }`. Real:
  `{"item":"6837700e8464","queue":"routine","reason":"dropped"}`. Takes a
  `pending` or `failed` (parked) ticket (or an orphan); it lands in `done` with
  `dropped:true`, `reason:"dropped"`, and releases the job's lease if idle.
- Refusals (rc 2, real):
  - retry on a non-parked ticket: `<id>: routine/pending, not parked - retry puts a parked (failed) ticket back`
  - drop on a done ticket: `<id>: routine/done - drop takes a pending or parked (failed) ticket`
  - drop on an active ticket: `<id>: active - `tickets close <id>` ends an active ticket`
  - unknown id: `no ticket 'x' in any queue - `tickets ls` names what each holds`
  - already waiting: `<id> is already waiting in <queue>/pending`
  - missing arg: `<id> is required`; read-only.
- Neither requires the job's checkout to be joined in the code path I ran, but
  both resolve through the queue tree under the ops dir.

### 2.5 `page curate <paths> [reject=]`

- argv: `wiki <key> page curate <path> [<path>...] [reject="reason"] --json`.
- Answer `Changed`, `OPS/page/answers.py:28`; verb `OPS/page/curate.py:16`.

```ts
interface PageChanged {
  pages: { path: string; document_id: string | null; document_revision: number | null;
           status: string | null; action: "curated" | "rejected" | "retired" }[];
  count: number;
}
```

- Accept (no `reject`): sources page `draft`->`stable`, appends a
  `verified:[{by,at}]` entry, bumps `document_revision`, stamps `generated`
  (`stage: curated`). An import (identity, no status, no hash) is curatable.
  A `wiki/` page with no identity: only gains `verified` (acknowledgement),
  `action:"curated"`, revision unchanged (`null`).
- Reject (`reject=<reason>`): status `deprecated`, `excluded_reason=<reason>`,
  `action:"rejected"`. `wiki/` pages cannot be rejected (rc 2: `<p>: a wiki page is retired, not rejected - `page retire``).
- Pages are judged all-or-nothing up front: one refusal rejects the call
  before any write. A path named twice is judged once.
- Refusals (rc 2): `no such page: <p>`; `<p>: edited <N>s ago; retry after the
  settle window ([edits] settle_seconds)` (a recently saved, unjudged page; a
  human may still be typing - retry later; I hit this at 337 s); `<p> has
  status '<s>' - only 'draft' pages, and 'stable' pages whose content has
  moved since their last verification, are curatable` / `carries no status`;
  `<p> has not changed since it was last judged - nothing to acknowledge`
  (wiki/); `<paths> is required`. Real accept:

```json
{ "pages": [ { "path": "sources/web/b.md", "document_id": "11111111-...", "document_revision": 2, "status": "stable", "action": "curated" } ], "count": 1 }
```

Real reject (`reject="not relevant"`): same shape with `"status":"deprecated","action":"rejected"`.
The page file is rewritten in place; committing is a separate act (git
commit / the transport).

### 2.6 `page retire <paths> reason=<text>`

- argv: `wiki <key> page retire <path>... reason="<why>" --json`. `reason=` is
  REQUIRED (rc 2 `reason= is required`).
- Answer `Changed` (same as 2.5), `action:"retired"`, status `deprecated`,
  `excluded_reason` set, `document_revision` bumped, `generated.stage:"retired"`.
  Real: `{"pages":[{"path":"sources/web/b.md","document_id":"1111...","document_revision":3,"status":"deprecated","action":"retired"}],"count":1}`.
- Refusals (rc 2): `<p> is already retired - its `generated.stage` says so`;
  `<p> carries no identity - `page adopt` mints one` (a hand-made wiki page);
  no such page; read-only. No settle-window check on retire.

### 2.7 `search index`

- argv: `wiki <key> search index [--full] --json`. Answer `IndexAnswer`,
  `OPS/search/index.py:70`.

```ts
interface SearchIndex {
  owner: string | null;           // "search_server" when an engine indexes; null when none
  status: "no_index" | "synced" | "partial" | "unavailable" | "deferred";
  full: boolean;
  scanned: number;                // files offered
  indexed: number | null;         // null where the owner cannot count
  unchanged: number;
  marker_known: boolean | null;   // null on --full (marker ignored)
  conflicts: string[];            // 409 revision conflicts, every pass
  skipped: string[];              // 4xx refusals
  failed: string[];               // 401/403/5xx
  note: string | null;
}
```

rc 1 (answer still printed) when `status` is `partial` or `unavailable`; rc 0
for `synced`, `no_index`, `deferred` (another index/reindex holds the shared
`stage.index` lock; not a failure). Real (grep wiki, no engine): `status:"no_index", owner:null, scanned:14, note:"this wiki answers from grep, which needs no index"`, rc 0.
Refusals: read-only; a search config the reader refuses.

### 2.10 `page adopt <paths>`

- argv: `wiki <key> page adopt <path> [<path>...] --json`. Write tier.
- Answer `Changed` (same shape as `page curate`), verb `OPS/page/adopt.py:39`:
  rows are the page's `page ls` row plus `action: "adopted" | "observed"`
  (`observed` = a non-markdown file got a stub sibling page). Mints
  `document_id` into frontmatter and queues extraction for a source file.
- Refusals (rc 2): `no such page: <p>`; a path outside the content trees.

### 2.11 `git commit` (the sweep)

- argv: `wiki <key> git commit --json`. Answer `Committed`,
  `OPS/lib/git/commit.py`: `{ commits, adopted, unadopted, links_left_out,
  swept, deferred, withheld, observed, settling }`. `settling` lists the
  pages changed inside the settle window (`[edits] settle_seconds`, 600 by
  default) that the sweep left for a later one.

### 2.8 `git sync`

- argv: `wiki <key> git sync --json`. Answer `Synced`, `OPS/git/sync.py:31`.

```ts
interface GitSync { pulled: boolean; pushed: boolean; note: string /* "; "-joined; "" when clean */;
                    ahead: number | null; behind: number | null; unpushed: number | null }
```

Pull with rebase then push. A dirty tracked tree defers the PULL (note
`pull deferred (a tracked file carries an uncommitted change)`); the push still
runs. rc 0 in every degraded case (no remote, locked, busy, conflict,
unreachable) - the failure is in `note`/booleans, so read `pushed`/`unpushed`,
not rc. Real (no remote): `{"pulled":false,"pushed":false,"note":"no remote configured - nothing to pull or push","ahead":null,"behind":null,"unpushed":null}`.
Other notes: `another write holds the wiki's git lock`, `this checkout is
<busy note>`, `pull deferred (rebase conflict | remote unreachable | HEAD is
detached | ...)`, plus push recovery notes. Refusals (rc 2): jailed
(`git sync is the host's - ...`), read-only.

### 2.9 `git conflicts resolve <path> [keep=]`

- argv: `wiki <key> git conflicts resolve <path> [keep=ours|theirs|both] --json`
  (default `keep=both`). Answer `Resolved`, `OPS/git/conflicts.py:30`:
  `{ "path": string, "keep": "ours"|"theirs"|"both", "marked": boolean }`.
  `marked:true` only for `keep=both` (both versions kept inside conflict
  markers, left for a human or `page curate`). Note `ours`/`theirs` flip
  meaning during a rebase (stage_of handles it; "ours" = this machine's change).
- Refusals (rc 2): `keep=x - keep is one of ours, theirs, both`; `<p> is not
  conflicted: git holds one version of it` (real); `<p> is a binary file - its
  <keep> version cannot carry conflict markers; resolve it with keep=ours or
  keep=theirs`; `<p> carries no <keep> version in the index`; jailed; read-only.

---------------------------------------------------------------------------
## 3. Answers to the four questions

### (1) Protected writes and attendance

Source: `docs/contracts/dev/env.md`, "Attendance". A session is marked
attended by env var `LLM_WIKI_SESSION_ATTENDED=1` (literal `1`; absent =
unattended; nothing writes `0`). The plugin's `SessionStart` hook sets it only
when Claude Code's own `CLAUDE_CODE_SESSION_ATTENDED=1`; another harness's
user sets it by hand. A protected write calls `attendance.require` first:
attended passes silently; otherwise it asks on the CONTROLLING terminal
(never stdin/stdout) and a process with no tty refuses. `--dry-run` asks
nothing. The contract says the variable name is dev-only: never print it in
user-visible text; setting it in a spawned process's env is fine.

Protected: every `llm-wiki-cli machine` verb that writes except `machine
runner run`; ops verbs that write operator state outside the wiki (`join`,
`sandboxes enable`, `credentials set|login|bind|unbind|logout|remove`,
`policy keep`); `registry.seed_unsandboxed`. Confirmed call sites (grep
`attendance.require`): join, sandboxes enable, policy keep, credentials,
machine packages prune, runner install|remove|clear, config set, credential
provide|seal|lock|unlock|env, wiki register|deregister|vault, install.

NONE of section 2's verbs is protected (`jobs request|pause|resume|run`,
`tickets retry|drop`, `page curate|retire`, `search index`, `git sync`,
`git conflicts resolve`): no `attendance.require` in their code, and I ran all
but `retry`/`conflicts resolve` unattended with no prompt. Protected verbs
the plugin may still hint at: `llm-wiki-cli machine runner install <key>`,
`llm-wiki-ops sandboxes enable <name> --confirm`, `join`.

### (2) Verbs that refuse on an unjoined machine

Two meanings. (a) The CHECKOUT has no machine id (`init` ran, `join key=<k>`
did not). Exact refusal, rc 2: `this checkout has not joined the wiki at
<path> - `llm-wiki-ops join key=<key>` mints the machine id a claim is filed
under, and there is none here` (`OPS/jobs/claims.py:96 owner()`). Tested on
an `init`-only wiki:
- REFUSE: `jobs ls` (also `--verbose`), `jobs due`, `jobs show`, `jobs run`,
  `jobs request` (on an active job; a paused one refuses "paused" first).
  By code, anything calling `claims.owner` [unverified individually].
- WORK (rc 0): `doctor` (`ok:false, overall:"fail", failing:["machine",
  "agents-link","skills-link"], worst.fix:"llm-wiki-ops join key=<key>"`),
  `status --peers` (`joined:false, machine:null, peers:[]`), `tickets ls|show`,
  `page ls`, `git changed|conflicts|sync`, `op since|logs`, `search
  status|index`, `skills ls`, `sandboxes ls`, `inboxes ls`, `jobs pause|resume`.
  `tickets retry|drop` and `page curate|retire` showed no join refusal (they
  refused only on the missing ticket/page).

(b) The WIKI is not in the machine registry: the forwarder refuses every
`wiki <key> ...` with rc 2 `{"error":"no wiki 'nokey' - registered: scratch"}`
(real). `machine wikis ls|runner ls|doctor` need no wiki.

### (3) `jobs request` with no runner installed

It still runs the pass itself: `request.py:144` calls `run.run_pass(root, ...,
job=[slug])` in-process after minting, so the scheduled runner (cron/launchd
entry from `machine runner install`) is not involved. Verified on a scratch
wiki with no host entry (`machine doctor`: `runner-host` warn, "active jobs
and no host entry on this machine ... nothing fires them"): the request
leased, minted `6837700e8464`, ran the pass, started the worker and waited the
30 s (rc 1, `outcome:"running"`). What it does not do without a runner:
continue the chain after it returns (later routine tickets, retries held by
`not_before`, lease refresh) - those wait for the next `jobs run`, the
exit-hook pass a worker fires on exit, or a runner tick. So use a `wait=` long
enough, or follow with `jobs run job=<slug> wait=...`. `doctor` flags the gap
as `jobs-poll` warn; fix is `llm-wiki-cli machine runner install <key>
[every=30m]` (protected).

### (4) The `read-search` sandbox

A committed sandbox TEMPLATE, `<ops dir>/sandboxes/read-search.jsonc` (seed:
`llm_wiki_ops/presets/base/_seed/_llm-wiki/sandboxes/read-search.jsonc`). It
is the jail `harness run` answers a question in: READS the wiki, WRITES none
of it, reaches the wiki's search server only through a per-session credential
route (`"search": "query"`; the proxy holds the query token and refuses every
path outside the wiki's realm; the session never sees it), plus the harness's
own model hosts and nothing else (`filesystem.read: ["$WORKDIR"]`, no
`allow`, so it composes as the read-only jail). Contracts: `sandbox.md`
(search route) and `wiki-contract.md` ("The sandbox profiles"). The
dashboard's Ask passes `sandbox=read-search`.

How a wiki gets it:
1. `init` commits the five templates (harvest, no-network, read-search,
   slice, wiki-write) to `.llm-wiki/sandboxes/`. A template is inert until
   this machine enables it; the enabled copy is `.agents/sandboxes/<name>.jsonc`
   (gitignored, machine-local).
2. `join key=<k>` enables a committed template in the same act ONLY where its
   bytes equal the packaged seed. On the scratch wiki all five were `enabled`
   after init + join (real).
3. Otherwise (older wiki, or a peer edited it): `sandboxes seed read-search`
   (writes the packaged template if absent, never overwrites) then
   `sandboxes enable read-search --confirm` (protected write). That is the
   pair the dashboard prints in its "Ask is off" hint (`live.ts askOff`).
4. A copy that asks for the search route where none can be minted (no
   `[search_server]`, realm or token) refuses at compose; `machine doctor`
   has a `search-route` row for it.
