# Measure the best-case saving if graph answers were free to get

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Ticket 039 (`docs/evals.md`, "Ticket 039") found that the graph doesn't save cost on maestro:
$2.577 graph vs $2.580 no-graph over five impact and cross questions. Two causes are mixed together:

- **Friction.** The model has to choose the retrieval skill, load its body and call the CLI through
  Bash. It did so in only 5 of 10 graph runs.
- **Little to save.** On m1–m3, Grep found the direct callers in 2 to 4 calls.

Before reworking how the graph is delivered (a Grep hook or native tools), find the ceiling: how much
cheaper an answer gets when the graph's output costs nothing to obtain. If even that isn't clearly
cheaper than Grep, no delivery rework will pay off.

**Oracle arm.** Add an `oracle` arm to `bench/`:
- Same workspace as `nograph`: maestro's concept skills, no plugin, no `scribe-output/`.
- The prompt is the question followed by the graph output the retrieval skill would have fetched,
  framed as context from a code index. That is the case's `proxy` command output, captured once and
  stored with the case, so every run gets the same text.
- The init event must show no code-graph plugin, as in `nograph`. The 038 validity checks apply.

**Questions.**
- Keep m1–m5 (maestro pinned at `3814a30`).
- Add 2 or 3 questions where Grep should be genuinely expensive:
  - transitive impact two or three levels deep;
  - or a common name with many non-call hits.
- Each new question needs:
  - a written expected answer;
  - `must` regexes;
  - a `why_grep_expensive` note;
  - an offline proxy ($0) showing that the graph output covers the answer.
- The user approves the final set before any paid run. The selection bias note applies, as in 039.

**Paid run.**
- User-run from a plain terminal: Opus 5.5, 2 runs per arm, total cap $7.
- Arms:
  - `nograph` and `oracle` on every question;
  - the existing `graph` arm on the new questions only.
- Reusing 039's `nograph` runs for m1–m5 is not allowed: run both arms fresh, in the same invocation.
- 039 lost four runs to a 429 usage limit:
  - a run that fails on a usage limit is not counted;
  - rerun the affected cases as a separate invocation, as 039 did.
- If more than one run is invalid for any other reason, stop and report.

**Decision rule, stated in the report before the results.**
- For a question group (m1–m3 impact, m4–m5 cross, new deep questions), "clearly cheaper" means:
  - `oracle` is at least 20% cheaper than `nograph` on the group total;
  - and both runs of each question point the same way.
- Otherwise, the ceiling is too low for that group to justify a delivery rework.

**Report.** Per question and arm:
- cost, turns, tokens, tool counts and pass rate;
- per group: `oracle` vs `nograph`;
- for the new questions only: `graph` vs `oracle`, which is the friction cost;
- a plain verdict per group, with confidence at n=2.

Write the result into `docs/evals.md` as a "Ticket 041" section.

Out of scope:
- changes under `plugin/` or `packages/`;
- building any delivery (hook, MCP server, skill rework); the user decides after this;
- enrichment, other models, a version bump.

## Scope change (user decision, 2026-10-27)

The full 32-run plan (~$7–8) did not fit the $7 cap. The user chose **deep questions only**: m6 and
m7, arms `nograph`, `oracle` and `graph`, 2 runs each (12 runs, ~$3.6), in one invocation:
`node bench/run.mjs --group maestro --only deep --arms nograph,oracle,graph --runs 2 --budget 5 --run-budget 0.75`.
m1–m5 are not run. The report gives a verdict for the deep group only and says the m1–m3 and m4–m5
groups were not measured. If the oracle is clearly cheaper on the deep group, m1–m5 can follow as a
separate invocation, about $4.

## Acceptance criteria

- [ ] `bench/` has an `oracle` arm whose prompt carries the stored graph output, with unit tests in `bench/lib.test.mjs`; the init event shows no code-graph plugin in it
- [ ] 2 or 3 new deep-impact questions with expected answers, `must` regexes, Grep-cost notes and an offline proxy, approved by the user together with m1–m5
- [ ] User-run paid run (2 runs per arm, cap $7), with every counted run valid and usage-limit failures rerun separately
- [ ] `docs/evals.md` has the decision rule, the per-question table and a per-group verdict
- [ ] `node --test bench/lib.test.mjs` and `pnpm check` green

## Blocked by

None - can start immediately.

## Post-Mortem

- **Problem:** @backend ran `bench/maestro-setup.sh` with the repo root as cwd. It extracted maestro@3814a30 into the working tree and overwrote the user's uncommitted `.claude/maestro-tasks/status.json` and `.claude/maestro.json` (041/042 entries lost; the epic manager restored them). The sandbox blocked its delete of `.claude/settings.json`. A guard was added: the script now refuses with exit 2 unless its cwd is an empty directory outside any git work tree, and a unit test covers it.
  **Fix:** none
- **Problem:** The approved 32-run plan (~$7–8) did not fit the ticket's $7 cap; the test and review steps caught this only after the user had approved it. Scope was cut to the deep questions (m6/m7) by user decision, so m1–m5 got no verdict.
  **Fix:** none
- **Problem:** The `graph` arm made no code-graph call in any of its 4 runs, so graph vs oracle does not measure the friction it was meant to measure.
  **Fix:** none
