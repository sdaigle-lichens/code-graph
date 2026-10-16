# Report r011: 013-let-enrichment-merge-per-vertex-and-go-stale-on-body-edits.md

- Task: 013-let-enrichment-merge-per-vertex-and-go-stale-on-body-edits.md
- Written: 2026-10-16T23:19:42.703Z
- From session: code-graph-16

Outcome: task 013 done, uncommitted in the main checkout. Added `code-graph enrich targets` and `enrich merge` (chosen over apply --merge), hash_seen staleness (legacy sig_seen-only entries keep the signature rule), gaps excluding stale purposes, docs, version 0.3.6 in all three files, bundle regenerated. pnpm test 285/285, pnpm check green, just eval 7/7.

Findings: a new vertex with a mismatched hash_seen starts stale (new behaviour). apply.ts imports enrichmentIsCurrent from enrich.ts (harmless, no import-time side effects).

Post-mortem: clean session. The scribe returned no HANDOFF line; treated as complete since it was the last step with no defects.

Suggested ticket changes: task 014 must update plugin/skills/scribe/SKILL.md to use `enrich targets` and `enrich merge` and stop hand-stamping sig_seen.
