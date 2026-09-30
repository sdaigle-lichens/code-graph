#!/usr/bin/env node
// The readiness check: can this project orchestrate right now, and if not, which ONE command
// fixes it? Run by the maestro-step0 hook when the orchestrator skill is invoked — which is what
// `checkRuntime(projectDir)` is for. It is ALSO a CLI, for a human debugging a project by hand and
// for /maestro-install's own reporting; the orchestrator skill no longer runs it, or mentions it.
//
// It answers with two fields the caller reads and nothing else: `action`, one of three values,
// and `instruction`, the sentence to obey.
//
//   continue  — nothing to do; get on with the workflow.
//   install   — the project's Maestro config is missing or unusable. Run /maestro-install.
//   update    — the config is fine but what was rendered or copied from it is behind.
//               Run /maestro-update.
//
// Both exist so SKILL.md carries no branch table at all. There are more states here than
// behaviours, and the collapse belongs in code: prose that re-derives it is re-read at the top of
// every single orchestration, costs tokens on every run including the healthy one, and getting it
// subtly wrong either blocks a healthy project or lets a broken one run. The wording travels with
// the logic instead, so the two can never disagree. `reason` and the raw fields below it are for a
// human debugging why, and for `install` to quote back at the user.
//
// The name says "runtime" because that is what this checks, in the sense the `updating-maestro`
// skill uses the word: the project-local COPY of everything the plugin ships — scripts, the
// rendered orchestrator skill, and the maestro.json they read. Not just a version string.
//
// WHAT IT LOOKS AT, in order, because the cheapest and most fundamental failures come first:
//
//   1. .claude/maestro.json exists and is v3.       → else `install`
//   2. It actually configures workflows.            → else `install`
//   3. The orchestrator skill is on disk.           → else `install`
//   4. Every runtime script the skill INVOKES by     → else `update`
//      $CLAUDE_PROJECT_DIR path is copied beside
//      this one.
//   5. Its <!-- Maestro:HANDOFFS --> table matches   → else `update`
//      what maestro.json renders to TODAY.
//   6. maestro.json's stamped `runtimeVersion`      → else `update`
//      matches the plugin the marketplace last
//      pulled.
//
// Check 4 exists for one script in particular. `maestro-step1-gates.cjs` is named by the
// orchestrator's Step 1 as an INJECTED command (!`node …`), and an injected command that exits
// non-zero aborts the whole skill invocation — so on a project whose runtime predates that file,
// `/maestro` does not degrade, it fails outright, before the model sees a word of the body. This
// check is what is supposed to say "run /maestro-update" first. It is a presence test only: the
// script itself never fails, it only ever prints a line (see its header).
//
// Check 5 is the one nothing else catches. The orchestrator routes work by reading that table; a
// hand-edited maestro.json whose table was never re-rendered sends work down a path that is not
// the configured one, silently and forever. `handoffTable()` is imported from the renderer rather
// than reimplemented so the comparison can never drift from what a re-render would produce.
//
// Check 6 is the original purpose, and the reason it needs installed_plugins.json: a bare terminal
// session has no access to the app's checkout of plugins/maestro (it may not even be on this
// machine), so it can't read a plugin.json the way apps/maestro/src/core/install.ts's
// shippedRuntimeVersion() does. What it CAN read is the same thing the app's pluginHooksActive
// check reads: ~/.claude/plugins/installed_plugins.json, which names the version and installPath
// of whatever the marketplace last pulled — the version that would actually apply if the runtime
// were refreshed right now.
//
// Check 6 alone degrades to `continue` (with ok:false) when it cannot be answered: an unreadable
// installed_plugins.json, or the maestro plugin not installed via a marketplace on this machine at
// all (a project-local-only setup, or the app-only delivery path, has nothing here to compare
// against — that project's runtime is refreshed by the app instead). Checks 1–5 need nothing
// outside the project, so they always have an answer.
//
// Never throws, never writes anything — it only ANSWERS.

const fs = require("fs");
const path = require("path");

// Loaded defensively: both live in the same .claude/scripts/ the installer copies this file into,
// so a failure here means that copy is INCOMPLETE — a project installed before one of them joined
// the file list. That is a real answer ("run /maestro-update"), not a crash, and the orchestrator
// must never get a stack trace where it expects one line of JSON.
let handoffTable = null;
let extractRegion = null;
try {
  ({ handoffTable } = require("./maestro-render-orchestrator.cjs"));
  ({ extractRegion } = require("./lib/maestro-skill-regions.cjs"));
} catch {
  /* reported as `update` once the project checks below have had their say */
}

// Runtime scripts the orchestrator skill invokes BY PATH, so a project that lacks one cannot run
// the step that names it. `maestro-step1-gates.cjs` and `maestro-step4-gate.cjs` (`046`) are the
// sharp cases: both are injected with !`node …`, and a non-zero exit there aborts the invocation
// outright — every !`command` in the body expands before the model sees any of it, so a project
// missing either script fails on EVERY /maestro invocation, not just one that reaches Step 4.
const SKILL_INVOKED_SCRIPTS = [
  "maestro-step1-gates.cjs",
  "maestro-step4-gate.cjs",
  "maestro-set-session-workflow.cjs",
  "maestro-task-status.cjs",
];

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// The one sentence the caller acts on, written here rather than in SKILL.md. There is exactly
// one per action and every answer goes through this map, so no call site can word it differently,
// and the skill needs no branch table to re-derive from — it just does what `instruction` says.
//
// These are addressed to the MODEL. `install` has a second, user-facing wording in
// maestro-step0.js, because on that path the hook blocks the invocation outright and the sentence
// is read by a person rather than obeyed by an agent.
const INSTRUCTIONS = {
  continue: "Nothing to do. Carry on with the workflow, and say nothing about this check.",
  update: "Run /maestro-update first, then say in one line what it changed and carry on.",
  install:
    "Stop and end your turn. Tell the user Maestro is not ready for this project, quoting `reason`, and ask them to run /maestro-install. Do not improvise a workflow.",
};

