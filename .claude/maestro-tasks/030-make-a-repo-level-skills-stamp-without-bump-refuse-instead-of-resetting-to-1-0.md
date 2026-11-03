# Make a repo-level `skills stamp` without `--bump` refuse instead of resetting to 1.0

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Bug from maestro, relayed by `manager-code-graph-merge`. In maestro, `scribe.config.json` had
`skills.version: "1.30"`. A bare `code-graph skills stamp` (no skill, no flags) printed
`{"written":true,"version":"1.0",...}` and wrote 1.0, so the version went backwards. `--bump minor`
correctly gave 1.31.

Verified in code: the repo-level branch of the `stamp` action (`skills/commands.ts`) calls
`nextVersion(current?.version, opts.bump ?? "initial")`, and `nextVersion(_, "initial")` returns 1.0
unconditionally. This is documented as a footgun (usage.md, update-concept-skills,
code-graph-install, packages/code-graph/CLAUDE.md, `.claude/rules/plugin-skills.md`), but no guard
exists.

The per-skill form is already safe and stays unchanged:
- a marked skill with no `--bump` dies with "stamp needs --bump";
- an unmarked skill defaults to `initial`, which is correct, because marking it is the initial stamp.

**Fix (repo level):**
- no `--bump` and no existing `skills.version` (neither in `scribe.config.json` nor in the legacy
  `.claude/concept-skills.json` fallback): `initial` (1.0), as today;
- no `--bump` and an existing version: refuse, writing nothing, with exit 1 and a message naming the
  current version, `--bump minor|major`, and `--bump initial` to reset deliberately. Use the same
  wording style as the per-skill "stamp needs --bump";
- an explicit `--bump initial` over an existing version still resets, because it was asked for.

Prefer refusing over defaulting to minor: create (`initial`), update (`minor`) and deepen (`major`)
mean different things, and the per-skill form already refuses.

**Docs:** replace "resets to 1.0" with "refuses" in docs/usage.md, the update-concept-skills and
code-graph-install skills, packages/code-graph/CLAUDE.md and `.claude/rules/plugin-skills.md`. Keep
the guidance to pass `--bump` explicitly.

Version: next free patch in all three files, bundle regenerated.

## Acceptance criteria

- [ ] Repo-level `skills stamp` with no `--bump` over an existing version exits 1, writes nothing, and names the current version and the `--bump` options; tested (scribe.config.json and legacy-file sources)
- [ ] With no existing version, no `--bump` still stamps 1.0; `--bump initial` over an existing version still resets; both tested
- [ ] Test: a stamp with no `--bump` never decreases an existing version (repo level and per skill)
- [ ] Per-skill behaviour unchanged (marked skill without `--bump` dies; unmarked one gets 1.0)
- [ ] The five docs updated
- [ ] Follow-up from 028's review: a test that exit 9 (and `--print`) on a CRLF SKILL.md prints lines that, applied verbatim, give the same bytes as a writable stamp (CRLF preserved)
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated

## Blocked by

- `028-let-skills-stamp-print-the-marker-when-the-sandbox-blocks-the-skill-md-write.md` (same `stamp` action; 028 is finished but not yet committed)
