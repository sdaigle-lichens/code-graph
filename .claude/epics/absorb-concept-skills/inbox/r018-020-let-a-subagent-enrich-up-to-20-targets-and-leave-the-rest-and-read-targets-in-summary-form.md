# Report r018: 020-let-a-subagent-enrich-up-to-20-targets-and-leave-the-rest-and-read-targets-in-summary-form.md

- Task: 020-let-a-subagent-enrich-up-to-20-targets-and-leave-the-rest-and-read-targets-in-summary-form.md
- Written: 2026-10-19T12:35:20.991Z
- From session: Subagent enrichment with target limits

## Outcome

Task 020 is done (backend workflow, user-approved), uncommitted in the main checkout, version 0.3.13, bundle regenerated.

- Skills (scribe, update-concept-skills, update-single-concept-skill): a subagent enriches up to 20 targets inline (changed/stale, then SKILL-named, then hubs, then rest) and lists the remainder under "left to enrich"; the report notes "core grew from N to M with this run's skill edit"; flows decide with `enrich targets --summary --json` and each batch reads only its own targets with `--json --vertex`; "first touch: --core" removed; whole-concept path on a revised SKILL.md = already-enriched vertices + core, `--all` only for an explicit full pass. Haiku fan-out, thin-core routing, bump rules, no-tsconfig path and gap-channel text unchanged (reviewer verified via diff).
- Code: apply.ts stamps `agent.touched_at` on an approved rename of a never-enriched vertex after the concept's first apply; new test in enrich.test.ts (QA confirmed it fails without the fix); merge/apply exit codes now asserted.
- Docs: scribe-pipeline Invariants, packages/code-graph/CLAUDE.md, docs/usage.md updated.

## Verification

code-graph 321/321, desktop 114/114, `pnpm check` green, `just eval` 7/7, CLI reports 0.3.13.

## Findings / gaps

- Root `pnpm test` fails in the sandbox (turbo drops TMPDIR, tsx can't mkdir /tmp/tsx-1000); per-package runs are green.
- `claude plugin validate` not run: CLI not on the sandbox PATH.
- Graph refresh for scribe-pipeline not run (ts-morph missing); the user will run deps install, extract and apply.
- Untracked home dotfile stubs appear in the repo root (sandbox mount artefacts) — must not be committed.

## Suggested ticket changes

- Optional follow-up: tests for renaming an already-enriched vertex (must not be stamped) and for interactive rename approval without `--approve-drift`.
- Consider making the scribe agent always end with a routable `HANDOFF: success` when its docs are done, reporting skipped graph refreshes in the body.
