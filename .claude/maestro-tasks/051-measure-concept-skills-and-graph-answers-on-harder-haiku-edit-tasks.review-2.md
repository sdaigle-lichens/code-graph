Round 2

Previous redirect (m004), each point followed by how it was addressed:
1. "The 1.15x ratio is out of reach near the ceiling; define both on missed points (a third of missed points, small floor), say what happens when the baseline misses almost nothing." Addressed: a rule on missed points. X recovers from baseline B in a group if missed(B) - missed(X) is at least a third of missed(B) and at least 3 points. If B misses fewer than 3 points in a group, the group is inconclusive (saturated), neither pass nor fail. At least 3 more missed than B is "hurts"; otherwise "no effect shown". Cost-only fallback: 20% lower cost per run at no points lost. Gap to Sonnet is missed(haiku-nograph) - missed(sonnet-nograph), counted only at 3 points or more; an arm closes it by recovering half at under half of Sonnet's cost. The doc says the user confirms final numbers and the cap at pilot time.
2. "Report and decide per group (test, scribe) as well as overall." Addressed: every verdict is given for test, scribe and overall (maxima 24, 48, 72 at 2 runs); the overall never overrides a group verdict; the per-agent model recommendation follows the group verdict. A results template table was added (no results). One new test checks the rule text and the 24/48/72 arithmetic against the cases.
3. "Try what the graph really offers for d2/d3/d4 (search plus impact) before settling for a thin oracle." Addressed: captured one `search` plus the existing `impact` per case (5.6k to 10.6k chars), real CLI output at pin 3814a30, nothing invented. `search` reaches the matching concept SKILL.md (task-queue, maestro-architecture, claude-session-bridge) but not the stale lines inside them, and docs outside every concept's globs (maestro-manager/SKILL.md, tools-tasks-runtime.md, the log-view skill) never appear. `docs/evals.md` states the limit and that the scribe verdict measures it.

## Goal
Pre-registered decision rule and oracles ready for the user's pilot; no paid run yet.

## Done
Points 1 to 3 above. `node --test bench/lib.test.mjs`: 95 pass. `edit-check` sets 051 and 044: graders behave. `capture-oracle.mjs --check`: all 12 stored oracles unchanged.

## Deviations
- `bench/capture-oracle.mjs` gets an additive `proxy_extra` loop (list of argv lists), and `search` exit 7 (low confidence) is accepted for search only. d2, d3, d4 carry `proxy_extra` in `cases.json`.
- `cases.json` was rewritten through JSON.stringify: it dedupes old repeated `sets` keys in m2 and m4 (same resolved value). Diff noise, parsed content of existing cases unchanged.
- `pnpm check` fails in the sandbox (lockfile EPERM); `check-versions` and `check-plugin-clean` pass directly. `--init-check` is for the user.

## Decisions
MAESTRO_DIR handling untouched (053). Doc commands still set `MAESTRO_DIR` by hand, to reconcile with `maestroFor` after 053 merges.

## Touches
`docs/evals.md` ("Ticket 051"), `bench/cases.json`, `bench/capture-oracle.mjs` (overlaps 053), `bench/oracle/` (d2, d3, d4), `bench/lib.test.mjs`; earlier round: `bench/lib.mjs`, `bench/run.mjs`, `bench/README.md`, `bench/edit/ref/`.

## Sibling impact
053 also edits `bench/capture-oracle.mjs`, `bench/run.mjs` and `bench/README.md`: a small merge overlap, now including capture-oracle.

## Questions
None open. The thin scribe oracle is kept after trying search plus impact, per your point 3.
