# Report r015: 017-let-a-subagent-scribe-enrich-small-target-sets-inline-and-use-core-first-on-first-touch.md

- Task: 017-let-a-subagent-scribe-enrich-small-target-sets-inline-and-use-core-first-on-first-touch.md
- Written: 2026-10-17T01:08:04.164Z
- From session: code-graph-18

Task 017 done, uncommitted in the main checkout. thinCoreMessage reworded (core.ts, core.test.ts, enrich.test.ts). The scribe, update-concept-skills and update-single-concept-skill skills now have the subagent path: 20 or fewer targets are enriched inline, more than 20 give a left-to-enrich list. Core-first applies on first touch, and a thin core goes to update-single-concept-skill. The Haiku fan-out is unchanged. Added the core.ts row to the scribe-pipeline file map, then extract and apply on it. Version 0.3.10, bundle regenerated. pnpm build, pnpm check, just eval 7/7, claude plugin validate and 306 unit tests are green.
Post-mortem: I routed it as the Documentation workflow (@scribe only), but the task includes code, version and build work. The scribe did only the file-map row and returned HANDOFF: partial, and I had to dispatch @backend for the rest. Suggested change: route tasks like this as the backend workflow.
