# Report r021: 023-keep-search-honest-while-most-concepts-are-un-enriched.md

- Task: 023-keep-search-honest-while-most-concepts-are-un-enriched.md
- Written: 2026-10-21T12:40:03.398Z
- From session: maestro-5b4ae740

# Task 023 report: keep search honest while most concepts are un-enriched

Outcome: done. Version 0.3.16, bundle regenerated. 364/364 tests, `pnpm check` green, `just eval` 7/7. Nothing committed. Reviewer verdict: PASS.

## Diagnosis (maestro, 16 concepts, 2 enriched)
Root cause: SKILL.md text is indexed (the task's correction holds). The failure is how un-enriched vertices are indexed. `unicode61` does not split camelCase, so `parseGapsHandled` is the single FTS token `parsegapshandled` and plain-language queries cannot reach it. Enriched vertices also match through long `purpose` text and crowd the 10 seeds. Once any vertex seed exists, `expandDoc` stops loading concept vertices (the intended `docLoadsVertices` guard), so a doc hit never rescues the concept.

| Task | Before | After |
|---|---|---|
| av-description | `setAgentDescription` at rank 15 (agents-view purposes outscore it) | pass |
| afs-fork | concept and `forkAgent` missing | pass |
| ma-gap-ack | `parseGapsHandled` missing (only two weak doc seeds) | pass |
| ma-handoff-route | `checkRoute` missing | pass |
| im-install | concept and `installRuntime` missing | pass |
| ma-design-check | `seedSkillsFor` missing | still fails: no name, doc or SKILL.md text ties "design check" to it |

Eval on maestro: 2/8 before, 7/8 after (criterion: at least 6/8). This was run by @backend only; the reviewer could not re-run it (tasks file not at the path it looked in).

## Changes
- `nameIndexText` / `splitIdentifier` (`scribe/rows.ts`): the FTS `name` column is the identifier plus its words. `rebuildSearchIndex` builds rows in JS. `toMatchExpr` also offers the words of SCREAMING_SNAKE tokens. `FTS_WEIGHTS` unchanged. No doc-hit seeding or per-concept normalisation, as the diagnosis did not need them.
- Low confidence: `assessConfidence` in `query/search.ts`, constants `LOW_CONFIDENCE_MIN_SCORE = 4` and `LOW_CONFIDENCE_MIN_ENRICHED = 0.5`. Text fallback line, JSON `low_confidence` + `low_confidence_reason`, new exit code 7. Exempt: exact symbol-name hits and docs-only concepts (added by backend; not in the task).
- Docs: `docs/usage.md`, `code-graph-retrieval` (exit 7 row, "don't grep" limited to exit 0, R9 subagent wording replaced with gap channel / scribe handoff), `code-graph-search` skill, `packages/code-graph/CLAUDE.md`.
- Tests: `confidence.test.ts`, `search-exit.test.ts`, additions to `rows.test.ts`; two stale tests updated.

## Notes for the manager
- Indexes built before 0.3.16 need `code-graph reindex`. Backend reindexed maestro (gitignored `graph.db`) and this repo.
- `claude plugin validate` was not run: `claude` is not on PATH in the sandbox. The user must run it.
- `ma-design-check` will stay failing without enrichment or a data keyword. Consider a ticket if 8/8 matters.
