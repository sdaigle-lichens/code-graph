# Dogfood, parity check and publish the code-graph plugin

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Prove the absorbed concept-skills layer end to end and publish it, which unblocks maestro's cutover (maestro tasks 105-107 in ~/gits/maestro, epic code-graph-cutover). Run `create-concept-skills` on code-graph itself (the existing code-graph-search skill gets stamped; the scribe pipeline gets a SKILL.md). Add a Layer-A eval task searching over marker-stamped skills. On a scratch copy of maestro: install, migrate `.claude/concept-skills.json`, check `skills list --json` parity with `concept-skills.cjs list --json`, edit one file in a concept's globs, check `skills status --json` reports it, and run the update flow so only that skill is revised with a minor bump. On a Terraform sample with no tsconfig and no node_modules: install, create a concept skill, extract + apply, and `search` returns the doc; run `skills list` on a Node older than 22.5 if one is available. Fix what the dogfood turns up. Then bump `plugin.json` and the marketplace entry together and report the published version. Note from task 005: it already set both to 0.3.0 for the unreleased skill set, so publish as 0.3.0 unless the dogfood fixes warrant otherwise — don't double-bump. 005 also ran no end-to-end skill run inside Claude; exercise at least the create, update and install flows through the plugin here. Its install migration leaves the legacy `.claude/concept-skills.json` in place (by design).

## Acceptance criteria

- [ ] code-graph's own skills are stamped and `just eval` is green with all tasks, the new ones included
- [ ] The maestro-copy parity, status and single-skill minor-bump update checks pass
- [ ] The Terraform sample's concept skill is returned by `code-graph search`
- [ ] `plugin.json` and `.claude-plugin/marketplace.json` carry the same bumped version, and the plugin installs from the marketplace
- [ ] The published version is stated in the final report so maestro's epic manager can be told

## Blocked by

- `004-graph-layer-freshness-and-docs-only-concepts.md`
- `005-concept-skill-design-and-lifecycle-skills-in-the-code-graph-plugin.md`
