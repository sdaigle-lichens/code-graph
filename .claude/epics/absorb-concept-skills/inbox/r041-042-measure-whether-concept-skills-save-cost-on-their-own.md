# Report r041: 042-measure-whether-concept-skills-save-cost-on-their-own.md

- Task: 042-measure-whether-concept-skills-save-cost-on-their-own.md
- Written: 2026-10-28T00:34:10.998Z
- From session: absorb-concept-skills-042

# 042 report: do concept skills save cost on their own?

**Outcome:** done. `bench/` has `skills` and `noskills` arms, the strip script `bench/strip-concept-skills.mjs`, init-event and Skill-call validity checks, and `--set`. `node --test bench/lib.test.mjs` passes 57/57 and `pnpm check` is green. The user approved 5 questions (m2, m4, s1, s2, s3). The user ran the paid run on Opus 5.5 with 2 runs per arm: $5.363 of the $7 cap, 19/20 runs valid. A 429 was rerun as a separate invocation. The one invalid run was m2 noskills run1, a `sed` call that exited non-zero. The result is in `docs/evals.md`, "Ticket 042".

## Findings

- **Concept skills don't save cost here.** On the 4 balanced questions, `skills` cost 8% more ($2.157 vs $1.992) and scored 60/60 against 58/60.
- **Loading the skill made it dearer.** Where the skill was loaded (s2 and s3, 4 of 4 runs), `skills` cost 11% more. The model still reads the source, and the skill text adds cache-create tokens.
- **Most skills were never loaded.** On m2, m4 and s1 no run loaded the covering skill, so those cases mostly measure the skills sitting in the context. m4 and s1 together were +5%, with runs pointing both ways.
- **The noskills misses were not the facts the skills were chosen for.** Both missed items (m4 `maestroConfigRefusal`, s3 `status.json`) are elsewhere in the answer.
- **The 039 m4 hint (-16%) did not reproduce.**
- **Confidence is low at n=2, and the bias favours skills.** The questions were chosen where skills should help, and they still saved nothing. That points against cost savings being a selling point for concept skills.

## Post-mortem notes

- @reviewer FAILed the first pass. The s3 grader regex copied the skill's wording, so it would have rejected the noskills arm's likely paraphrases ("except", "not auto-generated"). @test widened it and added a paraphrase test. `bench/README.md` now says that a `must` regex grading a negative fact needs such a test.
- The $0 `--init-check` can't run in the sandbox because `claude` is not on PATH. The init events were confirmed only by the in-run checks in the user's paid run.

## Suggested ticket changes

- If the epic still weighs dropping retrieval, concept skills alone can't be sold on cost. A follow-up could measure answer quality on questions with conventions or invariants that the code and the always-loaded rules don't contain (here `plugin-publishing.md` leaked s3's key fact to both arms).
- Optional: relax the bench's "any Bash failure is invalid" rule for a non-zero `sed` or `grep` inside a chain. It cost m2 its balance.
