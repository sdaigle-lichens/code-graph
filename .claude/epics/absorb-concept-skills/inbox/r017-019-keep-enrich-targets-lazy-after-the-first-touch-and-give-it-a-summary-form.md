# Report r017: 019-keep-enrich-targets-lazy-after-the-first-touch-and-give-it-a-summary-form.md

- Task: 019-keep-enrich-targets-lazy-after-the-first-touch-and-give-it-a-summary-form.md
- Written: 2026-10-19T02:21:13.375Z

## 019 — lazy enrich targets + summary form (0.3.12): done

**Outcome:** all acceptance criteria met. Tests 320/320 (`pnpm --filter code-graph test`), typecheck clean, `pnpm check` 6/6, `just eval` 7/7. Versions are 0.3.12 in all three files and the bundle is regenerated and verified against the source. Nothing committed.

**Findings**
- "Changed since previous apply" mechanism: `apply` stamps `agent.touched_at` on a purpose-less vertex that is new or has a changed body, but only once the concept already has live vertices in the store, so first touch stays core-only. `enrich targets` also treats as touched a vertex missing from an applied store, a hash mismatch, or a purpose-less `agent.stale` (the upgrade path for 0.3.11 stores).
- `--all` gives the old listing, and `--core` is a documented no-op. `--summary` (text and compact --json) is about 3 KB on a 220-vertex fixture.
- Behaviour change: `--vertex` now narrows the output to the named vertices with full details. Before, it added them to the list. All three plugin skills were updated for this.
- Plain-text search labels inbound edges by type ("← called by", etc.); --json is unchanged.
- Docs (usage.md, packages/code-graph/CLAUDE.md) and the code-graph-search and scribe-pipeline skills were updated.

**Open items / suggested tickets**
- An approved rename (`apply.ts` ~434-456, `--approve-drift`) of a never-enriched vertex is not stamped `touched_at`, so a renamed non-core vertex isn't a target. One-line fix: stamp when `conceptWasApplied && !merged.purpose`. The flows use plain `apply`, so this doesn't happen in them today.
- `just regraph` (or extract + apply for code-graph-search and scribe-pipeline) is still needed: ts-morph isn't loadable in the sandbox, so the stored skill-doc vertices hold the old text.
- Minor: enrich.test.ts:353-355 doesn't assert the merge/apply exit codes.
- Root turbo `pnpm test` fails in the sandbox (`ENOENT mkdir /tmp/tsx-1000`). This is environmental.
