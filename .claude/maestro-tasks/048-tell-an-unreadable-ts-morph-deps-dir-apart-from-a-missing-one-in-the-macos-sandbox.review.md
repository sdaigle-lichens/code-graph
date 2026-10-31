## Goal

Under the macOS sandbox, when the ts-morph deps dir (`~/.cache/code-graph`) exists but can't be read, `extract` and `deps status` should say it exists but can't be read and name the absolute path to add to `sandbox.filesystem.allowRead`. Today they say "missing, run deps install". A dir that is really absent should still say to run `code-graph deps install`.

## Done

- **Reproduced in this sandbox.** For the denied cache dir, stat/lstat succeed but readdir and access(R_OK) fail with EPERM. A path that really doesn't exist gives ENOENT. Before the fix, plugin 0.3.28 and the current build both printed `ts-morph: missing — run code-graph deps install`, and `extract` exited 1 with "could not be found … Run code-graph deps install".
- **Root cause.** `probeDepsDir` only ran `stat`, so it classified the dir as present. The ts-morph load then failed with no visible cause, and the message fell back to "missing".
- **Fix.** The probe now lists `node_modules` after `stat`; EACCES or EPERM there means "unreadable". New helpers work out the absolute path(s) to allow. The `deps status` and `MissingProjectDependencyError` messages say the dir "exists but cannot be read from this session" and name those paths.
- **Plugin skills.** `code-graph-install` and `code-graph-update` now check deps readability before the first extract.
- **Bundle and checks.** The bundle was regenerated. Build, typecheck, the whole test suite, `pnpm check` and the eval (7/7) are green.

## Deviations

- @backend wrote no new unit tests and left the cases to @test, which is the next step on this path.
- **Extra fix.** It also fixed a second misclassification: a really absent cache dir under a parent that can't be listed was being called "unreadable". It now counts as "absent" and gets the "run deps install" message.
- **Eval run.** The eval ran through `node packages/code-graph/dist/cli.js eval` instead of `just eval`. Its results file landed in the main checkout's gitignored `eval/`.
- **Linux not checked.** The Linux bubblewrap sandbox was not reproduced; its existing tests still pass.

## Decisions

- **When the probe says "unreadable".** A `stat` that succeeds followed by a `node_modules` listing that fails with EACCES or EPERM.
- **Path to allow.** The deps cache root, or `CLAUDE_PLUGIN_DATA` when that is the dir that can't be read.
- **Error wording.** The unreadable case now starts with "could not be loaded"; the absent and not-visible cases keep "could not be found".
- **Skill step numbers.** In code-graph-install they are unchanged, so the uninstall skill's references to them still hold. In code-graph-update a new step 4 was inserted, and the old steps 4–5 moved to 5–6.

## Touches

- packages/code-graph/src/project-deps.ts (probeDepsDir, sandboxReadAdvice, MissingProjectDependencyError, new depsRootDir and allowReadPaths)
- packages/code-graph/src/deps.ts (`deps status` output)
- plugin/skills/code-graph-install/SKILL.md, plugin/skills/code-graph-update/SKILL.md
- packages/code-graph/CLAUDE.md
- plugin/scripts/code-graph.cjs (regenerated)

## Sibling impact

- `MissingProjectDependencyError` gained a 4th parameter, `allowPaths`. Any sibling ticket that constructs this error or matches its message text should check its call sites.
- Any ticket that edits the code-graph-update skill will see its steps renumbered.

## Questions

None blocking.
