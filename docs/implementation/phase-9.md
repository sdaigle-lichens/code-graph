# Phase 9 — Gap detection & throwback for retrieval

## Goal

When the code-graph is incomplete — concepts declared but not built, built but not
enriched, or relevant code covered by no concept — make the retrieval flow **aware** of
the gap, **surface** it without sabotaging good answers, and **offer to fix** the fixable
cases. Never block the user's actual question to do so.

Motivation: concepts are enriched one at a time by the `scribe-code-graph` skill, so a
project's graph is routinely incomplete. The dangerous case is *silent partial success* —
the agent gets good-looking results from the enriched concepts while relevant un-enriched
concepts contribute nothing, and acts on partial understanding without knowing it.

## Gap taxonomy & scope

| # | Gap | Definition | Disposition |
|---|---|---|---|
| **a** | Un-applied | Concept declared in `scribe.config.json` but **0 live vertices** in DB | Detect → offer to build |
| **b** | Un-enriched / partial | Concept has live vertices but low non-empty-`purpose` ratio. `0%` = un-enriched; `>0% & <threshold` = partial; `≥threshold (~95–100%)` = enriched | Detect → offer to build |
| **c** | Uncovered code | Query intent points at source files matched by **no** concept's globs | Surface only (evidence-based, whiff-only). No auto-fix — needs a config edit |
| **d** | Stale/drift | Concept built+enriched but drifted | Out of scope — existing drift reporting covers it |
| — | Un-enrichable | Concept with no `skill` and no `skillsDir` → `/scribe-enrich` hard-fails (`scribe-enrich.md` step 35) | Distinct category: whiff-only callout, excluded from the fix offer **and** from the completeness ratio |

Note on "un-enrichable": `/scribe-enrich` hard-fails when no skill path is resolvable, even
though `purpose`/`inputs`/`outputs` are derived from source slices and only tag vocabulary
needs the SKILL.md. Relaxing that hard-fail is **out of scope** here — it is only the reason
this category exists.

## Detection — lives in the CLI

The CLI owns deterministic gap computation (it has config + DB + filesystem). The skill only
interprets and acts.

- **Completeness ratio / (a)+(b) classification** — one AQL aggregation (`COLLECT` live
  vertices by concept, count non-empty `purpose`) joined with the config concept list.
- **(c) coverage facts** — the set of source files matched by **no** concept's globs (reuses
  the glob filtering in `extract.ts:502`). The CLI emits the *set*; the **skill** runs the
  scoped query grep over it (the skill already owns grep fallback, only needed on whiff).
- **Completeness ratio** = enriched concepts / total **enrichable** concepts. Un-enrichable
  concepts are reported separately, e.g. `4/6 enriched (1 concept has no skill)`.

### Lazy computation (zero cost on the happy path)

Order of operations: run search → classify strong / thin / whiff from the result set we
already have → only then conditionally compute the gap.

- Ratio computed **only on thin-or-whiff** results.
- (c) coverage filesystem walk runs **only on whiff (exit 6)**.
- **Strong-result queries pay no extra latency** — the case the graph is optimized for is
  untouched.

## Surfacing — per exit path

- **Whiff (exit 6)** — print a markdown **diagnostic block** to stdout (incomplete concepts +
  per-concept enrich-feasibility + uncovered-file set), then exit 6. No new exit codes; the
  agent already branches on 6. The skill then greps the uncovered set:
  - hits in uncovered files → concrete (c) pointer ("matches in `src/foo/…`, covered by no
    concept — consider declaring one")
  - no hits → falls through to the normal Explore fallback
- **Success (exit 0)** — append a **thin-gated** one-line FYI to the footer, e.g.
  `> ⚠ graph 4/6 concepts enriched — results may be partial`. **Suppressed when results are
  strong** (no self-doubt, no grep-storm, no per-query noise).
- **Both** — mirror the same data into `--json` output so the eval harness can assert on it
  without parsing markdown.

### Anti-self-doubt guardrail (SKILL.md)

Explicit instruction in `code-graph-retrieval/SKILL.md`: *returned results are authoritative
for what is in the graph; the completeness note is status for the user, not a cue to fall
back to grep. Only act on it if the user asks to improve coverage.* The note addresses the
human, not Claude's next action — this is what prevents the note from defeating the graph's
whole purpose.

## Command scope

- **`search`** → full treatment (whiff diagnostic + offer + thin-gated success note).
- **`query concept <name>` / `query cross <a> <b>`** → on **exit 6**, if a named concept is
  declared-but-not-live, emit the same gap diagnostic + offer. Highest-signal case: the user
  named a missing concept directly. No success note.
- **`query impact` / `query vertex`** → unchanged. A gap here is real but **not attributable**
  to a specific declared concept, so forcing a diagnostic would be noise.

## The throwback — agent orchestrates (design option C)

The retrieval skill (`Bash, Read`) **detects + surfaces + names the remediation**. It does
**not** drive the multi-skill fix: skills run to completion, don't chain skills, and enrich
needs `Write`. The **outer agent** runs the fix.

**Non-blocking, answer-first:**

1. On a whiff, the agent **answers the question now** via the normal Explore/grep fallback.
2. *Then* appends a **prose offer**: "Answered via grep. Concept `X` is declared but not
   built — want me to build it so future queries hit the graph?"
3. The build is framed as an investment for next time, never a prerequisite (enrichment is a
   multi-minute subagent run; blocking the answer on it inverts the user's priority).

**On "yes" — uniform 3-step remediation** for every fixable gap (a and b alike), no currency
check:

```
code-graph extract <concept>   →   /scribe-enrich <concept>   →   code-graph apply <concept>
```

`extract` is an idempotent AST walk; `apply` does drift/upsert; agent fields are preserved
verbatim across re-extract — so re-running the full pipeline is always safe and correct.

**Guards:**

- Un-enrichable concept → do **not** offer the pipeline; tell the user to add a
  `skill`/`skillsDir`.
- (c) → guidance only, no commands.
- **Nag control** — if the user already declined a given concept this session, don't re-offer;
  proceed silently. Soft, via the agent's conversation memory; no state file (over-engineering
  for this).

## Testing

- **Pure-function core** — factor gap analysis into a DB-free function:
  `(config concepts, per-concept vertex + non-empty-purpose counts, source-file list)`
  → structured gap report (a / b / partial / un-enrichable classification, ratio, uncovered
  set). Exhaustive unit fixtures for every band: un-applied, 0% / partial / fully enriched,
  un-enrichable, uncovered files, ratio math.
- **One integration test** against a small throwaway seeded DB to confirm wiring + the
  `--json` contract shape.
- **Read-only regression guard** in the existing pilot harness: assert the current 4/4 tasks
  produce **no** completeness note (strong results → thin-gate suppresses). Protects Layer-A
  *and* proves thin-gating on real data — safe because it only reads the pilot.
- **Pilot DB stays untouched.** No gap-state entries added to `eval/tasks.json` (they would
  require pilot mutation); those live in the dedicated unit fixtures.

## Deferred (tunable, not blocking)

- The **"thin" threshold** (top-score cutoff and/or min hit count) — to be proposed against
  the existing normalized `score` in `search.ts` (`bm25/maxBm25 * 0.7 + degree/maxDegree * 0.3`).
- The **enrichment ratio threshold** (~95–100%) for the "enriched" band.

## Explicitly out of scope

- Auto-editing `scribe.config.json` to create concepts for (c).
- Relaxing `/scribe-enrich`'s hard-fail on missing skill.
- Drift / staleness (d) — covered by existing drift reporting.
