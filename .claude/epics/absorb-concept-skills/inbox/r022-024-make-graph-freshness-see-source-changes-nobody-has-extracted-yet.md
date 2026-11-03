# Report r022: 024-make-graph-freshness-see-source-changes-nobody-has-extracted-yet.md

- Task: 024-make-graph-freshness-see-source-changes-nobody-has-extracted-yet.md
- Written: 2026-10-21T13:25:05.102Z
- From session: maestro-898f8113

Outcome: task 024 done, shipped as 0.3.17 (three version files bumped, bundle regenerated).

Findings:
- `extract` records a sha256 per code file under `meta.files` in each `<concept>.ast.json`. `skills status` and `drift` rescan with the same glob scan (new module `scribe/unextracted.ts`, imports only fs, crypto, minimatch) and report a file-level `unextracted: { changed, new, removed, files }`, separate from vertex `changed`.
- Layer 1 is guarded by `skills/unextracted-imports.test.ts` (static import-graph walk). `ast.json` stays byte-identical across re-extracts of unchanged code. Each committed ast.json changes once to gain `meta.files`; one written before 0.3.17 reports no `unextracted` until its next extract.
- update-concept-skills and update-single-concept-skill now run extract + apply for any concept with non-zero unextracted.
- Docs updated: packages/code-graph/CLAUDE.md, docs/usage.md, concept-skills-layer and scribe-pipeline skills.
- Checks: pnpm build, pnpm check, `pnpm --filter code-graph test` (377/377) and just eval (7/7) are green. Not run: `claude plugin validate` (no `claude` on PATH in the sandbox). Root `pnpm test` via turbo fails in this sandbox (turbo strips TMPDIR, so tsx cannot write /tmp); with `--env-mode=loose` 4 unrelated tests still fail. @test judged this sandbox-only; not verified outside it.
- Pending: `code-graph extract` + `apply` for scribe-pipeline and concept-skills-layer after their SKILL.md edits (ts-morph not reachable from the sandbox).
- Reviewer warnings: SKIP_DIRS is hard-coded (a concept globbing dist/build would not be scanned); every matched file is hashed per status call.

Post-mortem: none (clean run).

Suggested ticket changes: consider a turbo.json `globalPassThroughEnv: ["TMPDIR"]` ticket for sandboxed runs through turbo.
