# Ship the Haiku refactor scout as a plugin skill a Maestro project can run at epic start and end

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The bench showed a plain Haiku scout with a metrics primer gives more accurate proposals per dollar than a Sonnet refactor pass (ticket 071: 286 against 17.1 useful per dollar), and that neither a Sonnet filter nor a decided-against list earns its place (tickets 072 and 074). Move that scout out of the bench and into the product: a code-graph plugin skill, plus whatever new CLI command and source code it needs, including the metrics primer that today exists only as a bench builder over stored files. This is code, tests, a skill file, a regenerated bundle and a version bump, not docs alone.

The skill follows the contract of Maestro task 158. It receives the path of a scope file holding one repo-relative existing file per line. It spawns its own Haiku agent, because a configured skill runs in the manager's context and must not spend that context or that model. The agent gets the same prompt shape the bench measured: the scope, then the metrics primer as leads to check against the source. The result is printed as a `PROPOSALS:` block with lines `- <file path>: <kind>: <problem and change>`, or `PROPOSALS: none`. The output is advisory: the skill changes no code, hands nothing back to any worker and takes no decided-against input. A person triages the proposals.

The scope can be larger than anything measured. Bench scopes were 4 to 11 files, while the epic-end scope is every existing file changed since a recorded base commit, which may include other merged work. So one Haiku session gets at most 11 files; a larger scope is split by neighbourhood (import links) into several sessions, with a stated cap on sessions. Files past that cap are named as not scanned, never dropped silently. Files the index does not cover (generated files, for example) are ignored and counted.

With no index or no tsconfig the metrics primer cannot be built, and the bench never measured a scout without one: the skill says so in one line and stops without proposals, rather than running an unmeasured form.

The skill documents what the evidence does and does not cover: the bench audit confirms any true claim, so the ratio measures accurate proposals rather than valuable ones; split scopes and epic-end use were not measured.

This ticket does not change anything in the maestro repo and does not configure the skill in any project. No paid run is started by the agent.

## Acceptance criteria

- [ ] A plugin skill takes a scope file path, spawns its own Haiku agent and prints a `PROPOSALS:` block or `PROPOSALS: none`, and changes no code
- [ ] The metrics primer is built by shipped code from the store for an arbitrary scope, and the bench's stored primers remain usable, so the bench still runs and its tests pass
- [ ] A scope over 11 files is split by neighbourhood under a stated session cap; files past the cap and files outside the index are reported by name or count, and tests pin this
- [ ] With no index or no tsconfig the skill reports that in one line and stops with no proposals
- [ ] Missing or unreadable scope files, and scope lines that are not existing repo-relative files, are handled with a clear message and tested
- [ ] The skill has no decided-against input and hands nothing back to a worker
- [ ] The skill states the limits of the evidence, and docs/usage.md covers any new CLI command and its exit codes
- [ ] The version is bumped in all three version files, `pnpm bundle` regenerates plugin/scripts/code-graph.cjs, and `pnpm verify` is green
- [ ] `just eval` stays 7/7 if retrieval code is touched
- [ ] Nothing changes in the maestro repo and no paid run is started by the agent

## Touched surfaces

- plugin/skills/ (new scout skill)
- packages/code-graph/src/ (metrics primer, CLI command)
- plugin/scripts/code-graph.cjs (generated)
- packages/code-graph/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json (version; this task bumps)
- docs/usage.md
- bench/refactor.mjs (only if the primer builder is shared)

## Blocked by

None — can start immediately
