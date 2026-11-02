# Report r051: 060-stop-orphaned-enriched-entries-from-warning-forever-remap-prune-or-report-them-once.md

- Task: 060-stop-orphaned-enriched-entries-from-warning-forever-remap-prune-or-report-them-once.md
- Written: 2026-11-02T01:25:59.321Z
- From session: absorb-concept-skills-060

# Report: ticket 060 (orphaned enriched entries)

## Outcome
Done. Commit 8788aab on feat/integrate-concept-skills (base 73db5ec, v0.3.35, no version bump).

## Verified on 8788aab
- `pnpm check`: 6/6 tasks successful (turbo cache hit on the committed tree).
- `pnpm test`: 687 tests, 687 pass, 0 fail (turbo cache hit on the committed tree).
- `just eval`: green 7/7, 0 skipped, un-enriched stripped store.
- `just eval-as-is` (informational): 5/7, tasks 2 and 6 fail. Unchanged from before, awaiting 061.
- The tree has only `pnpm-lock.yaml` modified (pre-existing, left out of the commit).

## Reproduction
Before any change, `apply scribe-pipeline --dry-run` printed `warning: enriched vertex "c8e3ece74edc328ce6f50721df4f86fb" not in ast.json — skipping`.

## Design
- Remap happens in `apply` (enrich.ts `planOrphans`/`planOrphansInStore`, called from apply.ts), persisted to .enriched.json except under `--dry-run`.
- Identity: the orphan's store record (live or archived, by `_key`), accepted only if it belongs to the same concept. Candidate = a vertex of the same type without an entry, matched by exact name in any file, narrowed by contentHash if several share the name; no name match falls back to type plus contentHash. Anything ambiguous (several candidates, or two orphans wanting one vertex) or unmatched (no candidate, or a key the store never saw) is left in the file and only reported.
- Reporting: one stderr `note:` line per concept. `apply --dry-run --json` adds an `orphans` object only when above 0. `enrich targets` mentions orphans (extra JSON key only when above 0). `gaps` does not (it reads the store).
- Deletion: only `code-graph enrich prune <concept> [--yes] [--json]`, dry run by default, never drops a remappable entry. `apply` never deletes.
- No change to the .enriched.json format or exit codes.

## Rename-rule comparison (manager condition 2)
Not the same rule, on purpose. Drift rename (apply.ts ~335-365) pairs a missing DB vertex with a new AST vertex only in the same file and type with Levenshtein similarity >= 0.8, and needs approval (`--approve-drift`, prompt, or `--defer-renames`). The orphan remap (enrich.ts `planOrphans` ~541-574, run from apply.ts ~265-276) handles cross-file moves with exact name, then contentHash, and needs no approval because it only moves an enrichment entry's key. It runs before drift, so remapped entries arrive at drift with their purpose. The only overlap, a same-file rename picked up by the contentHash fallback, lands the entry on the new key in both rules.

## Real cleanup
The orphan was unmatched: the old local `fail` in apply.ts no longer exists and the store has no record of that key. Backup: /tmp/claude-1000/scribe-pipeline.enriched.json.bak (fragile). Pruned with `enrich prune scribe-pipeline` (dry run, then `--yes`); the dry-run apply is quiet. The purpose text ("prints lines to stderr and throws ReportedError") probably belongs to `reportAndThrow` (added in 058, not yet in scribe-pipeline.ast.json). Re-enrich it through the normal `enrich targets` / `enrich merge` path after the next extract, not by hand. Not re-added in this ticket.

## Findings and deviations
- With `--defer-renames` (exit 10) the remap is persisted before the "nothing was written" message, which is true only of the store. Documented in docs/usage.md and the scribe-pipeline skill; no code change.
- The contentHash fallback is covered by unit tests only, not through the CLI.
- I edited `.claude/skills/scribe-pipeline/SKILL.md` (file map and the defer-renames invariant). I did not run extract + apply on scribe-pipeline, so it still needs one, which also picks up `reportAndThrow`.
- No CHANGELOG.md exists, so no entry.
- Bundle regenerated with `pnpm build`; the merger bumps to 0.3.36 and re-runs `pnpm bundle`.
- Reviewer: no blockers. Tests added: orphans.test.ts, 16 cases (remap, ambiguous, unmatched, prune, dry run, cross-concept, two orphans one vertex, defer-renames).

## Post-mortem
Clean run, no loop-backs.

## Suggested ticket changes
- 061 rebases on 8788aab.
- Consider a follow-up to make the `--defer-renames` message say the enriched file was updated.
