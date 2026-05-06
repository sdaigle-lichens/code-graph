# Phase 8 — Eval results

## Layer A (programmatic, deterministic)

`code-graph eval` from `lichens-ordonnancement-ui/`:

| Task | Mode | Result |
|------|------|--------|
| task-1-add-delete-variant | search | ✓ |
| task-2-reindex-whole-array | search | ✓ |
| task-3-week-window-sunday | search | ✓ |
| task-4-gantt-rerender | cross | ⊘ skipped (awaits `gantt-render` concept) |
| task-5-stale-ops-week-nav | search | ✓ |

**4/4 passed, 1 skipped** — green baseline established.

Latest run: `lichens-ordonnancement-ui/eval/results-2026-05-05T*.json`.

## Layer B (Claude-session A/B) — pending user execution

For each of the 5 tasks: spawn cold Claude Code session, run prompt twice (search via `/graph` vs stock Explore agent), score:

- (a) files Read before first edit
- (b) tokens consumed
- (c) edit correctness

| # | Prompt | Search wins | Notes |
|---|--------|-------------|-------|
| 1 | Add `operation: "delete"` variant to WorkorderOperation | _todo_ |  |
| 2 | Why does setWorkorderIndex re-index the whole array? | _todo_ |  |
| 3 | Change week window to include Sunday 00h | _todo_ |  |
| 4 | Gantt doesn't re-render on workorder drag | _deferred_ | needs 2nd concept |
| 5 | Sync sends stale ops after week nav | _todo_ |  |

## Gate

- 4/5 wins → onboard concept #2 (shift-logic).
- 2–3/5 → iterate output format / BM25 boosts.
- 0–1/5 → rethink scribe quality or add embeddings.

**Pending Layer B execution by user.**
