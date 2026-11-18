# Keep concept skills up to date without the user, from the Stop hook and from the Maestro scribe subagent

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Goal: after installation and the first concept list (both still ask the user), the code-graph loop keeps concept skills current on its own, both from a session's Stop hook and when the Maestro scribe subagent (Haiku, no AskUserQuestion, no Agent tool, gets code-graph:scribe injected) runs it. Today nothing triggers update-concept-skills (one consumer's concept list trails HEAD by 78 commits, 10 of 16 concepts behind), the refresh-skills Stop hook only re-runs extract + apply on concepts whose SKILL.md already changed, and the flow ends on a numbered proposal the caller must settle. Needs code (hook / refresh-skills CLI, tests) and skill-file changes:

1. Trigger (code): when concepts are behind HEAD, the Stop hook starts the update-concept-skills flow unattended, for example as a background headless Claude run; the mechanism is the builder's design call (assumed, unverified: that a hook can start it without blocking the session or tripping its timeout). It must respect a minimum interval between runs to cap token cost, and never start while another update run (hook-started or in a session) holds the existing refresh-skills lock.

2. Unattended refresh (skill): revisions to existing concepts apply without the numbered-proposal stop; the result is left uncommitted for a git diff afterwards.

3. Structural changes after the initial list are automatic (skill): a concept for an uncovered directory is added, a concept whose globs match nothing is removed. A rename is applied only when renameCandidates gives exactly one unambiguous match; otherwise it is left unapplied and written to the run's report for the user. No scribe-output/<concept>.enriched.json entry may be orphaned (that file is gitignored and unrecoverable).

4. Scribe subagent path (skill): rewrite code-graph:scribe where it says to expect the proposal step to end the turn; add a clear rule that at the end of a task, when skills status shows concepts behind HEAD, the agent runs the update for the concepts the task touched only; give the large-diff step of update-concept-skills a fallback when no Agent tool is available (do it inline, scoped), as enrichment already has (up to 20 targets).

5. One run at a time: a scribe run and the hook trigger (SubagentStop fires when scribe finishes) share the lock and the minimum interval, so the same work is not done twice.

Known limit, to state in the skill: Haiku's quality on a concept-list reconcile is unmeasured; scoping scribe to the touched concepts keeps runs small and the Stop hook trigger catches the rest. Includes rebuilding the committed plugin bundle and bumping the version in the three version files.

## Acceptance criteria

- [ ] With concepts behind HEAD, the Stop hook starts one unattended update run; within the minimum interval, or while the lock is held, it starts none; tests cover both
- [ ] An unattended run applies revisions, additions and removals without asking and leaves the changes uncommitted
- [ ] A rename with exactly one unambiguous candidate is applied; an ambiguous one is not applied and appears in the run's report; tests cover both
- [ ] No enriched-file entry is orphaned by an automatic add, remove or rename
- [ ] Installation and the first concept list still ask the user
- [ ] Run as a subagent without AskUserQuestion or Agent tool, update-concept-skills completes for the touched concepts with no relay to the main session
- [ ] code-graph:scribe no longer says the proposal step ends the turn, and tells the agent when to run the update and for which concepts
- [ ] A scribe run followed by the SubagentStop hook does not start a second update for the same work
- [ ] Version bumped in the three version files together; pnpm build, pnpm check and pnpm test are green, plugin/scripts/code-graph.cjs regenerated, and just eval stays 7/7

## Touched surfaces

- packages/code-graph/src/scribe/skill-refresh.ts and its tests (hook trigger, lock, interval)
- packages/code-graph/src/cli.ts (refresh-skills options, if any)
- plugin/hooks/hooks.json
- plugin/skills/update-concept-skills/SKILL.md
- plugin/skills/scribe/SKILL.md
- plugin/scripts/code-graph.cjs (generated bundle)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version)
- parallel OK, merge order task 077 then this one; this one rebases, regenerates the bundle and bumps the version on top

## Blocked by

None — can start immediately

## Manager direction

- Round 1 (redirect):
  - An ambiguous rename does not block its concept. Ambiguous entries are kept as orphans and reported on every run.
  - The headless allowlist allows only the bundled CLI and read-only git.
  - Run the real claude -p path end to end once on a fixture.
- Round 2 (on-track):
  - Keep staging plus the runner install.
  - Limit the headless session's writes to the staging directory if the permission rules allow it; otherwise say so in the report.
  - An EPERM, EROFS or EACCES error in the runner ends the run INCOMPLETE, and the report names the refused path.
  - The report and docs/usage.md give the default model and the off switch (CODE_GRAPH_AUTO_UPDATE=0).

## Notes

## Post-Mortem

- **Problem:** Round 1 of @backend handed back with no tests and a design that blocked a whole concept on one ambiguous rename. The manager redirected; the ticket did not say whether "not applied" meant the rename or the concept.
  **Fix:** none
- **Problem:** The real headless `claude -p` path failed on its first two runs. The sandbox refused writes under `.claude/` in every permission mode, and the session could not read `CODE_GRAPH_UNATTENDED` under the allowlist, so it tried to claim its own lock. Simulated sessions had not caught either; only a user-run e2e did, after which the design changed to staging plus a runner install.
  **Fix:** none
- **Problem:** The e2e fixture and driver lived in `/tmp` and were lost on a reboot; they were rebuilt as `packages/code-graph/scripts/e2e-update-run.mjs`.
  **Fix:** none
- **Problem:** @test round 1 found two implementation defects: a read-only run dir crashed the runner, and an automatic add was always INCOMPLETE because the config was loaded before claude ran. @reviewer round 1 then failed the change on stale `--help` text and found a `git diff|log|show --output` write hole in the allowlist. The backend workflow has no test-defect edge, so the user had to route it.
  **Fix:** none
- **Problem:** The orchestrator's SubagentStop parser read `HANDOFF: success"` (a trailing JSON quote) as an unrouted label.
  **Fix:** none
- **Problem:** @scribe could not widen the pin test (test files are outside its role) or run the toolchain, so the orchestrator ran build/check/test/eval itself; the pin widening is left as a follow-up.
  **Fix:** none

## Notes (continued)

- **Open assumption carried forward:** a runner started by the real Stop/SubagentStop hook runs outside the Claude Code sandbox (hooks are not sandboxed; Bash tool calls are), so it can install and stamp files under `.claude/skills`. The e2e runs were started from a plain terminal, so they do not prove this. Read the first real hook-started run in a consumer as the confirmation. If the runner was sandboxed, that run ends INCOMPLETE and its report names the refused path.
