# Stop plain-text search from repeating the same edge per call site

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro verified code-graph 0.3.3 and found one non-blocking issue. Plain-text `code-graph search "blockedBy cascade"` lists the same edge several times under one vertex. Under `isValidSessionId`, "← triggered by `sweepStaleSessions` at apps/maestro/src/core/session-sweep.ts:108" appears 3 times, and the same goes for `resolveSessionPaths` :175. The output reports about 14.7k tokens.

Cause, from reading the code: edges are deduplicated per call site (`eKey = sha1(from|to|type|line)`), so a caller that calls a function three times stores three edges. `formatSearch` in `packages/code-graph/src/query/search.ts` prints each incoming edge with the caller's `start_line` (`f.start_line`), not the call-site line, so the three lines are identical. Outgoing edges (`→ type name (concept)`) and cross-concept lines likely repeat the same way.

Fix the plain-text output: group the edges between the same two vertices with the same type into one line. Show the call-site line(s) when the edge carries one (e.g. `at file:108 (lines 112, 140, 155)` or `×3`), falling back to the caller's start line. Keep edge reasons; if grouped edges carry different reasons, show them all or say there are several. `--json` stays one entry per stored edge, because it's machine output and consumers may count call sites. Note the choice in docs/usage.md if it is user-visible.

Also check the token figure. The default `--max-tokens` is 3000, yet the totals line said ~14.7k. Find out whether the totals line reports the size before the budget is applied, or the budget isn't applied on this path. Make the totals line describe what is actually printed.

Add a unit test with a caller that calls the same function several times. Keep the existing search tests and `just eval` green.

## Acceptance criteria

- [ ] In plain text, a caller that calls a vertex several times appears once under it, with its call-site line(s) or a count
- [ ] Outgoing and cross-concept edge lines are deduplicated the same way
- [ ] --json still lists one entry per stored edge
- [ ] The plain-text totals line's token figure matches the printed output, and --max-tokens is honoured
- [ ] A unit test covers repeated call sites and fails on the old code
- [ ] pnpm test, pnpm check and just eval (7/7) are green; the bundle is regenerated

## Blocked by

None — can start immediately
