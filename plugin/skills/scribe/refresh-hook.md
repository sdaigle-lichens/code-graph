# The refresh-skills hook

Loaded from the scribe skill when the hook's `code-graph:` system message names a concept it left
unapplied or an update run, and at the end of a task (the scribe flows' step 4).

**The plugin's Stop/SubagentStop hook enforces the extract + apply rule** (`refresh-skills --hook`):
when a session or subagent stops, every already-applied concept whose SKILL.md changed is extracted and
applied. Running the two commands yourself still works and makes the doc searchable before the stop.

**The hook never decides a rename.** A concept with rename candidates is left unapplied and named in a
`code-graph:` system message. Have the user run `code-graph apply <concept>` in a terminal to answer
the rename prompts; never `--approve-drift` (it records a rename as an insert plus an archive and loses
enrichment). Such a concept is re-reported at every stop until it is applied by hand: hooks never block
and always exit 0.

**The hook also starts the update when concepts are behind HEAD.** When `skills status` shows concepts
with commits since their `last-update`, the hook starts one background `claude -p` run of
`update-concept-skills` in its unattended mode for those concepts, and says so in its message. The run
is detached (the stop is not delayed), holds the refresh-skills lock while it works, and leaves its
changes uncommitted; its report is `scribe-output/update-skills-report.md`, announced at the next stop
after it ends. No run starts while the lock is held, while another update (hook- or session-started) is
unfinished, or within the minimum interval since the last one started (60 minutes;
`CODE_GRAPH_UPDATE_INTERVAL_MINUTES`). `CODE_GRAPH_AUTO_UPDATE=0` turns the trigger off;
`CODE_GRAPH_UPDATE_MODEL` picks the run's model (the `claude` CLI's default otherwise). The run is
`--permission-mode dontAsk`: it may edit only its staging directory and `scribe.config.json`, and
anything else is denied. The headless run cannot write `.claude/`, so it
stages its SKILL.md files and a manifest in `scribe-output/update-staging/`. The runner installs and
stamps them afterwards, and reports the run as incomplete (repo-level record untouched) when any concept
failed. Its prompt carries `claimed: by the runner`: the runner already holds the claim and the lock,
so that session runs neither `--claim-update` nor `--finish-update` (the headless session cannot read
its environment, so the prompt line is the only signal). A session's own update claims the same lock and
interval (`refresh-skills --claim-update`), so a scribe run followed by its SubagentStop does the work
once.

**At the end of a task, update the concepts it touched.** Run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" skills status --summary`. When a concept the task
touched (its globs cover a file the task changed, or its SKILL.md was the subject) shows `commits > 0`
or a non-zero `unextracted` count, run `update-concept-skills` with
`unattended; concepts: <those ids>; report: <what the task changed>`, for **those concepts only**, never
the whole list: the Stop hook's background run catches the others. The flow claims the run first
(`refresh-skills --claim-update`); exit 14 means another update is running or ran within the minimum
interval, so skip it and say so. Nothing touched is behind: skip it. The unattended run applies
revisions, additions and removals, and leaves its changes uncommitted, with no relay to the main
session. An ambiguous rename does not block its concept: the concept is applied without it, the old
entry stays in `<concept>.enriched.json` as an orphan, and every update report (hook run or
`--finish-update`) lists it under "Ambiguous renames left for a person" until someone runs
`code-graph enrich prune <concept>` or re-enriches the new vertex. Never settle one yourself.
