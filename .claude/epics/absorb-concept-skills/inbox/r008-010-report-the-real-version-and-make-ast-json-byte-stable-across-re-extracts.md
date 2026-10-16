# Report r008: 010-report-the-real-version-and-make-ast-json-byte-stable-across-re-extracts.md

- Task: 010-report-the-real-version-and-make-ast-json-byte-stable-across-re-extracts.md
- Written: 2026-10-16T19:25:41.314Z
- From session: code-graph-8f

Outcome: task 010 done, uncommitted in main checkout. Clean session, no loop-backs.
- Versions aligned to 0.3.3 (package.json, plugin.json, marketplace.json); check-versions.mjs runs in pnpm check and at bundle start. --version and extractor_version now 0.3.3.
- ast.json byte-stable: no per-vertex/edge extracted_at in file; apply stamps store; meta.extracted_at only advances on content change (freshness.ts unchanged). No SCHEMA_VERSION change.
- Tests: ast-stability.test.ts (9 new). pnpm test 265 pass, check green, just eval 7/7. Bundle regenerated.
Findings: existing committed .ast.json files get rewritten once on first re-extract; each version bump rewrites extractor_version once. scribe-pipeline doc vertex is stale until extract+apply is run.
Suggested tickets: none; consider publishing 0.3.3 and re-extracting consumer graphs.
