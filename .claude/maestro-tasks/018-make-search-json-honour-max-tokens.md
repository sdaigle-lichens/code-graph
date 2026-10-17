# Make search --json honour --max-tokens

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`code-graph search --json` ignores `--max-tokens`: cli.ts:257-262 prints the whole result plus the gap report, skipping `applyTokenBudget`. maestro got 459 KB back for the query "design check". The comment there calls JSON mode the eval harness's contract, but the harness calls `search()` directly (eval/harness.ts:52), so trimming at the CLI doesn't affect eval.

Trim the JSON to the budget in the same order of priority as the plain-text budget (the lowest-ranked hits and their edges first, then long fields such as skill bodies). Keep it valid JSON with the same shape, add `truncated: true` plus the counts of what was dropped when it trims, and always keep `strength` and `gaps`. With no explicit `--max-tokens`, apply the same 3000 default the plain-text output uses. Fix the stale comment. Check the other `--json` query commands (concept, impact, cross, vertex, file) for the same bypass; fix those that share it, or list them in the report. Version 0.3.11 in all three files, bundle regenerated.

## Acceptance criteria

- [ ] search --json output stays within --max-tokens (3000 by default), remains valid JSON in the same shape, and says it was truncated with the dropped counts
- [ ] strength and gaps are always present; the eval harness is unaffected and just eval is 7/7
- [ ] The other --json query commands are checked for the same bypass and either fixed or listed in the report
- [ ] A test covers a result over budget; pnpm check and pnpm test are green; the version is 0.3.11 in all three files and the bundle is regenerated

## Blocked by

- `017-let-a-subagent-scribe-enrich-small-target-sets-inline-and-use-core-first-on-first-touch.md`
