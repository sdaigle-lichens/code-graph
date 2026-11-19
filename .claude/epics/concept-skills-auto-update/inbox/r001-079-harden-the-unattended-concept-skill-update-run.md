# Report r001: 079-harden-the-unattended-concept-skill-update-run.md

- Task: 079-harden-the-unattended-concept-skill-update-run.md
- Written: 2026-11-19T01:56:18.163Z
- From session: maestro-079

Outcome: task 079 done, committed as 690ed59 on main (not pushed).

Verified on that code: pnpm build, typecheck, check and the full code-graph suite (1078 pass, 0 fail) green; just eval 7/7. Reviewer re-ran 91 targeted tests. The commit holds the same files that were tested; nothing was edited after the test run except the scribe docs.

Delivered: unattended refusals (enrich prune --yes, plain delete-concept --yes, --root outside project; --keep-enriched stays allowed per manager), CODE_GRAPH_UNATTENDED_ROOT, rollback of a created concept's declaration and SKILL.md, GIT_* env strip in code-graph git, widened no-plain-git pin, version 0.3.47, bundle regenerated.

Findings: a rolled-back created concept keeps its ast.json and store rows. Repo-level git config (diff.external in .git/config) is not neutralised by gitSafeEnv. scribe-pipeline stamp 1.8 was applied by hand because the sandbox blocked the stamp command; 5 vertices are stale and need re-enrichment. The maestro hook misparsed one test handoff line as having no route; it was a plain success.

Suggested ticket changes: none required; optional follow-up tickets for the two gaps above.
