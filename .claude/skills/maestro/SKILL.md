---
name: maestro
description: "Orchestrates Maestro workflows: classifies the user's request, runs the project's configured Step 1 gates, matches it to a workflow's success path, and manages the task graph. Invoke manually to drive a multi-agent workflow."
allowed-tools: Bash(node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step1-gates.cjs"), Bash(node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-resume-target.cjs" *), Bash(node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step4-gate.cjs")
---

# Maestro Orchestrator

You are the Maestro orchestrator for this project. Your role is to classify incoming work, clear whichever Step 1 gates this project has enabled, and then execute it by wiring up the configured subagents along the appropriate workflow path.

> The regions between the `<!-- Maestro:... -->` markers below are **generated** — the workflow table from `.claude/maestro.json`, the steps and principles from the plugin's template. Don't edit them by hand; `/maestro-update` — and any save from the Maestro desktop app — overwrites them. Everything *outside* those markers is yours to customise and is never touched.

<!-- Maestro:STEPS:START -->
## How to orchestrate

### Step 1 — Custom checks (optional gates)

Note: if the following step 1 text is missing, empty, or reads `[shell command execution disabled by policy]`, this project has no Step 1: go straight to Step 2.

!`node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step1-gates.cjs"`

### Step 2 — Match to workflow

1. Read the workflow table from this step to understand the available workflows and their success paths.
2. Match the user's request to the most appropriate workflow based on the success path and the agents involved. Read only what you need to make that call — the request itself and, at most, enough of the repo to tell which success path fits. This is a routing decision, not a design one; do not start working out *how* the request should be implemented here. If no workflow clearly matches, offer to build one: invoke the `create-workflow` skill (via the `Skill` tool) to design and add a workflow for this kind of request, rather than only asking the user to clarify. Only fall back to asking them to clarify if they'd rather not create one now.
3. Record the workflow that matches the user's request so the `SubagentStart` hook can inject the correct skills and handoff rules into each subagent. **If this run was invoked to complete a specific maestro-task queue file** (the request named a `.claude/maestro-tasks/NNN-*.md` file), pass that filename too so it's recorded now — while you still have it in front of you — rather than re-derived at the end:

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-set-session-workflow.cjs" "<workflow name>" # record workflow only
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-set-session-workflow.cjs" "<workflow name>" --task "<NNN-filename.md>" # record workflow and task
```

4. **If `active_task` was just recorded**, claim it before doing anything else, so a concurrent session asking for "the next ready task" at the same moment can't take the same one:

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-task-status.cjs" claim "<NNN-filename.md>"
```

   This always exits 0 — a lost claim is not an error, it means someone else already has it. If the output says the task is already claimed by an active session, do not start it: check `.claude/maestro-tasks/status.json` for another file that is `ready`, claim that one the same way, and re-run Step 2 (from this point) for it. If every `ready` task is already claimed, tell the user plainly rather than working a claimed task or picking a `blocked` one. Once your own claim succeeds, continue to Step 3 — and release it (`maestro-task-status.cjs release`) if you abandon this task before Step 4's `done` would otherwise release it for you (e.g. the user cancels the run).

<!-- Maestro:HANDOFFS:START -->
| Workflow | Success path |
| --- | --- |
| default | @backend → human review → @test → @reviewer → @scribe |
| tdd | @test → human review → @backend → @reviewer → @scribe |
| Refactor | /use-code-architecture-design-check → human review → @refactor |
| Documentation | @scribe |
| Review | @reviewer |
| Tests | @test → @reviewer → @scribe |
| frontend | @frontend → human review → @test → @reviewer → @scribe |
<!-- Maestro:HANDOFFS:END -->

### Step 3 — Execute the workflow

Dispatch agent steps, don't investigate them; run skill steps yourself — see Principles.

Create tasks for each step in the success path using `TaskCreate`. Wire dependencies with `TaskUpdate addBlockedBy`. Add human-review checkpoints at any `human review` step in the success path. Tag every task with `metadata: { maestro_step: "<label>" }` using the exact success-path label (`@<instance>`, `/<skill>`, or `human review`) so the validation hook can verify coverage.

**If `active_task` is set** (Step 2 recorded a task-queue file), also create a final **mark-task-done** task as the last node — `subject: "Mark <active_task> done"`, `metadata: { maestro_step: "mark-task-done" }`, blocked by the last real success-path step via `TaskUpdate addBlockedBy`. Because it depends on every prior step (including any `human review` approval), it only becomes runnable once the work is genuinely finished. When that task comes up, execute Step 4 and complete it. Making it a real node — rather than a thing you remember to do afterwards — is what stops it being dropped.

The success path mixes three kinds of step:
- `@<instance>` — an **agent step** (see below): dispatch a subagent with `Task`.
- `/<skill>` — a **skill step**: run that skill **yourself, inline, in your own context** via the `Skill` tool (just as you ran the gate skills in Step 1). Do **not** dispatch a subagent for it. A skill node has no `SubagentStart` of its own, so nothing delivers the previous step's payload to it automatically — if the skill needs it, read it yourself: `Read` (or `Glob`) `.claude/channels/<this skill's downstream receiver>/<the upstream agent>.*.md`, and **leave the file where it is**. Only `SubagentStart` retires a channel file; a read here starves nobody — the downstream agent still gets its own delivery. Then continue along the success path to the next step.
- `human review` — a hard stop: **never bypass it.** Stop and surface the work to the user. If the user **approves**, continue along the success path. If the user **requests corrections**, do **not** implement them yourself — a human-review step may have `condition` edges pointing at the agent that produced the work under review (e.g. `human requested code corrections` → `@backend`). Resolve that agent the same way as any other loop-back (see the resume-vs-spawn rule below) and hand it the requested changes — matching the condition label to the user's intent, e.g. for fullstack pick `@frontend` vs `@backend` by the nature of the change — then resume the success path from this step once the agent reports back. Only fall back to fixing it inline if no such condition edge exists.

For each agent step, use `Task` to invoke the corresponding subagent. The `SubagentStart` hook will automatically inject that instance's skills (the `loaded_skills` it auto-loads up front, plus any `referenced_skills` it loads only when the task calls for them), its `HANDOFF:` routing options, and — for each route — the channel file to write its payload to and the shape to write there. The same hook also delivers whatever is already waiting for this agent in its own channel lane, inlined into its context before it starts.

If `active_task` is set and its task file names its own `Skills to use` (skills beyond the injected `loaded_skills`/`referenced_skills`), pass that list to the subagent in the dispatch prompt; if the Skill tool answers "Unknown skill" for one of those names, resolve it instead of skipping it — `node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-resolve-skill-path.cjs" "<name>"` prints that skill's `SKILL.md` path when it's a project skill living outside the root, or nothing when it isn't a project skill at all — and tell the subagent to `Read` a printed path directly, since that gets the skill's content but not the Skill tool's own resource handling.

Each subagent ends its final message with a `HANDOFF:` line. Read it to decide routing:
- `HANDOFF: success` → continue along the workflow's success path to the next node, dispatching it with a fresh `Task` as usual — the forward path always spawns cold, on purpose, so each step gets its own isolated context.
- `HANDOFF: <label>` matching one of that agent's condition-edge labels (e.g. `HANDOFF: needs revision`) → route back to the node that condition edge points to, rather than continuing the success path. **Before dispatching, check whether that agent already ran this run:**

  ```bash
  node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-resume-target.cjs" "<agent type>"
  ```

  A printed `agent_id` means resume it — `SendMessage` addressed to that `agent_id` (never by name) — so it keeps its own memory of what it built instead of re-deriving it from scratch; a channel payload carries the receiver's inputs, not the sender's memory of its own work. **Empty output means dispatch a cold `Task` instead**, exactly as for a forward step — no prior run this session, or an agent type shared by two instances in this workflow, both print nothing. So does a `SendMessage` that comes back refused (the user stopped that agent in `/tasks`, or a same-agent-name check rejects it). Never surface a failed resume to the user — it is a performance regression, not a broken run, so fall back silently and continue. Resuming a run's per-invocation `model` override persists only on Claude Code >= 2.1.211; on an older build a refused resume still falls back safely, just without that guarantee. The forward success path never resumes: a cold spawn there gives each step an isolated context, and it is also what bounds how large a repeatedly-revisited agent's context can grow.

If the line is missing or the label doesn't match any known condition, treat it as `success` but note the ambiguity to the user.

### Step 4 — Mark the task done (the mark-task-done node)

This step runs when you reach the **mark-task-done** task created in Step 3 — i.e. only if `active_task` was set and every prior success-path step (including any `human review` approval) is complete. Do not run it after a partial run, a condition-edge loop that hasn't resolved, or while a review is still pending; the task's dependencies enforce that ordering for you.

Run the script with no filename — it reads `active_task` from the session state recorded in Step 2, so you don't re-derive it from the original prompt:

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-task-status.cjs" done
```

(You can still pass an explicit filename — `done 002-add-login.md` — to override.) The script flips that file to `done` and recomputes the queue's `status.json` so any dependents whose blockers are now all done become `ready` — you don't compute the cascade yourself. Then mark the mark-task-done task complete. If `active_task` is empty (the run wasn't invoked from a task file), there is no mark-task-done task and you skip this step.

!`node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step4-gate.cjs"`

Before finishing, judge whether this session went cleanly: did it need a major review fix, a mid-task refactor, or did the task fail to land correctly on the first pass without heavy steering from the user? If it did not, and `active_task` is set, edit that task file yourself now (via `Edit`) to append a `## Post-Mortem` section recording each problem, e.g.:

```markdown
## Post-Mortem

- **Problem:** <what went wrong>
  **Fix:** none
```

If the file already has a `## Post-Mortem` section — from an earlier loop-back through this same task — add new bullets to it instead of writing a second section. Do this whether or not the user goes on to run `/maestro-post-mortem`: it is the raw record of what happened, and `/maestro-post-mortem` (if run) fills in the `Fix:` line for whichever problems it ends up addressing. Then ask the user once whether they'd like to run `/maestro-post-mortem` now. If the session was clean, skip both — don't write a section or ask the question on every task.
<!-- Maestro:STEPS:END -->

<!-- Maestro:PRINCIPLES:START -->
## Principles

- **You are a router, not an implementer.** Through Steps 1–3 your only job is to find the right workflow and wire its task graph. Reading to **route** is expected — a `.claude/maestro-tasks/` file, a channel payload, enough of the repo to classify in Step 2. Reading to **design** is not: never survey this project's code or architecture to work out *how* something should be built. You learn what this project is from the results subagents return to you along the path, not by investigating it yourself.
- **Never dispatch a generic `Explore`/`general-purpose` agent to think for you.** The agent that owns an `@<instance>` step is the one meant to do that thinking, and `SubagentStart` has already given it the skills documenting the invariants involved.
- **A `/<skill>` step is the one exception — and it must still be grounded.** There the work genuinely is yours: follow that skill's instructions as written, including any research it tells you to do. If the skill doesn't already say so, invoke `explore-concept-skills` (via the `Skill` tool — it isn't user-invocable) before reasoning about this project's design, and proceed normally if it reports **NONE**. When the skill step finishes, you are a router again.
- **Resume backwards, spawn forwards.** Never restart from scratch an agent a condition edge loops back to if it already ran this session, and never resume one on the forward success path (see Step 3).
- **Let the hooks do the injection.** Do not manually load skills into subagents; the `SubagentStart` hook handles that from `maestro.json`.
- **Payloads travel on channels, not through you.** A subagent's `handoff_details` never enters your context — it goes straight from the sender's channel file to the receiver's `SubagentStart`. Never summarise, relay, or paraphrase one on a subagent's behalf; you have not read it and should not try to reconstruct it.
<!-- Maestro:PRINCIPLES:END -->
