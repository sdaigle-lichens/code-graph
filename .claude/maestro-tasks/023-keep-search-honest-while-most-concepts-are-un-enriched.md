# Keep search honest while most concepts are un-enriched

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's merge review (R1 and the code-graph half of R9;
`~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`). The user has decided that lazy
enrichment is the intended steady state, so this is structural, not a transition problem: most
concepts in a consumer stay un-enriched for a long time.

Measured on maestro (`~/gits/maestro`, 16 concepts, 2 enriched: task-queue 28/103, agents-view 18/66):
- The 8-task eval (`.claude/epics/absorb-concept-skills/maestro-eval-tasks.json`, copied from the
  reviewer) passes **2/8**. `ma-gap-ack` misses `parseGapsHandled` although the vertex exists;
  `av-description` puts `setAgentDescription` at rank 15.
- 8 of 13 plain-language queries return agents-view or task-queue noise **with exit 0**.
- Exact identifiers work (`checkRoute`).
- `code-graph-retrieval` tells agents to treat results as authoritative and not to grep, so the
  confident wrong answer is what an agent acts on.

Verified in code, and a correction to the review: SKILL.md text *is* indexed. `search_fts` covers
`vertices(name, purpose, tags)` and `docs(body_md)` in one table (`scribe/bootstrap.ts`,
`FTS_WEIGHTS = { name: 3, purpose: 2, tags: 1.5, body_md: 1 }`), and `query/search.ts` already has a
"matched only through skill docs" path. So the cause is not "docs not searched". It is likely
ranking or expansion: enriched purposes outscore names and doc bodies, and a doc hit may not pull its
concept's named vertices into the top k. **Diagnose first** (per-task: what the BM25 seeds are, where
the expected vertex ranks and why) and write the cause into the report before changing weights.

**1. Ranking.** Fix what the diagnosis finds, without enriching anything in maestro. Possible levers
(not prescriptive): weight `name` tokens against camelCase-split identifiers; let a doc hit seed the
vertices its SKILL.md names (the concept's core, `scribe/core.ts`); normalise per-concept so two
enriched concepts can't crowd out the rest.

**2. Say when it's unsure.** When the top cluster scores below a threshold, or its concept is
un-enriched (or mostly), `search` says so:
- text: one line naming the reason and the fallback (grep, or read the concept's SKILL.md);
- JSON: `low_confidence: true` plus the reason;
- a documented non-zero exit code (a new code, not the retired 2; add it to the table in
  `docs/usage.md` and the retrieval skill). Results are still printed.

Keep the threshold a named constant and test both sides of it.

**3. Retrieval skill.** `plugin/skills/code-graph-retrieval/SKILL.md`:
- on the low-confidence exit, name grep or the concept's SKILL.md as the fallback; the "don't grep"
  rule applies only to confident results;
- R9: line ~97 says a whole-concept re-enrich "spins up the enrichment subagent". A subagent can't
  spawn agents. Say to report the need through the gap channel or hand off to the scribe.

Version 0.3.16 in all three files, bundle regenerated. Update the `code-graph-search` skill
(`.claude/skills/code-graph-search/SKILL.md`, ask the user if the write is blocked) and the search notes
in `packages/code-graph/CLAUDE.md`.

## Acceptance criteria

- [ ] The report states the diagnosed cause per failing task, before and after
- [ ] On maestro with its current 2/16 enrichment, the 8-task eval passes at least 6/8 (run code-graph's eval with that tasks file against `~/gits/maestro`; never commit there)
- [ ] Below the threshold or on an un-enriched top concept, `search` prints the fallback line, sets `low_confidence` in JSON and exits with a new documented code; tests cover both sides of the threshold
- [ ] `code-graph-retrieval` names the fallback for that exit and no longer says the skill spins up a subagent
- [ ] `just eval` stays 7/7; claude plugin validate, pnpm check and pnpm test are green; version 0.3.16 in all three files, bundle regenerated
