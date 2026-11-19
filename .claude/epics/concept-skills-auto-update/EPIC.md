# Epic: concept-skills-auto-update

## Goal

Keep concept skills current with no user input after install and the first concept list, from the Stop hook and the Maestro scribe subagent, and run refactor-scout at epic boundaries by configuration alone

## Scope

In:
- 077: refactor-scout from maestro.json end_skills.maestro_manager / start_skills.maestro_manager, with no wrapper skill; one `refactor-scout not run:` line when it is skipped. Done (371543e).
- 078: the unattended update loop started by the Stop/SubagentStop hook, plus the scribe subagent path. Done (2931c14).
- 079: hardening the unattended run. Ready.

Out:
- Remembering declined refactor-scout findings (wait for a trial epic).
- Maestro-side fixes from the 078 post-mortem (the HANDOFF quote parser, scribe leftovers): the maestro manager tickets them.
- Test-defect routes in code-graph's maestro.json: the user decides, after 079.

## Decisions

- code-graph-update suggests the refactor-scout entry, never edits maestro.json, and records no decline.
- The user's input is needed only at install and for the first concept list. After that, additions and removals are automatic.
- A rename is applied only with a single clear match. An ambiguous one keeps its enriched entry untouched, is listed in every run's report, and never blocks its concept.
- The headless session never writes `.claude/` and never stamps. The runner installs and stamps the staged files, and an incomplete run advances nothing.
- Results are left uncommitted for a git diff. `CODE_GRAPH_AUTO_UPDATE=0` turns the trigger off, and the default interval between runs is 60 minutes.
- Sessions that change the runner (079) start with `CODE_GRAPH_AUTO_UPDATE=0`.

## Merge plan

| Order | Task | Base | Version bump | Shared surfaces |
|---|---|---|---|---|
| 1 | 077 | main | 077 (0.3.45) | bundle, version files: merged |
| 2 | 078 | main after 077 | 078 (0.3.46) | bundle, version files, skill-refresh/update-run: merged |
| 3 | 079 | main after 078 | 079 (0.3.47) | bundle, version files, update-run/update-staging, cli.ts |

Work lands directly on main and nothing is pushed until the user says so. There is only one open task, so nothing runs in parallel.
