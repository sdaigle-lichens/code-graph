# Report r044: 048-tell-an-unreadable-ts-morph-deps-dir-apart-from-a-missing-one-in-the-macos-sandbox.md

- Task: 048-tell-an-unreadable-ts-morph-deps-dir-apart-from-a-missing-one-in-the-macos-sandbox.md
- Written: 2026-10-31T01:26:38.857Z
- From session: absorb-concept-skills-048

Outcome: 048 done in worktree code-graph-task-048 (branch task-048), uncommitted, no version bump (per your ruling: next free patch at commit time; rebase + regenerate bundle if landing after 045).

Findings:
- Root cause: under macOS Seatbelt, stat on ~/.cache/code-graph succeeds but readdir/access fail with EPERM; probeDepsDir only stat-ed, so it said "present" and the failed load fell back to "missing, run deps install" (0.3.28 and 0.3.29 both).
- Fix: probeDepsDir lists node_modules after stat (EACCES/EPERM -> unreadable); new depsRootDir/allowReadPaths; deps status and MissingProjectDependencyError name the absolute allowRead path(s). A truly absent dir under an unlistable parent is now "absent" (was mislabelled unreadable).
- MissingProjectDependencyError gained a 4th param (allowPaths); code-graph-update skill steps renumbered (new step 4, deps check).
- 7 new tests (real chmod), suite 522/522, typecheck, pnpm check, eval 7/7, bundle byte-identical to a fresh build. Docs: usage.md, installation.md, development.md.

Post-mortem:
- Channel collision: @test's injected test/backend.1.md was 045's payload. Parallel worktree sessions share the main checkout's .claude/channels, so payloads can cross tickets.
- Fresh worktree has no graph store: first eval 0/7 until just regraph; an agent's eval run from the main cwd wrote results into the main checkout.
- Left for another branch: scribe/backend.2.md holds scribe-pipeline gaps about skill-refresh.ts (not on this branch).

Suggested ticket changes: consider a ticket to scope channel files per task/worktree, and to have the worktree setup (or eval) regraph a fresh worktree.