/**
 * The whole answer for `projectDir`: `{ action, instruction, ... }`. Never throws.
 *
 * Written as one function with early returns rather than as top-level script flow so the hook can
 * `require()` it — the alternative was spawning this file and parsing its stdout from a hook that
 * already runs inside node.
 */
function checkRuntime(projectDir) {
  const answer = (value) => {
    const { action, ...rest } = value;
    return { action, instruction: INSTRUCTIONS[action], ...rest };
  };

  // --- 1. the config exists -----------------------------------------------------------------
  const config = readJsonSafe(path.join(projectDir, ".claude", "maestro.json"));
  if (!config || config.version !== 3) {
    return answer({
      action: "install",
      ok: true,
      reason: "no .claude/maestro.json — Maestro is not configured for this project",
    });
  }

  // --- 2. it configures something ------------------------------------------------------------
  // A seeded config always has both. Empty means a partial install, or a hand-edit that emptied it;
  // either way the handoff table below renders to its placeholder and the orchestrator has no path
  // to follow, so it must say so rather than improvise one.
  const workflows = Array.isArray(config.workflows) ? config.workflows : [];
  const instances = Array.isArray(config.workflow_instances) ? config.workflow_instances : [];
  if (workflows.length === 0 || instances.length === 0) {
    return answer({ action: "install", ok: true, reason: "maestro.json configures no workflows" });
  }

  // --- 3, 4 & 5. the rendered orchestrator matches the config, and its scripts are all here ---
  const skillPath = path.join(projectDir, ".claude", "skills", "maestro", "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    return answer({ action: "install", ok: true, reason: "the orchestrator skill is not installed" });
  }

  // Scripts the SKILL names by $CLAUDE_PROJECT_DIR path. Missing means the project's copied
  // runtime predates them, which for the injected one is fatal rather than degrading — see the
  // header. Same family of answer as the `require` failure below: an incomplete copy, fixed by
  // /maestro-update.
  const missingScript = SKILL_INVOKED_SCRIPTS.find(
    (name) => !fs.existsSync(path.join(projectDir, ".claude", "scripts", name))
  );
  if (missingScript) {
    return answer({
      action: "update",
      ok: true,
      reason: `the project's copied runtime is missing .claude/scripts/${missingScript}`,
    });
  }

  if (!handoffTable || !extractRegion) {
    return answer({ action: "update", ok: true, reason: "the project's copied runtime scripts are incomplete" });
  }

  let renderedHandoffs = null;
  try {
    renderedHandoffs = extractRegion(fs.readFileSync(skillPath, "utf8"), "HANDOFFS");
  } catch {
    renderedHandoffs = null;
  }
  const expectedHandoffs = handoffTable(config);
  if (renderedHandoffs === null || renderedHandoffs.trim() !== expectedHandoffs.trim()) {
    return answer({
      action: "update",
      ok: true,
      reason:
        renderedHandoffs === null
          ? "the orchestrator skill has no Maestro:HANDOFFS region to render into"
          : "the handoff table no longer matches maestro.json",
    });
  }

  // --- 5. the copied runtime is the version the plugin ships ---------------------------------
  const installedPluginsPath = path.join(process.env.HOME || "", ".claude", "plugins", "installed_plugins.json");
  const installedPlugins = readJsonSafe(installedPluginsPath);
  const entries = installedPlugins && installedPlugins.plugins ? installedPlugins.plugins : {};

  // Keys are "<pluginName>@<marketplace>". Prefer an install scoped to THIS project over a global
  // one, mirroring apps/maestro/src/core/install.ts's pluginHooksActive — but any match is enough to
  // answer the question, since every install of the plugin ships the same runtime files.
  let match = null;
  for (const [key, installs] of Object.entries(entries)) {
    const pluginName = key.includes("@") ? key.slice(0, key.lastIndexOf("@")) : key;
    if (pluginName !== "maestro" || !Array.isArray(installs)) continue;
    for (const install of installs) {
      if (!install || !install.installPath || !install.version) continue;
      const scoped = install.projectPath && path.resolve(install.projectPath) === path.resolve(projectDir);
      if (!match || scoped) match = install;
    }
  }

  if (!match) {
    return answer({
      action: "continue",
      ok: false,
      stale: false,
      reason: "maestro plugin not installed on this machine — cannot compare runtime versions",
    });
  }

  const stale = config.runtimeVersion !== match.version;
  return answer({
    action: stale ? "update" : "continue",
    ok: true,
    stale,
    reason: stale
      ? `project runtime ${config.runtimeVersion || "(unstamped)"} is behind plugin ${match.version}`
      : undefined,
    installedVersion: config.runtimeVersion || null,
    runtimeVersion: match.version,
    pluginRoot: match.installPath,
  });
}

module.exports = { checkRuntime, INSTRUCTIONS };

// One line of JSON on stdout, exit 0 — the shape the skill's fallback command documents.
if (require.main === module) {
  process.stdout.write(JSON.stringify(checkRuntime(process.env.CLAUDE_PROJECT_DIR || process.cwd())) + "\n");
  process.exit(0);
}
