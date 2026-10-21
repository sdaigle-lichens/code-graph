# Let `skills stamp` print the marker when the sandbox blocks the SKILL.md write

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro task 116 (maestro report r010, relayed by `manager-code-graph-merge`). With Claude
Code's sandbox on, `code-graph skills stamp <skill>` hit EROFS on `.claude/skills/**` (four skills).
That is Claude Code's built-in protection: sandboxed Bash can never write `.claude/skills`,
`.claude/hooks` or settings files, and the guardrails keep it that way. Only Edit/Write can, and they
prompt. The scribe then set `metadata.version` / `last-update` by hand. The values happened to be
right, but hand-computing stamps is what the tool exists to prevent.

Verified in code: `skills stamp` (`skills/commands.ts`, the `stamp [skill]` action) stamps **one**
skill per call. `stampConceptSkill` (`skills/concept-skills.ts`) computes the rebuilt frontmatter,
then `writeFileSync`s it. Any throw goes to `die()`, which exits 1 with only the error message, so the
computed values are lost. The repo-level form (no `[skill]`) writes `scribe.config.json`, which is
outside `.claude/` and not affected.

**1. Split compute from write.** `stampConceptSkill` (or a sibling) returns the computed result
before writing: version, lastUpdate (full sha), and the exact `metadata:` block as it will appear in
the file. That block includes `type: concept-skill` and the file's indent. For an unmarked skill it
is the whole new block, carrying over any inline metadata, as today. Byte-preserving behaviour and
the "identical re-stamp writes nothing" rule are unchanged.

**2. On EROFS / EPERM / EACCES writing the SKILL.md:** don't `die`. Print the skill path and the exact
lines to set. Text output must be applicable verbatim with Edit: `version: "X.Y"` and
`last-update: <full 40-char sha>`, or the whole `metadata:` block when the skill had none. Exit with a
new documented code, **9** = "stamp computed, not written: apply the printed lines". `--json` gives
`{ stamped, version, lastUpdate, written: false, blocked: { reason, lines[] } }`. Other errors
(no frontmatter, missing file) still exit 1 as today.

**3. `--print`:** compute and print the same output without attempting the write, exit 0, for an
agent that knows it is sandboxed.

**4. Skills.** `scribe`, `update-concept-skills`, `update-single-concept-skill` and
`create-concept-skills`, wherever they run `skills stamp <skill>`: on exit 9, apply the printed lines
with Edit, verbatim, then re-run `skills status` for that concept to confirm. Never compute or retype
the values by hand. The repo-level `skills stamp` still writes `scribe.config.json` normally. Keep
the scribe SKILL.md near its 0.3.18 size (8 958 B): one short paragraph, or put it in
`enrichment.md` if the stamp step lives there.

**5. Docs.** Exit code 9 goes in docs/usage.md's troubleshooting table and in the retrieval skill's
exit-code table if it lists every code. Add one bullet to `.claude/skills/concept-skills-layer` (via
Edit) and to packages/code-graph/CLAUDE.md.

Out of scope: anything that widens the sandbox or asks users to exclude `skills stamp` from it.

Version 0.3.21 in all three files (next free patch if another task ships first), bundle regenerated.

## Acceptance criteria

- [ ] A read-only SKILL.md (chmod or EROFS-simulated): `skills stamp <skill> --bump minor` exits 9 and prints the path plus the exact `version` / `last-update` lines (whole `metadata:` block for an unmarked skill); `--json` has `written: false` and `blocked.lines`; a test covers both forms
- [ ] Applying the printed lines verbatim to the file leaves it byte-identical to what a writable stamp produces, and `skills status` then reports 0 commits since for that skill; tested
- [ ] A writable SKILL.md still stamps exactly as before (exit 0, byte-preserving, identical re-stamp writes nothing); `--print` never writes and exits 0
- [ ] Repo-level `skills stamp` (no skill) is unaffected
- [ ] The four flow skills tell the agent to apply printed lines with Edit on exit 9 and confirm with `skills status`; scribe SKILL.md stays near 8 958 B
- [ ] Exit 9 documented in docs/usage.md; concept-skills-layer skill and packages/code-graph/CLAUDE.md updated
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate` listed for the user if it can't run in the sandbox

## Blocked by

None.
