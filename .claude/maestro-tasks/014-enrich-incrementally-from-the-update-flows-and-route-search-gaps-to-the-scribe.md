# Enrich incrementally from the update flows and route search gaps to the scribe

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The skills half of maestro's incremental-enrichment request; it uses task 013's `enrich targets` / `enrich merge`.

**1. Retrieval writes search gaps to the scribe channel.** On a weak or empty search, `plugin/skills/code-graph-retrieval/SKILL.md` (~L74-103) offers the user to build or enrich the concept. maestro's working agents are subagents with no AskUserQuestion, so the offer goes nowhere. Keep the answer-first fallback. When the agent can't ask the user (a subagent), or in addition to the offer, append the gap to `.claude/channels/scribe/<agent>.1.md` using the existing contract verbatim: `{ "skill_gaps": [{ "skill", "missing" }] }`, with `skill` = the concept's skill and `missing` = the query that failed plus the vertices or files it expected. The format is fixed by the scribe skill and maestro depends on it, so don't change it. Keep nag control so the same gap isn't written twice in a session.

How the file is written (from maestro's `handoff-channels.ts`):
- **One fenced json block per file.** The file holds exactly one `{"skill_gaps":[...]}` block, and the working agent may already have written one for its own gaps. "Append" means: read that block, add the new entry to its `skill_gaps` array, rewrite the file. Never add a second block.
- **Keep the run_id line.** If the file starts with a `<!-- maestro:run_id=... -->` line, keep it as the first line, untouched. Never write a run_id yourself: maestro's SubagentStop stamps it.
- **`<agent>` is the writing agent's bare name** (e.g. `backend.1.md`). SubagentStop stamps unstamped files whose sender segment matches that agent, and only stamped files are inlined into the scribe.
- **A gap from the main session (not a subagent) is never stamped**, so the scribe only sees a mention of it. That's acceptable, but the docs must not promise it gets inlined.

**2. The update flows enrich only what changed.** After `extract` + `drift`, `update-concept-skills` enriches only the new, changed, stale and reported vertices (`enrich targets`), not the whole concept. `update-single-concept-skill` does the same for a gap reported through the channel, passing the vertices named by the gap. Fan the targets out in small batches to Haiku subagents launched by the calling skill (subagents can't spawn subagents, so the skill running in the main session does the fan-out). Each returns a partial enrichment; the caller merges them with `enrich merge`, spot-checks a few descriptions against the code (re-asking or dropping bad ones), then runs `apply`. When the concept's SKILL.md was revised, a whole-concept re-enrich is still allowed, since descriptions read the skill. Keep the skills' version bumps as they are (update = `--bump minor`, single = `--bump major`). Update the `scribe` skill's enrichment procedure so it describes the incremental path first and the whole-concept path second.

Every flow must still work with no tsconfig (graph steps skipped), as the root CLAUDE.md requires. Bump all three version files to 0.3.7 and regenerate the bundle if needed.

## Acceptance criteria

- [ ] code-graph-retrieval tells a subagent with a weak or empty search to append a skill_gaps entry to .claude/channels/scribe/<agent>.1.md in the existing shape, after answering
- [ ] The append merges into the file's single json block (never a second block), keeps a leading `<!-- maestro:run_id=... -->` line untouched, writes no run_id, and names the file after the agent's bare name; the docs don't promise that main-session gaps get inlined
- [ ] update-concept-skills enriches only `enrich targets` vertices via Haiku subagents fanned out by the caller, merges with `enrich merge`, spot-checks a few, then applies
- [ ] update-single-concept-skill enriches the vertices named by a reported gap the same way
- [ ] A revised SKILL.md still triggers a whole-concept re-enrich
- [ ] The scribe skill describes the incremental path; the gap-channel contract text is unchanged
- [ ] Flows still work with no tsconfig; claude plugin validate, pnpm check and just eval are green; the version is 0.3.7

## Blocked by

- `013-let-enrichment-merge-per-vertex-and-go-stale-on-body-edits.md`
