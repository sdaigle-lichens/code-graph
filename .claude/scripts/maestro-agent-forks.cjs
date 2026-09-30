#!/usr/bin/env node
// Forked agents, from the terminal — the half of `031` the `maestro` and `maestro-update` skills
// drive. Same job as the `/agents` review card in the desktop app, and deliberately not a second
// implementation of it: every verdict, every diff and every write here comes out of
// `lib/maestro-agent-sync.cjs`, which is generated from `apps/maestro/src/core/agent-sync.ts`.
// That bundle in turn asks `decideSync` — the same function `report-sync.ts` asks — so the
// terminal and the app cannot disagree about whether a fork is stale.
//
//   node maestro-agent-forks.cjs list [--json]     what diverged, and why
//   node maestro-agent-forks.cjs diff <agent>      the body diff, plus both descriptions
//   node maestro-agent-forks.cjs update <agent>    take the new body, keep my name + description
//   node maestro-agent-forks.cjs keep <agent>      leave it; ask again when the template moves
//   node maestro-agent-forks.cjs detach <agent>    drop the provenance record; keep the file
//
// `list` and `diff` WRITE NOTHING. That is the point of the split, and it is why the skills run
// `list` unprompted and never anything else: a project's `.claude/agents/*.md` are often committed,
// so a diff nobody asked for is hard to explain. The three writing subcommands each touch exactly
// one agent, and only after the user has answered.
//
// Exits non-zero only on a genuine failure. "Nothing diverged" is exit 0 with a line saying so.

const path = require("path");

let lib = null;
let loadError = null;
try {
  lib = require("./lib/maestro-agent-sync.cjs");
} catch (err) {
  // Same defensive shape as maestro-check-runtime.cjs: a missing lib means this project's copied
  // runtime predates the file, which is a real answer ("run /maestro-update"), not a stack trace.
  loadError = err && err.message ? err.message : String(err);
}

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function fail(message, code = 1) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

/** One line per agent: the verdict, in words, with the version transition that caused it. */
function describe(entry) {
  const where =
    entry.sourceTier === "user"
      ? "~/.claude/agents"
      : `${entry.sourcePlugin || "a plugin"} ${entry.templateVersion || "(unversioned)"}`;
  if (entry.templateFile === null) return `${entry.agentName}: its template (${where}) is no longer installed`;
  if (entry.verdict === "materialize") return `${entry.agentName}: the fork's own file is missing`;
  if (entry.verdict === "refresh") {
    return `${entry.agentName}: update available from ${where}${
      entry.sourceTier === "plugin" ? ` (tracking ${entry.trackedVersion || "(unversioned)"})` : ""
    } — body untouched, safe to take`;
  }
  if (entry.verdict === "stale-customized") {
    return entry.templateAdvanced
      ? `${entry.agentName}: you edited its body AND ${where} moved on — nothing is overwritten automatically`
      : `${entry.agentName}: you edited its body; the template has not moved`;
  }
  return `${entry.agentName}: in step with ${where}`;
}

async function main() {
  if (!lib) fail(`Could not load lib/maestro-agent-sync.cjs (${loadError}). Run /maestro-update.`);

  const [command = "list", ...rest] = process.argv.slice(2);

  if (command === "list") {
    const summary = await lib.computeAgentSync(projectDir);
    if (rest.includes("--json")) {
      process.stdout.write(JSON.stringify(summary) + "\n");
      return;
    }
    if (summary.entries.length === 0) {
      process.stdout.write("No forked agents in this project.\n");
      return;
    }
    const n = summary.diverged.length;
    process.stdout.write(
      n === 0
        ? `${summary.entries.length} forked agent(s), all in step with their templates.\n`
        : `${n} forked agent(s) differ from their template: ${summary.diverged.join(", ")}\n`
    );
    for (const entry of summary.entries) process.stdout.write(`  - ${describe(entry)}\n`);
    if (n > 0) {
      process.stdout.write(
        "\nRun `diff <agent>` to see what would change, then `update`, `keep` or `detach` that agent.\n"
      );
    }
    return;
  }

  const agentName = rest[0];
  if (!agentName) fail(`Usage: maestro-agent-forks.cjs ${command} <agent>`);

  if (command === "diff") {
    const summary = await lib.computeAgentSync(projectDir);
    const entry = summary.entries.find((e) => e.agentName === agentName);
    if (!entry) fail(`"${agentName}" has no fork record in ${path.join(projectDir, ".claude", "agent-forks.json")}.`);
    process.stdout.write(`${describe(entry)}\n`);
    process.stdout.write(`  fork:     ${entry.file}\n`);
    process.stdout.write(`  template: ${entry.templateFile || "(missing)"}\n\n`);
    // Both descriptions, side by side with the body diff — a fork's body advances while its
    // description stays the user's, so the two can drift and the description ends up promising
    // something the new body no longer does. Not a blocker; only noticeable if both are on screen.
    process.stdout.write(`  your description:     ${entry.description || "(none)"}\n`);
    process.stdout.write(`  template description: ${entry.templateDescription || "(none)"}\n\n`);
    const text = lib.unifiedDiffText(entry.diff);
    process.stdout.write(lib.hasChanges(entry.diff) ? text + "\n" : "The body is identical to the template's.\n");
    return;
  }

  if (command === "update" || command === "keep" || command === "detach") {
    const result = await lib.applyAgentSync(projectDir, agentName, command);
    process.stdout.write(
      command === "update"
        ? `Took the template's body for ${agentName}; your name and description are unchanged. Wrote ${result.fileWritten}\n`
        : command === "keep"
          ? `Kept ${agentName} as it is. You will be asked again when its template moves.\n`
          : `Detached ${agentName}. Its file is untouched and Maestro no longer tracks it.\n`
    );
    return;
  }

  fail(`Unknown command "${command}". Use list, diff, update, keep or detach.`);
}

main().catch((err) => fail(err && err.message ? err.message : String(err)));
