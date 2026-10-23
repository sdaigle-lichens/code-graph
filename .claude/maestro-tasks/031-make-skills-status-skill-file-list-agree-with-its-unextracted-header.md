# Make `skills status <skill>`'s file list agree with its unextracted header

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's second merge review of 0.3.23 (N2), relayed by `manager-code-graph-merge`. The reviewer
edited a file covered by task-queue's globs (tasks.ts) and added a new matching file
(src/core/handoff-probe.ts) without running extract. `skills status task-queue` then contradicted
itself:
- the header said `unextracted: 1 changed`;
- the per-file list labelled that same edited file `unchanged`;
- the new file was not listed at all.

Verified in code (`skills/commands.ts`, the `status` action):
- The changed/unchanged list comes only from the git window `<last-update>..HEAD` (`filesChangedCounts`)
  plus `mappedFiles` (`git ls-files`, tracked files at HEAD).
- The header's `unextracted` comes from `scribe/unextracted.ts`, the working tree against the
  ast.json `meta.files` hashes.
- `UnextractedChanges.files` already carries `{path, kind: "changed" | "new" | "removed"}` per file,
  but the list never reads it.

So uncommitted edits show as `unchanged` and untracked files are invisible.

**Fix (text view of `skills status <skill>`, and the per-concept list in the full view):**
- Label the git list for what it is: e.g. `since stamp <sha8> (git):` before the changed/unchanged
  lines.
- When `unextracted` is non-null and has files, add an `unextracted (working tree vs last extract):`
  section listing each path with its kind (`changed`, `new`, `removed`). Apply the same cap of 10 and
  `+N more` as the other lists.
- A file that appears in that section must not also read as plain `unchanged`: either drop it from the
  unchanged list or tag it (e.g. `unchanged since stamp, edited since extract`). Pick one and document
  it.
- `--json`: `concepts[].unextracted.files` already has the data. Check that it is emitted in
  `skills status <skill> --json` (and in the full `--json`); add it if a summarising step drops it.
  `--summary` stays counts-only.

**Docs:** the `skills status <skill>` paragraph in docs/usage.md says what each section measures (git
since the stamp vs. working tree since the last extract). Also update the concept-skills-layer skill
(via Edit) and the update flows only if they describe reading the list.

Out of scope: a text form for `skills status --summary`. It is documented as implying JSON in both
`--help` and usage.md, and the flows read the JSON.

Version: next free patch in all three files, bundle regenerated.

## Acceptance criteria

- [ ] The reviewer's repro is a test: an uncommitted edit to a mapped file and a new untracked matching file, with no extract. The text output lists the edited file under the unextracted section as `changed` and the new file as `new`; the edited file is not shown as plain `unchanged`
- [ ] The git list is labelled as since-stamp git state; the unextracted section is labelled as working tree vs. last extract; both are capped at 10 with `+N more`
- [ ] With no ast.json (`unextracted` null), output is unchanged apart from the label; tested
- [ ] `--json` carries `unextracted.files` for the single-skill and full forms; `--summary` unchanged and within its size test
- [ ] docs/usage.md updated (and concept-skills-layer if it describes the list)
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate` passes

## Blocked by

None.
