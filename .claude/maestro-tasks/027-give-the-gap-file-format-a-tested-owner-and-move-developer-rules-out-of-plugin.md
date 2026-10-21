# Give the gap-file format a tested owner, and move developer rules out of plugin/

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

From maestro's merge review (R7 and R8; `~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`).

**1. Gap-file fixture (R7).** Verified: in code-graph, `skill_gaps` appears only in markdown
(`plugin/skills/scribe/SKILL.md` ~L115-122, the retrieval skill, `plugin/skills/CLAUDE.md`). No code
reads `.claude/channels/scribe/` and no test checks the format agents are told to write. maestro pins
its parser in its own tests (`hasGapBlock` also accepts the legacy `concept_skill_gaps`), so a wording
change here would break maestro silently.
- Ship the fixture at **`plugin/contracts/skill-gaps.example.json`** (inside the published plugin so
  maestro can read it from the installed plugin): one valid gap file body,
  `{ "skill_gaps": [{ "skill": "<skill-id>", "missing": "<text>" }] }`. Optionally a JSON schema
  beside it (`skill-gaps.schema.json`).
- A code-graph test extracts the example block from the scribe SKILL.md (and the retrieval skill, if
  it shows one) and asserts it parses and has the same shape as the fixture. Keep the contract text
  verbatim; if the test forces a wording change, stop and report it, because maestro depends on it.
- Without maestro: the scribe skill says gaps "arrive inlined… the next time you're invoked", which
  is maestro behaviour. Make it conditional: under maestro they arrive inlined; otherwise the scribe
  reads `.claude/channels/scribe/*.md` at the start of a run, handles them and says which ones it
  handled. Don't change the file path or block format.

**2. Developer rules out of plugin/ (R8).** `plugin/skills/CLAUDE.md` (added in 6ee80fe) is developer
guidance inside the published plugin dir. Move it to the repo's own `.claude/rules/` as a rule scoped
to `plugin/skills/**` (`paths:` frontmatter), keeping its content; update any pointer to it (root
CLAUDE.md layout line). Add a check, run by `pnpm check`, that fails if any `CLAUDE.md` or `.claude/`
appears under `plugin/`. If a write under `.claude/` is blocked, ask the user.

Version 0.3.20 in all three files (next free patch if another task ships first), bundle regenerated.
Put the fixture path and the shipping version in the report: maestro's cutover manager will point its
parity test at it.

## Acceptance criteria

- [ ] `plugin/contracts/skill-gaps.example.json` ships in the plugin, and a code-graph test asserts the SKILL.md example matches it
- [ ] The scribe skill says where gaps go without maestro (read the channel at the start of a run) and keeps the contract text and path unchanged
- [ ] No `CLAUDE.md` or `.claude/` under `plugin/`; the guidance lives in `.claude/rules/` scoped to `plugin/skills/**`; `pnpm check` fails if one reappears
- [ ] claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; version bumped in all three files, bundle regenerated

## Blocked by

- `025-bring-the-scribe-s-default-load-back-near-its-pre-merge-size-and-stop-budget-leaks.md` (both edit `plugin/skills/scribe/SKILL.md`)
