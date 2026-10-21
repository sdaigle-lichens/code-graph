# Make "stamp only" a checked decision: list what changed, and warn on a blind stamp

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro task 116 (maestro r010 and the worker's follow-up), relayed by `manager-code-graph-merge`.
The scribe stamped 13 concepts without editing them. It decided from commit lists, diffs and keyword
coverage, not by reading the SKILL.md against the changed code. Afterwards a skimmed concept and a
reviewed one look the same ("0 commits since"). SKILL.md prose has no drift check like `meta.files`
gives code.

Verified in code:
- `gitWindow` (`skills/report.ts`) already returns `filesChanged` (paths over the concept's globs,
  `<sha>..HEAD`), and `skills status --json` emits it per concept. There are no per-file commit counts.
- The text view (`skills/commands.ts`, the `status` action) prints only `N commit(s), N file(s)`, and
  there is no `skills status <skill>` form.
- `skills stamp <skill>` does no check at all before writing.

**1. Status names the files.**
- `skills status <skill>` (id, directory or SKILL.md path, resolved like `stamp`) shows that concept
  only, listing each changed file with its commit count since the stamp (`git rev-list --count` per
  path, or one `git log --name-only` pass).
- `--json`'s `concepts[]` gets `filesChanged` entries with counts (keep a field that stays compatible,
  e.g. add `filesChangedCounts: {path, commits}[]`, or change the shape and update every reader).
- The full text view may add the list under each concept with changes, capped (e.g. first 10, then
  "+N more").
- `--summary` keeps counts only.

**2. Stamp warns on a blind stamp; it never refuses.** Before writing, `skills stamp <skill>` compares
the previous stamp's `last-update`..HEAD:
- files in the concept's globs changed in that window, **and**
- the SKILL.md did not change in that window **and** has no uncommitted change (staged or unstaged:
  the normal flow edits SKILL.md, then stamps before committing, and that must count as an edit).

When both hold, it prints a warning to stderr naming those files, still writes, and exits 0. `--json`
adds `warning: { reason: "mapped-files-changed-skill-unchanged", files[] }`. A documented `--reviewed`
flag suppresses it once the agent has actually compared them. Skip the check, with no warning, for an
unstamped skill, a docs-only skill with no globs, or an unknown/malformed previous sha. The warning
must not change task 028's exit 9 path: a blocked write still exits 9, and the warning is printed
too.

**3. Flows.** In `scribe`, `update-concept-skills`, `update-single-concept-skill` (and `enrichment.md`
if it stamps):
- before the edit-or-stamp decision, run `skills status <skill>` and show the file list;
- a stamp-only requires reading the SKILL.md sections covering those files, and writing a one-line
  reason per stamp-only in the run's report;
- pass `--reviewed` only after that comparison;
- never pass `--reviewed` by default.

Keep the scribe SKILL.md near 8 958 B: put the detail in the update flows or `enrichment.md`, and
leave one line in scribe.

**4. Docs.** docs/usage.md (`skills status <skill>`, `--reviewed`, the warning), the
`concept-skills-layer` skill (via Edit), and packages/code-graph/CLAUDE.md.

Out of scope: refusing a stamp, any semantic or LLM check of SKILL.md content.

Version 0.3.22 in all three files (next free patch if another task ships first), bundle regenerated.

## Acceptance criteria

- [ ] `skills status <skill>` lists changed vs. unchanged mapped files with per-file commit counts; `--json` carries the counts; `--summary` stays counts-only and within its 8 KB test; tested
- [ ] `skills stamp <skill>` warns, naming the files, when mapped files changed and the SKILL.md is unchanged both in the window and in the working tree; it still writes and exits 0; `--json` has `warning`; tested
- [ ] No warning when the SKILL.md was edited (committed in the window, or uncommitted), and none with `--reviewed`; both tested
- [ ] A blocked write (task 028) with a warning still exits 9 and prints the lines
- [ ] Flow skills show the file list before the decision and require a one-line reason per stamp-only; scribe SKILL.md stays near 8 958 B
- [ ] Docs updated (usage.md, concept-skills-layer, packages/code-graph/CLAUDE.md)
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate` listed for the user if it can't run in the sandbox

## Blocked by

- `028-let-skills-stamp-print-the-marker-when-the-sandbox-blocks-the-skill-md-write.md` (both change the `stamp` action in skills/commands.ts, the same flow skills and docs/usage.md)
