# Stop the retrieval skill loading when a concept skill already locates the answer

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

035's paid run on maestro (see "Maestro benchmark findings" in `docs/evals.md`) had no valid
graph-vs-Grep result, because Bash failed in the eval sandbox. One effect held up anyway:
- `code-graph-retrieval` loaded even when a loaded concept skill already named the files and symbols
  that answer the question.
- On those two questions the graph arm cost 34% and 51% more, about +60–70k input and cache tokens per
  run, for the same answer.
- The 0.3.27 fixture pilots point the same way: the plugin arm cost about 27% more overall. Part of that
  was the skill load and the SessionStart line, even in `neg-no-config`, where the skill never fires.

033 made the skill trigger on natural code questions ("Use first, before Grep or Read…"). This ticket
narrows that trigger without losing it:
- **When the skill stays out:** a concept skill already in context names the file or symbol the question
  is about. The agent then reads it directly.
- **When it stays in:** the question needs what only the graph has: callers across concepts (`impact`),
  how two concepts interact (`cross`), or locating something no loaded skill mentions.
- **Where to change it:** the skill's frontmatter `description` (what decides loading) and its "When NOT
  to use" section; the SessionStart line in `plugin/hooks/graph-context.cjs`, if it needs the same
  qualifier.
- **Size:** keep both short; every word of the description and the hook line is paid on every session.
- **Hook contract:** keep its guard rules (`.claude/rules/plugin-skills.md`) and its test.

Also measure the fixed cost the plugin adds per session, so later tickets have a number:
- the token size of the skill description, the full SKILL.md body and the SessionStart line,
  before and after;
- counted offline (chars/4 is fine, say which), not from a paid run.

Eval:
- Add one case to `plugin/evals` where the answer is fully named in a concept SKILL.md the agent has
  loaded. Expect the retrieval skill not to load and the answer to still be correct.
- Eval workspaces don't load project `.claude/skills`, so the case has to ship that concept skill some
  other way. Pick the simplest way that works with `claude plugin eval` and document it in the case.
- The existing positive cases (smoke, impact, cross-store, locate) must still load the skill.
- The user runs one pilot: 2 runs, `--keep-temp`, cap $5.
  - Before reading its numbers, check one kept trace for `apply-seccomp`. If Bash failed, the CLI
    columns are invalid; say so, and don't draw conclusions from them.
  - Skill-loading results don't depend on Bash and stay valid either way.

Version: next free patch (0.3.28) in all three files, bundle regenerated.

Out of scope:
- reviving the maestro benchmark harness;
- making Bash work inside the eval sandbox;
- slimming the SKILL.md body beyond what the trigger change needs (propose it as a follow-up with the
  measured sizes);
- subagent behaviour (they don't get the SessionStart line).

## Acceptance criteria

- [ ] The retrieval skill's description and "When NOT to use" tell the agent to skip it when a loaded concept skill already names the file or symbol, and to keep it for impact, cross and unknown-location questions
- [ ] The SessionStart line is updated if needed and still passes `graph-context-hook.test.ts`; the hook stays inert
- [ ] Description, SKILL.md body and SessionStart line sizes are reported before and after, offline
- [ ] A new `plugin/evals` case covers "a concept skill already has the answer": the skill doesn't load, the answer is correct
- [ ] User-run pilot (2 runs, cap $5): the new case doesn't load the skill; smoke, impact, cross-store and locate still do; the report says whether Bash worked (seccomp check on a kept trace) and gives cost per case against the 0.3.27 pilot
- [ ] `docs/evals.md` updated with the case and the pilot
- [ ] pnpm check, the full `pnpm test` from the root and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate plugin` passes

## Blocked by

- `036-make-the-desktop-canvas-test-count-cross-concept-edges-from-the-store.md` (green full test suite first; shared tree)
