---
name: refactor-scout
description: "Advisory refactor scan of a given list of files: takes the path of a scope file (one existing file per line, relative to the git root), spawns its own Haiku agents with a metrics primer and prints a PROPOSALS: block for a person to triage. Changes no code. Run it when a project configures it for an epic boundary or the user asks for it by name, not as a search or review step."
argument-hint: "<scope-file>"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" scout *), Agent
---

# Refactor Scout

Scope file: `$ARGUMENTS`. No path given: print `refactor-scout: no scope file given` and stop.

A config in a git subdirectory needs an absolute scope file path, and the session started in that
subdirectory or `--root`: from the git root the config is not found, and a relative path does not
resolve from the git root.

You run in the caller's context and on the caller's model, so do none of the reading yourself. Haiku
agents read the code; you start them and assemble what they return. Read no source file and no prompt
file. This skill takes one input, the scope file: there is no list of declined findings to pass in.

## 1. Prepare the sessions (no model call)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" scout "$ARGUMENTS"
```

**Non-zero exit:** print the one line it wrote to stderr, with no `PROPOSALS:` line, and stop. Exit 12
means no index or no tsconfig, so no metrics primer; the bench never measured a scout without one, so
there is no fallback to a plain scan. Exit 11 means the scope file is missing or unreadable.

**Output with a `nothing scanned:` line:** no agent will run. Print the output as it is and stop, with
no `PROPOSALS:` line. `PROPOSALS: none` means a scan ran and proposed nothing, so never write it here:
an empty or unscannable scope says nothing about the code.

**Otherwise** the output has a `root: <git root>` line and one `session <n>: <prompt file>: <files>`
line per session. Keep the `ignored:`, `not scanned:` and `skipped lines:` lines for step 3. Those are
the limits of this run: a scope over 11 files is split along its import links, each session gets at most
11 files, a run spends at most 5 sessions, and the files past that are named, never dropped. A line
naming a file outside the config root is under `skipped lines:`, because the index cannot hold it.

## 2. Spawn one Haiku agent per session

For each `session` line, in one message so they run in parallel, call the Agent tool with
`subagent_type: "code-graph:refactor-scout"` (read-only by its tool list: `Read`, `Grep`, `Glob`) and
`model: "haiku"`, with this prompt:

> Read `<prompt file>` and follow it. Every path in it is relative to `<root>`, the repository. End your
> answer with its `PROPOSALS:` section and return only that section.

If the Agent tool or that agent is not available, print `refactor-scout: no scout agent, so no proposals`
and stop. Do not run the scan yourself or use another agent: that would spend this context and model, or
change the form the bench measured.

## 3. Print the result

Print, in this order:

1. The `ignored:`, `not scanned:` and `skipped lines:` lines from step 1, as they are.
2. For a session that failed or returned no `PROPOSALS:` line:
   `session <n> failed, not scanned: <its files>`.
3. If no session answered, print
   `nothing scanned: every session failed; this is not a clean result, the scout read no code` and no
   `PROPOSALS:` line. Otherwise pass the `PROPOSALS:` sections of every session that answered, as
   returned, to the CLI on stdin, and print its output as it is:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" scout --proposals <<'SCOUT_PROPOSALS'
   <the returned sections, one after another>
   SCOUT_PROPOSALS
   ```

   It prints `PROPOSALS:` and every `- <file path>: <kind>: <problem and change>` line with the path made
   relative to the git root (absolute, `./`, backticked and config-root-relative answers alike; `* ` and
   numbered bullets come out as `- ` lines), or `PROPOSALS: none`
   when every section was none. A path outside the repository is kept as given and named on an
   `outside the repository:` line. Keep every line, and do not judge, reword or rank them. On a non-zero
   exit print its stderr line and no `PROPOSALS:` line.

Then stop. The list is advisory and a person triages it. Do not edit code, create tasks, or hand a
proposal to any agent or worker.

## What the evidence covers

The bench (`docs/evals.md` in the code-graph repo, tickets 070 to 074) measured this scout on 6 cases
and 2 paid runs of one project, with confidence low to moderate. It gave more accurate proposals per
dollar than a Sonnet refactor pass (286 against 17.1 useful per dollar), and neither a Sonnet filter
nor a decided-against list earned its place.

- **Accurate is not valuable.** The audit confirmed any true claim, however minor, so the ratio
  measures accurate proposals. Whether acting on them pays was not measured.
- **Noise is real.** By a stricter count (070) the scout made 42 false findings against 23. An empty
  or short list does not prove the code is clean.
- **Not measured:** split scopes (bench scopes were 4 to 11 files, one session each), packing unrelated
  small groups into one session, epic-start or epic-end use, an arbitrary scope with no added neighbours
  (each bench scope held a change's files and the files next to them, and the prompt still says so),
  scopes wider than the epic's own work, and this session form. The bench ran plain Haiku sessions with
  the default system prompt, the prompt inline, and `Bash` and `Skill` beside `Read`, `Grep` and `Glob`.
  This agent has a one-line system prompt, gets its prompt from a file, and has only the three read tools.
- **Repeats are expected.** The scout has no memory of what was declined, so a run at epic end may
  repeat what a person declined at epic start.
