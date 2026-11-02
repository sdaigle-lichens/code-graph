# Stop orphaned enriched entries from warning forever: remap, prune or report them once

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`apply` drops an enriched vertex whose _key is not in the concept's ast.json with a stderr warning ("enriched vertex ... not in ast.json - skipping") and never touches the .enriched.json, so the same warning repeats on every apply and the orphan is never fixed. It showed up twice in this epic (58 and 56 reports): scribe-pipeline.enriched.json holds vertex c8e3ece74edc328ce6f50721df4f86fb that no longer exists. Vertex keys include the filepath, so a moved or renamed file orphans its entries; enrichment is expensive to regenerate, so nothing may be deleted silently. Decide first, and record the decision in the report: for an orphan, try to remap it onto a live vertex of the same concept when the match is unambiguous (same name and type in a different file, or the same contentHash), report what could not be remapped once per apply as a single summary line instead of one warning per entry, and offer an explicit way to drop the leftovers (for example an `enrich prune <concept>` command with a dry-run default, or a flag), never an automatic delete. Also settle where the remap happens (apply, enrich merge, or a separate command) and whether `enrich targets` and `gaps` should mention orphans. Include the messages in source code, tests for remap, ambiguous match, no match and prune, and the docs that name the problem: the root CLAUDE.md working rule that says moving files orphans entries ("remap or re-enrich"), docs/usage.md, the package CLAUDE.md, and the scribe-pipeline and scribe skills if their text tells agents what to do. Finally clean the real orphan in scribe-pipeline.enriched.json with the new mechanism as the first use, and regenerate the plugin bundle with `pnpm bundle`. Whoever merges bumps the version.

## Acceptance criteria

- [ ] The report states the chosen design (what is remapped, what is only reported, how an orphan is dropped) and why, and shows the c8e3ece74edc328ce6f50721df4f86fb warning reproduced first
- [ ] A re-extract after a file move remaps an unambiguously matching enriched entry onto its new vertex key without losing its purpose, and an ambiguous or unmatched entry is left in place and reported
- [ ] `apply` prints at most one summary line for orphans per concept, and nothing is deleted from .enriched.json unless the user runs the explicit prune
- [ ] The prune path has a dry-run by default and tests; remap, ambiguous, unmatched and prune are each covered
- [ ] scribe-pipeline.enriched.json no longer triggers the warning after the new mechanism is used on it, and `apply` for scribe-pipeline is quiet
- [ ] The root CLAUDE.md working rule, docs/usage.md and the package CLAUDE.md describe the new behaviour; the plugin bundle is regenerated; `pnpm check`, `pnpm test` and `just eval` (7/7) are green on the committed result

## Touched surfaces

- packages/code-graph/src/scribe/apply.ts and scribe/enrich.ts (orphan handling), cli.ts (only if a prune command is added)
- packages/code-graph tests for apply and enrich
- docs/usage.md, packages/code-graph/CLAUDE.md, root CLAUDE.md (the 'moving files orphans' rule), scribe-pipeline and scribe skill text
- scribe-output/scribe-pipeline.enriched.json (gitignored, local cleanup)
- plugin/scripts/code-graph.cjs and the three version files (whoever merges bumps)
- blocked by 059: shares root CLAUDE.md, the bundle and the version files; 059 merges first, this task rebases and regenerates the bundle

## Blocked by

- `059-make-just-eval-pass-on-both-enriched-and-un-enriched-graph-stores.md`
