# Make `code-graph-retrieval` trigger on natural code questions

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The 032 pilot (`claude plugin eval`, the suite in `plugin/evals/`) found that the skill never fires. In all
7 with-plugin runs, natural questions like "How does reordering tasks on the board work?" or "What would
break if I change the signature of moveTask?" got 0 Skill calls and 0 Bash calls. The agent answered with
Grep and Read, so the with-plugin and without-plugin arms scored the same (Δ 0). The plugin was loaded and
the skill was in the agent's list. The project had a `scribe.config.json` and a built graph.

The current description (`plugin/skills/code-graph-retrieval/SKILL.md`) leads with "Query the code-graph
database..." and only says at the end to prefer it "in a project that has a scribe.config.json". Nothing in
an eval workspace (no project CLAUDE.md or `.claude/` loads) tells the agent the project has a graph.

**Find out why it doesn't fire, then fix it within the plugin.** Candidates to evaluate, not a prescription:
- Rewrite the description so it leads with the user's question shapes ("how does X work", "what calls /
  what breaks if I change Y", "where is X") and the signal (a `scribe.config.json` at the root).
- A plugin hook (e.g. SessionStart) that, when `scribe.config.json` exists in the cwd, adds one line of
  context saying the project has a code graph and naming the skill. It must stay silent otherwise, and cost
  no more than one short line.
- Anything else the plugin can ship. No project CLAUDE.md: the eval never loads one, and consumers
  shouldn't need one.

**Measure with the 032 suite.** The user runs it with `!`, with the flags in the 032 report (`--scaffold`,
`--allow-tools Bash`, `--no-publish`). Use the existing cases as they are. Don't add prompts that name the
skill or the tool, and don't tune wording to the exact eval prompts: the goal is natural questions in
general. A 2-run pilot is enough to show whether it now fires; the full 3-run suite comes after 034.

Version: next free patch in all three files, bundle regenerated.

Out of scope: the cross-concept edge gap (034); search ranking or exit-7 thresholds; changing the eval
cases or graders (report problems with them as findings).

## Acceptance criteria

- [ ] The report states why the skill didn't fire, with evidence (e.g. a transcript showing what the agent considered), not only the fix
- [ ] In a user-run pilot of the 032 suite, the skill (or the CLI via Bash) is used in most with-plugin positive runs; the report gives Skill and Bash call counts per case for both arms, against the 032 baseline (0/7)
- [ ] The negative no-config case still passes, and the skill does not fire there (or falls back as its "When NOT to use" says)
- [ ] Any hook does nothing when `scribe.config.json` is absent; it is tested
- [ ] pnpm check, package tests and just eval (7/7) green; version bumped in all three files, bundle regenerated; `claude plugin validate` passes

## Blocked by

- `032-add-a-claude-plugin-eval-suite-for-code-graph-retrieval.md` (the suite this measures with)
