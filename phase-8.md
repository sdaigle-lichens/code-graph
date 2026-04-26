# Phase 8 — Pilot, verification, eval, distribution prep

## Goal

Onboard the `workorder-store` concept inside `~/Documents/gits/lichens-ordonnancement-ui` end-to-end. Run all 16 verification steps. Run the 5-task eval against `/graph` (search) vs Explore agent. Apply the gate decision (4/5 wins → green-light onboarding the 2nd concept; 2–3/5 → iterate; 0–1/5 → rethink).

Also stand up README + npm publish prep so distribution is one command away when the user decides to publish.

## Context

### Consumer touchpoints (lichens-ordonnancement-ui)

```
scribe.config.json           # new
scribe-output/               # new dir, populated on extract
.gitignore                   # add scribe-output/*.drift.json
```

No `scripts/` dir, no `package.json` script changes, no consumer devDependencies.

### `scribe.config.json` for pilot

```json
{
  "project": "lichens-ordonnancement-ui",
  "tsconfig": "tsconfig.app.json",
  "skillsDir": ".claude/skills",
  "concepts": {
    "workorder-store": {
      "globs": [
        "src/store/workorder.store.ts",
        "src/utils/workorder-store.ts",
        "src/utils/workorder.ts",
        "src/commons/schedule-workorder.ts",
        "src/commons/workorder-operation.ts",
        "src/hooks/dnd-workorder/use-dnd-workorder-list.ts",
        "src/hooks/dnd-gantt/use-gantt-workorder-drag.ts",
        "src/routes/_authenticated/$siteid/scheduler/schedulers.tsx",
        "src/routes/_authenticated/$siteid/scheduler/sector-equipment.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-card.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-list-item.tsx",
        "src/routes/_authenticated/$siteid/scheduler/workorder-details.tsx"
      ],
      "skill": ".claude/skills/workorder-store/SKILL.md"
    }
  }
}
```

### Cross-concept callouts to expect from agent enrichment

`workorder-store` → `scheduler-store`, `shift-logic`, `schedule-utils` via:
- `transferWorkorderScheduleEntry`
- `setSchedulePeriod`
- `isWorkorderInSchedulePeriod`

### 16 Verification steps

1. **Binary on PATH** — `which code-graph` returns a path; `code-graph --version` succeeds.
2. **Plugin registered** — in Claude Code, `/graph --help` and `/scribe-enrich --help` resolve; `scribe-code-graph` skill listed.
3. **DB per project** — `code-graph status` reports DB name = `lichens-ordonnancement-ui`. `arangosh --server.database lichens-ordonnancement-ui --javascript.execute-string 'print(db._collections().map(c=>c.name()))'` lists `vertices, edges, docs, concepts`.
4. **Vertex count sanity** — `code-graph query concept workorder-store --json | jq '.vertices | length'` → 15–25.
5. **Cross-concept refs present** — at least one vertex has non-empty `cross_concept_refs` (e.g. `updateWorkOrderStartTime` → `scheduler-store`).
6. **Impact correct** — `code-graph query impact setWorkorderIndex --direction=in` returns `useDndWorkorderList`.
7. **Re-extract idempotence** — run `code-graph extract workorder-store` twice; `code-graph drift workorder-store` → "no changes".
8. **Drift detection** — rename a function in source, re-extract + apply → `renamed` candidate listed; reject → DB unchanged.
9. **Agent field persistence** — whitespace edit in body → `agent.stale = true` but `purpose` preserved verbatim.
10. **Skills-as-docs ingested** — `code-graph query concept workorder-store --json | jq '.docs | length'` → 1; `jq '.docs[0].body_md | length'` > 500.
11. **Doc-link edges present** — AQL `FOR e IN edges FILTER e.type == "documented-by" RETURN e` returns one edge per live vertex in concept.
12. **Search hybrid retrieval works** — `code-graph search "sync sends stale ops"` returns markdown with skill prose inline + `clearWorkorderOperations` + `mergeWorkordersByEquipment` in top results (no concept name in query — BM25 seeds it).
13. **Search multi-hop chaining** — same query output includes cross-concept callouts section (scheduler-store, shift-logic).
14. **Slash command integration** — fresh Claude Code session, `/graph sync stale ops` → routes to search, output parses, Claude Code `Read`s suggested files.
15. **Fallback** — `code-graph down`, invoke `/graph ...` → exit 2, Claude Code falls back to Explore.
16. **Per-project isolation** — create throwaway second project with minimal `scribe.config.json` (different `project`), `code-graph bootstrap` from that CWD → arangosh `db._databases()` shows both DBs; queries from either CWD never cross.

### Eval — 5 tasks (run only after all 16 verification steps pass)

