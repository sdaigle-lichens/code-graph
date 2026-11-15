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
