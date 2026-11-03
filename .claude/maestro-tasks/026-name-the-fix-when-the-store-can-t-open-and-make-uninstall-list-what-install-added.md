# Name the fix when the store can't open, and make uninstall list what install added

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's merge review (R5 and the code-graph half of R6;
`~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`).

**1. No `node:sqlite` (R5).** Measured with `node --no-experimental-sqlite`: `skills status` degrades
gracefully, but `search` exits 1 with "No such built-in module: node:sqlite", no advice, and exit 1 is
not in the retrieval skill's table. Verified: `scribe/db.ts` imports `node:sqlite` statically; `cli.ts`
loads it lazily per command, so the failure surfaces at that lazy import.
- Every graph command (search, query *, extract, apply, drift, enrich, gaps, eval, …) that can't load
  `node:sqlite` exits with a new documented code and one line naming the required Node version
  (package.json `engines`, ≥22.5) and how to check it (`node --version`). Catch it in one place.
- Add the code to docs/usage.md and the retrieval skill's table.

**2. `deps status` on ENOENT inside the sandbox (R5).** The reviewer asks that ENOENT say "absent"
inside the sandbox too. Today `probeDepsDir` (project-deps.ts) returns `unreadable` for any ENOENT
while `SANDBOX_RUNTIME=1`, because bubblewrap can hide a denied home path (it looks like ENOENT).
That's the 0.3.15 case and it must keep working. Tell the two apart where the filesystem allows:
- if the cache root (`cacheRootDir()`) or its parent can be listed and the deps dir is missing from
  it, it's **absent** (say "run deps install");
- if the cache root itself can't be seen from a sandboxed session, say "not visible from this
  sandboxed session: it may be absent or hidden", with both fixes (deps install in your shell, or
  allowRead);
- EACCES/EPERM stays `unreadable`.
Tests cover all three under `SANDBOX_RUNTIME=1` plus the non-sandboxed absent case.

**3. Uninstall lists what install added (R6).** `plugin/skills/code-graph-uninstall/SKILL.md` today
disables the plugin and optionally removes the `skills` block. Make it name each artefact install
added and offer to remove each, one consent per item, default no:
- the `.gitignore` line from install step 6;
- the `sandbox.filesystem.allowRead` entry install step 7 may have added (user or local settings;
  if a hook asks before a settings edit, explain and wait);
- `~/.cache/code-graph/deps` (and `$CLAUDE_PLUGIN_DATA/deps` if set), noting other projects may share it;
- gap files under `.claude/channels/scribe/`.
It also lists what it keeps on purpose: SKILL.md files, `scribe.config.json` `concepts`,
`scribe-output/`, `tsconfig.code-graph.json`. Read `code-graph-install` to make sure the list matches
what it actually adds. (Retiring `concept-skills@maestro` and the install command in maestro's
suggestion text are maestro's tasks, not this one.)

Version 0.3.19 in all three files (next free patch if another task ships first), bundle regenerated.
Update packages/code-graph/CLAUDE.md (plugin bundle notes) and docs/installation.md.

## Acceptance criteria

- [ ] With `node --no-experimental-sqlite`, `search` and the other graph commands exit with one new documented code and a one-line message naming Node ≥22.5; the retrieval skill and docs/usage.md list it; a test covers it
- [ ] `deps status` says absent when the cache root is visible and the deps dir is missing (sandboxed or not), "not visible" when the cache root itself can't be seen in a sandboxed session, and unreadable on EACCES/EPERM; tests cover each
- [ ] The uninstall skill names the gitignore line, allowRead entry, deps cache and gap files, offers to remove each with consent, and lists what it keeps on purpose
- [ ] claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; version bumped in all three files, bundle regenerated

## Blocked by

- `023-keep-search-honest-while-most-concepts-are-un-enriched.md` (both edit the exit-code table in the retrieval skill and docs/usage.md)
