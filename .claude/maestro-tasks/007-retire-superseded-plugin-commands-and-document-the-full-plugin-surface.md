# Retire superseded plugin commands and document the full plugin surface

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

code-graph 0.3.0 still ships slash commands that the concept-skill flows superseded, and a maestro worker mistook them for the plugin's whole surface (it missed `/code-graph-install`, which is hidden from the model because it is disable-model-invocation). Remove the `/scribe-enrich` and `/code-graph-init` commands: enrichment lives in the `scribe` skill and the update flows, and init is `create-concept-skills`. Remove the `/add-concept` command too, since the `add-concept` skill is already slash-invocable and owning both is a duplicate. Keep `/graph`: it is the query entry point with the Explore-agent fallback on exit 2/6, which no skill replaces. Update every reference to the removed commands (other skills, docs/usage.md, docs/installation.md, CLAUDE.md, README). Add one place, in docs/usage.md and the plugin's description, that lists the full user-facing surface: `/graph` plus every skill, including the install/update/uninstall lifecycle skills. Then bump `plugin.json` and the marketplace entry together to 0.3.1.

## Acceptance criteria

- [ ] plugin/commands contains only graph.md
- [ ] No file in the repo still points users at /scribe-enrich, /code-graph-init or the /add-concept command
- [ ] docs/usage.md lists the complete plugin surface, including code-graph-install/update/uninstall
- [ ] plugin.json and .claude-plugin/marketplace.json both read 0.3.1, and `claude plugin validate` passes
- [ ] pnpm test, pnpm check and just eval (7/7) stay green

## Blocked by

None — can start immediately
