#!/usr/bin/env node
// The orchestrator's Step 0, moved out of the prompt and into the harness.
//
// It used to be two bash calls and ~40 lines of prose at the top of every single orchestration:
// run maestro-check-runtime.cjs, obey its `instruction`, then run `maestro-agent-forks.cjs list`
// and mention anything that diverged. Every run paid for that, including the overwhelmingly common
// one where the answer is "nothing to do" — and the prose had to be re-read and re-obeyed correctly
// each time. As a hook the healthy path costs NOTHING: no tool call, no output, no tokens.
//
// TWO EVENTS, one script, because there are two ways into the orchestrator:
//
//   UserPromptExpansion (matcher: the command name) — the user typed `/maestro`. This is the path
//     the skill is written for and the one that fires almost always. It runs BEFORE the expanded
//     prompt reaches the model, which is what makes a hard stop possible at all.
//   PreToolUse (matcher: Skill) — the model invoked the maestro skill itself, via the Skill tool
//     (a route from another skill, say). UserPromptExpansion never fires for that, so without this
//     second registration the check would silently not happen on that path.
//
// The two events differ in how a hook talks back, and the difference is not cosmetic:
//   - UserPromptExpansion is one of the few events whose PLAIN STDOUT is added to the model's
//     context, so the update path just prints its sentence.
//   - PreToolUse is not, so the same sentence goes out as `hookSpecificOutput.additionalContext`.
// Getting this backwards produces a hook that "runs fine" and injects nothing.
//
// THE THREE ANSWERS, and what each becomes here:
//   continue → exit 0, no output at all. The whole point.
//   update   → exit 0 + the instruction as context. The model runs /maestro-update and carries on.
//   install  → exit 2. On BOTH events that BLOCKS: the `/maestro` expansion never reaches the
//              model, or the Skill call is refused. That is a genuine improvement on the prose it
//              replaces, which could only ask the model to stop and hope it did.
//
// The forked-agent check rides along on the same run (it was the second of the two bash calls) and
// is strictly informational: it WRITES NOTHING, and names diverged agents in one line so a stale
// fork is visible rather than silently running last year's version of an agent. `/maestro-update`
// is where that review is actually done.
//
// Never throws, and every failure degrades to "say nothing": a hook that cannot answer must not be
// the reason a user can't invoke their orchestrator.

const { readStdin, projectOwnsHook } = require("./lib/maestro-session.cjs");
const { checkRuntime, INSTRUCTIONS } = require("./maestro-check-runtime.cjs");

/** The orchestrator skill's own command/skill id. A project skill, so never plugin-namespaced. */
const ORCHESTRATOR = "maestro";

/**
 * Is `name` the orchestrator skill?
 *
 * Tolerates the shapes a command or skill id arrives in — a leading `/`, a `plugin:skill`
 * namespace — while staying an EXACT match on the last segment, so the plugin's own
 * `maestro-install` / `maestro-update` / `maestro-help` commands don't trip a prefix test.
 */
function isOrchestrator(name) {
  if (typeof name !== "string") return false;
  const bare = name.replace(/^\//, "");
  const last = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
  return last === ORCHESTRATOR;
}

/** Does this payload represent an invocation of the orchestrator skill? */
function invokesOrchestrator(p) {
  if (p.hook_event_name === "UserPromptExpansion") return isOrchestrator(p.command_name);
  if (p.hook_event_name === "PreToolUse") {
    if ((p.tool_name || "") !== "Skill") return false;
    const input = p.tool_input || {};
    return isOrchestrator(input.skill || input.name || input.skill_name);
  }
  return false;
}

/**
 * One line naming the forked agents that have fallen behind their template, or null.
 *
 * Read-only by construction — `computeAgentSync` is the same function the desktop app's /agents
 * review card asks, and it writes nothing. Any failure (an older runtime with no
 * lib/maestro-agent-sync.cjs, a project with no forks) is simply nothing to say.
 */
async function forkNotice(projectDir) {
  try {
    const { computeAgentSync } = require("./lib/maestro-agent-sync.cjs");
    const summary = await computeAgentSync(projectDir);
    if (!summary || !Array.isArray(summary.diverged) || summary.diverged.length === 0) return null;
    return (
      `Forked agents behind their template: ${summary.diverged.join(", ")}. ` +
      "Say so in one line and carry on with the workflow — do not stop to fix it. " +
      "Only if the user asks, run `maestro-agent-forks.cjs diff <agent>` and then update/keep/detach; " +
      "/maestro-update is where that review is done properly."
    );
  } catch {
    return null;
  }
}

/** Emit `text` as context for this event, which is not the same call on both. */
function inject(event, text) {
  if (event === "PreToolUse") {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text } })
    );
    return;
  }
  // UserPromptExpansion: plain stdout IS the context channel.
  process.stdout.write(text + "\n");
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  if (!invokesOrchestrator(p)) process.exit(0);

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so the readiness check
  // doesn't run (and speak) twice. A no-op in the copy installed into the project.
  // See apps/maestro/src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) process.exit(0);

  let result;
  try {
    result = checkRuntime(cwd);
  } catch {
    process.exit(0); // a check that cannot answer must not block the orchestrator
  }

  if (result.action === "install") {
    // Exit 2 blocks on both events. This sentence is read by a PERSON, not obeyed by an agent —
    // hence its own wording rather than INSTRUCTIONS.install, which addresses the model.
    process.stderr.write(
      `Maestro is not ready for this project: ${result.reason}. Run /maestro-install ` +
        `(or, if this project is already set up, /maestro-update) and try again.\n`
    );
    process.exit(2);
  }

  const lines = [];
  if (result.action === "update") {
    lines.push(`Maestro readiness check: ${result.reason}. ${INSTRUCTIONS.update}`);
  }
  const forks = await forkNotice(cwd);
  if (forks) lines.push(forks);

  // `continue` with nothing forked says nothing at all, which is the case this hook exists for.
  if (lines.length > 0) inject(p.hook_event_name, lines.join(" "));
  process.exit(0);
})().catch(() => process.exit(0));
