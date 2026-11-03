# Keep enrich targets lazy after the first touch and give it a summary form

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro's end-to-end check of 0.3.11 passed, but laziness only holds on a concept's first touch. In `enrichTargets` (scribe/enrich.ts:132), a vertex with no purpose gets the reason `new`, and only `--core` filters out non-core ones. Once the core is enriched, the update flows switch to plain `enrich targets` (update-concept-skills L148-150, scribe SKILL.md L141). That lists every never-enriched vertex in the concept as new: about 246 on maestro's task-queue (274 vertices, core 28). The next update run would fan out the whole concept, which the incremental design (013/014/016) exists to avoid.

**1. Lazy by default.** A never-enriched vertex is a target only when at least one of these holds:
- it's in the core (`coreVertices`, scribe/core.ts);
- it's new in code or its body changed since the previous apply, meaning a task touched it;
- it's named with `--vertex`.

A never-enriched, unchanged, non-core vertex is never a target. Count those as `leftOut`, in text and JSON, every time (not only with --core). Changed and stale enriched vertices stay targets as today.

Check how "new or changed since the previous apply" can be seen for a never-enriched vertex after the flows' `extract` → `apply` → `enrich targets` sequence. apply updates the store's contentHash, so `db.contentHash !== v.contentHash` is false by then. Options: the store's stale flag, a first-applied stamp, or the flow passing `apply --dry-run --json`'s new/changed names with `--vertex`. Pick one and test it on exactly that sequence.

Add `--all` for the old behaviour (every never-enriched vertex), which the whole-concept path uses. Keep `--core` accepted. It becomes the default, so 0.3.10's skills keep working; make it a documented no-op or alias.

**2. A summary form.** `enrich targets <c> --json` was 29 KB for task-queue (pretty-printed, and every target carries its `edgesWithoutReason` array), too big for the scribe subagent to read inline. So it skipped reading `core.size`/`thin`. Add `--summary`, in text and with --json. It gives counts per reason, the `core` block (size, leftOut, thin, message), the total of edges without a reason, and one short line per target (key, name, type, filepath:start-end, reasons, core). No edge arrays. Full details stay available per batch with `enrich targets <c> --json --vertex <k>...`, which is what a Haiku batch or an inline enricher reads. Plain text should also show each target's count of edges without a reason, since it currently omits them.

**3. Ride-along: inbound edge labels in plain-text search.** `formatSearch` (query/search.ts:413) prints every inbound edge as "← triggered by `X`", whatever its type. Outbound edges show their type (L419). maestro read "← triggered by readAllAvatars" on a `calls` edge as the `triggers` edge type. Label inbound edges by their type ("← called by", "← mounted by", "← triggered by" only for `triggers`, and so on for the other types) and update search.test.ts:174. Check the code-graph-search skill and the eval tasks for the old wording.

Docs-only and no-tsconfig paths are unchanged. Update docs/usage.md and packages/code-graph/CLAUDE.md (the core/enrich bullets). Version 0.3.12 in all three files, bundle regenerated.

## Acceptance criteria

- [ ] After the core is enriched, plain `enrich targets` lists no never-enriched, unchanged, non-core vertex, and reports them as leftOut
- [ ] A vertex added or edited by a task is a target after the flows' extract -> apply -> enrich targets sequence, even if it's non-core and never enriched; a test covers exactly that sequence
- [ ] `--all` restores the old every-never-enriched listing; `--core` is still accepted
- [ ] `--summary` (text and --json) gives per-reason counts, the core block, the edges-without-reason total and one short line per target, with no edge arrays; it's a few KB on a concept the size of task-queue (test with a fixture of 200+ vertices)
- [ ] `--json --vertex <k>...` returns full details for just those vertices
- [ ] Plain-text search labels each inbound edge by its type ("← called by" for calls); --json is unchanged
- [ ] Docs updated; pnpm check, pnpm test and just eval (7/7) are green; the version is 0.3.12 in all three files and the bundle is regenerated

## Blocked by

None — can start immediately
