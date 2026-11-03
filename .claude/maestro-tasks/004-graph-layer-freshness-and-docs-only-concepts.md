# Graph-layer freshness and docs-only concepts

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make the graph layer coherent with concept skills and machine-readable for the scribe. `tsconfig` becomes optional in `scribe.config.json`. A concept's `skill` path defaults to the marker-discovered SKILL.md whose dir/name equals the concept key, then `skillsDir/<concept>/SKILL.md` (this fixes extract ignoring `skillsDir`). Docs-only concepts: `extract` on a concept with no tsconfig or only non-TS globs emits a zero-vertex ast.json with the skill block, and `apply` writes the doc row so the SKILL.md is BM25-searchable. Add `drift --json` and `apply --dry-run --json` emitting `{ concept, new[], changed[], stale[], missing[], renameCandidates[], doc: { bodyHashChanged } }` with vertex names and files, not counts. `skills status --json` gains graph freshness per concept (changed/stale vertex counts, extracted/enriched) when a store exists, keeping git-only output without one; docs-only concepts keep the git-diff fallback. No SCHEMA_VERSION bump unless the DB shape changes. Also harden two gaps left by the layer-1 work: `skills status` passes a SKILL.md's stored `last-update` sha straight into a git range — validate it (unknown or malformed sha reports the concept as 'unknown freshness' instead of failing), and add a stamping test for a SKILL.md with mixed LF/CRLF line endings.

## Acceptance criteria

- [ ] A config without `tsconfig` loads, and a concept with no explicit `skill` resolves its SKILL.md by marker, then by `skillsDir`
- [ ] Extract + apply on a docs-only concept produces a doc row that `code-graph search` returns
- [ ] `drift --json` and `apply --dry-run --json` emit the documented shape; editing a file inside a concept's globs shows up in `changed`
- [ ] `skills status --json` includes graph freshness when the store exists and still works without one
- [ ] `skills status` tolerates a missing/unknown `last-update` sha, and mixed LF/CRLF stamping is covered by a test
- [ ] A new Layer-A eval task for the docs-only case; `just eval` green (5/5 plus the new task)

## Blocked by

- `003-concept-skills-layer-1-in-the-code-graph-cli-shipped-as-a-bundled-plugin-script.md`

## Post-Mortem

- **Problem:** `isDocsOnly` classified extension-less globs (`src/**`) as docs-only even with a tsconfig, silently disabling extraction. @test worked around it by editing a fixture; @reviewer caught it and failed the review.
  **Fix:** none
- **Problem:** `pnpm check` failed on prettier in `skills/commands.ts`, which @backend didn't catch before handing off.
  **Fix:** none
- **Problem:** @backend ended `HANDOFF: success` twice without writing the channel payload for @test; it had to be resumed to write it.
  **Fix:** none
