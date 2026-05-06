# Phase 8 Troubleshooting Log

## What was completed

| Task | Status | Notes |
|------|--------|-------|
| `scribe.config.json` updated | ✓ | Added 5 new globs (gantt hook, 5 route files) |
| `.gitignore` → `scribe-output/*.drift.json` | ✓ | |
| `src/eval/harness.ts` + `code-graph eval` CLI | ✓ | Dynamic import in cli.ts |
| `eval/tasks.json` (5 fixtures) | ✓ | Task 4 has `skip_until_concept: "gantt-render"` |
| `README.md` (full) | ✓ | |
| `package.json` (repository, homepage, keywords, files) | ✓ | Added `eval/tasks.json` to `files` |
| `code-graph bootstrap` | ✓ | DB already existed, idempotent |
| `code-graph extract workorder-store` | ✓ | 35 vertices, 57 edges, skill 6586 chars |
| Enrichment agent (`/scribe-enrich` equivalent) | ✓ | 35 vertices enriched, 8 with cross_concept_refs |
| `code-graph apply workorder-store` | ✓ | 16 inserted, 19 updated, 2 archived, 4 agent edges |
| `SearchNoResultsError` refactor | ✓ | `search()` now throws instead of `process.exit(6)`; built |

## Where we stopped

Running `code-graph eval` from `lichens-ordonnancement-ui/`. First task (`"add delete variant to workorder operation"`) returns exit 6 — zero BM25 seeds.

```
running eval from /Users/samueldaigle/Documents/gits/code-graph/eval/tasks.json
  task-1-add-delete-variant ... no matches; try rephrasing or fall back to Explore
Exit code 6
```

Note: before the `SearchNoResultsError` refactor, this exited the whole process immediately. After the refactor + rebuild, the harness should catch the error — but the eval was not re-run after the rebuild, so the catch behavior is unconfirmed.

Direct search `code-graph search "workorder"` WORKS and returns results. So the view has data.

The failing query is `"add delete variant to workorder operation"` — multi-word natural-language phrase with no concept name.

## Problem

**ArangoSearch view may not be indexing `purpose`/`tags` fields from the enrichment.**

Hypothesis: the `code_search_view` was bootstrapped before enrichment ran. The view links `vertices(purpose, name, tags)` and `docs(body_md)`. The `purpose` and `tags` fields were `null`/`[]` on the first insert (extract only sets structural fields). Enrichment was applied later via `code-graph apply`, which updated those fields. ArangoSearch views should re-index on document update — but may need a moment.

The query `"workorder"` hits on `name == "workorder"` (exact match, boost 3) so it works. The phrase query `"add delete variant to workorder operation"` only has a chance via `purpose`/`tags` full-text. If those aren't indexed yet, 0 results.

## What to verify

1. **Run this AQL directly in ArangoDB web UI (`http://localhost:8529`)** on DB `lichens-ordonnancement-ui`:

```aql
FOR d IN code_search_view
  SEARCH ANALYZER(PHRASE(d.purpose, "workorder", "text_en"), "text_en")
  LIMIT 5
  RETURN { name: d.name, purpose: d.purpose }
```

If 0 rows → view not indexing `purpose`.

2. **Check view definition** — confirm `purpose` and `tags` are in the linked fields. In the web UI shell:

```js
db._view("code_search_view").properties()
```

3. **Check bootstrap.ts** — confirm the view definition includes `purpose` and `tags` fields in the `vertices` link. If not, the view definition is the bug.

4. **Re-bootstrap if view definition is wrong** — `code-graph bootstrap` from consumer dir. Check if it drops+recreates the view or only creates if missing.

5. **After fix, re-run eval** — `code-graph eval` from `lichens-ordonnancement-ui/`. Expected: 4/5 pass (task 4 skipped).

## Files changed this session

- `src/query/search.ts` — added `SearchNoResultsError` class, changed `process.exit(6)` to `throw`
- `src/eval/harness.ts` — new file
- `src/cli.ts` — added `eval` command, wired `SearchNoResultsError` catch (exit 6)
- `eval/tasks.json` — new file (5 fixtures)
- `README.md` — rewritten (full)
- `package.json` — description, repository, homepage, keywords, files updated
- `lichens-ordonnancement-ui/scribe.config.json` — updated globs
- `lichens-ordonnancement-ui/.gitignore` — added scribe drift entry
- `lichens-ordonnancement-ui/scribe-output/workorder-store.enriched.json` — written by enrichment agent
