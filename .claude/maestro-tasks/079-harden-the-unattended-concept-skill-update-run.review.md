## Goal
Harden the unattended concept-skill update run: CLI refusals under CODE_GRAPH_UNATTENDED, rollback of a created concept's declaration, GIT_* env stripping in `code-graph git`, and a wider no-plain-git pin. Version 0.3.47.

## Deviations
- `delete-concept --yes --keep-enriched` stays allowed under the marker: the skill's unattended removal uses exactly that form, and it moves the enriched file instead of deleting it. Refusing it would break the skill.
- The env strip goes beyond the ticket's list: also ASKPASS, SSH, SSH_COMMAND, PROXY_COMMAND, EDITOR.
- The runner now also exports CODE_GRAPH_UNATTENDED_ROOT (the project) so the --root check has something to compare against.
- The old probe test asserted that the config kept the created concept after a failed run; it now asserts the rollback.

## Decisions
- Refusals live in one new guard module, wired into the CLI preAction hook.
- Config rollback restores byte-identical when possible, otherwise undeclares the concept.

## Touches
- scribe/unattended-guard.ts (new, with test), cli.ts
- scribe/read-only-git.ts (+ test)
- scribe/update-staging.ts, update-run.ts, update-fixture.ts and their tests (update-staging, update-probes, update-run)
- plugin/skills/update-concept-skills/SKILL.md (reworded, no plain git diff|log|show)
- plugin/scripts/code-graph.cjs (regenerated), the three version files

## Sibling impact
Task 078's unattended path (Stop hook, scribe subagent) is what these guards act on. The epic merge plan has 079 landing after 078.

## Questions
Is allowing `delete-concept --yes --keep-enriched` under the marker acceptable?
