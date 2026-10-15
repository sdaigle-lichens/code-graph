# Epic: absorb-concept-skills

## Goal

code-graph absorbs what maestro's `concept-skills` plugin does well (versioned, marker-stamped
concept SKILL.md files; create/update/scribe flows; install lifecycle; design skills), so maestro
can drop concept-skills and point its scribe and subagents at `code-graph:*` skills. Source plan:
`plan.md` at the repo root.

## Scope

In: tasks 003–006 — layer-1 skills CLI + bundled `plugin/scripts/code-graph.cjs`, graph-layer
freshness and docs-only concepts, the ported plugin skills, dogfood/parity/publish.

Out: anything in `~/gits/maestro` (its cutover is maestro tasks 105–107, epic
`code-graph-cutover`, managed by the maestro session `maestro-ca`); an HCL extractor.

## Decisions

- Autonomous repos: port and inline, no dependency on maestro code; code-graph keeps its own
  marketplace.
- Two layers: concept skills work in any repo (Terraform included); the graph lights up only
  where a tsconfig exists. Docs-only concepts are still searchable.
- Concept = `scribe.config.json` globs + byte-compatible concept-skills marker in SKILL.md.
- Small bundle: `typescript`/`ts-morph` external, resolved from the target project. Layer 1 never
  loads `node:sqlite`.
- One scribe skill; the gap-channel contract (`.claude/channels/scribe/`) is kept verbatim.
- On publish (end of 006), send the published version in one line to the session named
  maestro-ca (resolve via ListAgents); it unblocks maestro task 105.
- r001 (003 done): repo-level `skills stamp` without `--bump` resets to 1.0; 005's update flows pass
  `--bump minor` and install's migration keeps the legacy version. 004 also guards the stored sha in
  `skills status` and tests mixed LF/CRLF stamping. maestro-ca declined upstreaming the CRLF fix (107 deletes concept-skills; no maestro SKILL.md is CRLF).
- r002 (005 done, in worktree code-graph-task-005 / branch task-005, uncommitted): plugin.json and
  marketplace.json already at 0.3.0, so 006 publishes 0.3.0 without a double bump; 006 also runs
  the create/update/install flows end to end in Claude (005 didn't). code-graph-init and
  scribe-code-graph were merged away. task-005 merged in d110335.
- r003 (004 done, uncommitted in the main checkout): `just eval` is now 6/6. `drift --json` compares
  ast.json to the store, so `extract` runs before `drift`. 004 committed in eb68ef2.
- r004 (006 done, uncommitted): version 0.3.0, eval 7/7, maestro-copy parity byte-identical,
  Terraform search hit, docs-only `search`/`concept` defect fixed. Not verified live: the
  create/update/install flows inside Claude and a real Node <22.5 — maestro task 106 (switch maestro
  to code-graph, dogfood the scribe) is the natural live run. The version goes to code-graph-cutover
  as a note once 0.3.0 is committed and pushed (maestro-ca, its recorded manager, is not running).
- 0.3.0 committed (6b97d5d) and installed locally from the repo dir; maestro-1c now manages
  code-graph-cutover. Its finding: 0.3.0 still ships superseded commands. Decision (task 007): drop
  /scribe-enrich, /code-graph-init and the /add-concept command (skill stays), keep /graph, list the
  full surface in docs, publish 0.3.1 and tell maestro-1c.