For each task: cold Claude Code session, same seed/prompt, run twice — once with `/graph` (search), once with stock Explore agent. Score:
- (a) files Read before first edit
- (b) tokens consumed
- (c) edit correctness

| # | Prompt | Ideal retrieval | Expected winning mode |
|---|---|---|---|
| 1 | Add `operation: "delete"` variant to WorkorderOperation | workorder-operation.ts, utils upsert+merge, store, update hook | `search` |
| 2 | Why does setWorkorderIndex re-index the whole array? | util setWorkorderIndex, reorderWorkorderOperations, skill invariants | `search` or `impact setWorkorderIndex` |
| 3 | Change week window to include Sunday 00h | isWorkorderInSchedulePeriod, mergeWorkordersByEquipment caller, API query | `search` or `impact isWorkorderInSchedulePeriod` |
| 4 | Gantt doesn't re-render on workorder drag | store subscribers in gantt, setWorkorderIndex, gantt-workorder | `cross workorder-store gantt-render` (needs 2nd concept — defer) |
| 5 | Sync sends stale ops after week nav | clearWorkorderOperations, mergeWorkordersByEquipment ops-survive-nav, sync hook | `search` |

**Gate:**
- 4/5 wins → onboard 2nd concept (shift-logic). Out of scope for this phase — files a follow-up.
- 2–3/5 → iterate output format or BM25 boosts. Stay in this phase.
- 0–1/5 → rethink scribe quality or add embeddings. Re-open Phase 3 or schedule a Phase 9.

### Distribution prep

- README.md — full version (overview, install, usage, dev, troubleshooting).
- `package.json` — `repository`, `homepage`, `keywords`, `files: ["dist", "plugin", "package.json", "README.md"]`.
- `npm publish --dry-run` — verify package contents look right.
- Decide publish target: public npm vs private registry. Default: hold until eval gate passes.

## Tasks

1. Create `~/Documents/gits/lichens-ordonnancement-ui/scribe.config.json` per pilot config above.
2. Add `scribe-output/*.drift.json` to `~/Documents/gits/lichens-ordonnancement-ui/.gitignore`.
3. From consumer dir: `code-graph up && code-graph bootstrap` → DB created.
4. From consumer dir: `code-graph extract workorder-store` → `scribe-output/workorder-store.ast.json`.
5. In Claude Code from consumer dir: `/scribe-enrich workorder-store` → `scribe-output/workorder-store.enriched.json` written by subagent.
6. Spot-check enriched.json: every vertex has non-null `purpose`, at least 3 vertices have non-empty `cross_concept_refs` mentioning `scheduler-store`/`shift-logic`/`schedule-utils`.
7. From consumer dir: `code-graph apply workorder-store` → upsert. Drift report should show all `new`. Vertex count printed should match ast.json.
8. Run all 16 verification steps. Record pass/fail in `code-graph/eval/verification.md` (one line per step, ✓ or ✗ + note if failed).
9. Fix any verification regressions. May require revisiting earlier phase code (extract vertex-detection rules, search expansion rules, etc.). Iterate until 16/16.
10. Run 5 eval tasks. Record per-task scores in `code-graph/eval/eval-results.md`. Each task: 2 sessions (search vs Explore), 3 metrics (files Read, tokens, correctness), final winner.
11. Apply gate decision. Update `code-graph/eval/eval-results.md` with the decision + rationale.
12. Write full `code-graph/README.md`:
    - Overview
    - Install (`pnpm i -g code-graph` + `/plugin install code-graph`)
    - Quickstart (write `scribe.config.json`, bootstrap, extract, enrich, apply, search)
    - Reference (CLI subcommands)
    - Dev setup (link --global flow)
    - Troubleshooting (exit code table)
13. Update `code-graph/package.json` — `repository`, `homepage`, `keywords`, `files`. Bump version if needed.
14. `npm publish --dry-run` — review the tarball contents. Confirm `dist/`, `plugin/`, `README.md`, `package.json` included; nothing else.
15. (Hold publish until user explicitly approves and gate is green.)

## Done when

- All 16 verification steps pass (16/16).
- Eval gate decision recorded in `eval-results.md`.
- `npm publish --dry-run` clean.
- README.md complete.
- If gate is 4/5+ → user can decide to publish or onboard concept #2 in a follow-up phase.

## Out of scope (file as follow-ups)

- 2nd concept onboarding (`shift-logic`). Triggered by gate.
- Embedding-based ranking. Triggered if BM25 precision is insufficient.
- LangChain / agentic search wrapper. Triggered post-pilot if deterministic retrieval falls short.
- MCP server. Phase 2 if the value prop holds.
- Git hooks / CI auto-scribe.
- `code-graph gc` for hard-delete of archived vertices.
