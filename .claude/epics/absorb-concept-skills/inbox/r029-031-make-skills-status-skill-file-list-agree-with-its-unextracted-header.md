# Report r029: 031-make-skills-status-skill-file-list-agree-with-its-unextracted-header.md

- Task: 031-make-skills-status-skill-file-list-agree-with-its-unextracted-header.md
- Written: 2026-10-23T15:57:12.808Z
- From session: maestro-a22a5a6e

Outcome: ticket 031 done, uncommitted, version 0.3.24 in all three files, bundle regenerated.
Findings: skills status <skill> and the full view now label the git list "since stamp <sha8> (git):" and add an "unextracted (working tree vs last extract):" section (changed/new/removed, cap 10, +N more). Decision: paths in that section are dropped from the text unchanged list. JSON filesUnchanged stays raw; unextracted.files was already emitted in single-skill and full --json; --summary stays counts-only. Three new tests (reviewer repro, cap, null ast.json). docs/usage.md and concept-skills-layer SKILL.md updated.
Checks: pnpm build, pnpm check, package tests 480/0, just eval 7/7, claude plugin validate passed (run by backend). Reviewer did not rerun eval/validate. The text removed row has no automated test (judged immaterial). Turbo telemetry was blocked by the sandbox, harmless.
Post-mortem: clean. The SubagentStop hook flagged a missing HANDOFF line for backend and scribe, but each hand-back message did end with HANDOFF: success.
Suggested ticket changes: none.
