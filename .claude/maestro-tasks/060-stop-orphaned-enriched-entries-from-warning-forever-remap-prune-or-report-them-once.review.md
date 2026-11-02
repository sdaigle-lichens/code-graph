# Manager review brief: ticket 060 (round 1)

## Goal
Stop orphaned `.enriched.json` entries from warning forever: remap when unambiguous, report once, drop only on explicit request.

## Done
- Reproduced first: `apply scribe-pipeline --dry-run` printed `warning: enriched vertex "c8e3ece74edc328ce6f50721df4f86fb" not in ast.json — skipping`.
- `apply` remaps an orphan onto the single live vertex with the same type and name (else same type and contentHash); the purpose and other fields are kept. Under `--dry-run` nothing is written.
- `apply` prints one `note:` line per concept for ambiguous or unmatched entries, which stay in the file.
- New `code-graph enrich prune <concept> [--yes] [--json]`: dry run by default, writes only with `--yes`, never drops an entry `apply` could remap.
- `enrich targets` mentions orphans (extra `orphans` JSON key only when above 0). `gaps` does not (it reads the store, not the enriched file).
- The real orphan in scribe-pipeline.enriched.json was pruned with the new command; backup in /tmp/claude-1000/scribe-pipeline.enriched.json.bak. A dry-run `apply` afterwards prints no orphan line.
- Bundle regenerated with `pnpm build`.

## Deviations
- The real orphan was unmatched, not remapped: its target `fail` vertex no longer exists. Its purpose probably fits `reportAndThrow` (added in 058, not yet re-extracted), so it can be re-merged by hand after the next extract.
- No full extract or apply was run on scribe-pipeline.
- `just eval-as-is` was not run.

## Decisions
- Remap lives in `apply` (not `enrich merge` or a separate command).
- `.enriched.json` format and exit codes are unchanged. `enrich prune` is a new subcommand that exits 0.
- Orphan identity comes from the store's vertex record (live or archived, by `_key`).
- Ambiguity (several candidates, or two orphans wanting one vertex) leaves entries untouched.

## Touches
packages/code-graph: `src/scribe/enrich.ts`, `src/scribe/apply.ts`, `src/cli.ts`, new `src/scribe/orphans.test.ts` (12 tests). Docs: root CLAUDE.md, docs/usage.md, packages/code-graph/CLAUDE.md, .claude/skills/scribe-pipeline/SKILL.md. Generated: plugin/scripts/code-graph.cjs. Local: scribe-output/scribe-pipeline.enriched.json.

## Sibling impact
None known. The 061 eval work (partly enriched stores) is independent. The merger bumps the version to 0.3.36 and re-runs `pnpm bundle`.

## Verified
Nothing is committed yet. Verified on base 73db5ec plus the uncommitted working tree: `pnpm check` green, `pnpm test` 682/682, `just eval` 7/7. `pnpm check` and `just eval` ran before a late docs-only tweak to docs/usage.md; the last full test run came after it. I will re-run all three on the final state after the test and review steps.

## Questions
- Is remapping in `apply`, with an explicit `enrich prune` as the only deletion path, the right direction?
