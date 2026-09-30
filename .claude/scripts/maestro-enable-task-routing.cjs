#!/usr/bin/env node
// Auto-enables the Step 4 task-routing setting the first time /to-maestro-tasks is invoked in a
// session (`047`), so future Step 4 renders keep showing the directive from the prior task without
// the user having to find the checkbox in the app.
//
// Dual-registered exactly like maestro-step0.js, and for the same reason — there are two entrances
// to a skill invocation:
//
//   UserPromptExpansion (matcher: the command name) — the user typed `/to-maestro-tasks`.
//   PreToolUse (matcher: Skill) — the model invoked the skill itself through the Skill tool.
//
// Unlike maestro-step0.js, this hook injects NOTHING — no stdout, no additionalContext. It exists
// purely for the config write side effect, and must never fire for any other skill, in particular
// never for /maestro itself (whose own Step 0 hook shares both these events).
//
// The write follows the same "a hook that cannot answer must not take the session down with it"
// discipline every other Maestro hook follows: any failure reading or parsing .claude/maestro.json
// — missing file, corrupt JSON, anything unexpected — degrades to doing nothing and exiting 0 with
// no stderr. Already-true is also a no-op, both to avoid a redundant write and to narrow the
// window against a concurrent write from the app.

const fs = require("fs");
const path = require("path");
const { readStdin, projectOwnsHook } = require("./lib/maestro-session.cjs");

/** The skill this hook exists to detect an invocation of. A project skill, never plugin-namespaced. */
const ROUTE = "to-maestro-tasks";

/**
 * Is `name` the /to-maestro-tasks skill?
 *
 * Same tolerance as maestro-step0.js's `isOrchestrator`: a leading `/`, a `plugin:skill`
 * namespace, exact match on the last segment only — so a future plugin command that merely
 * contains "to-maestro-tasks" doesn't trip this.
 */
function isRoute(name) {
  if (typeof name !== "string") return false;
  const bare = name.replace(/^\//, "");
  const last = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
  return last === ROUTE;
}

/** Does this payload represent an invocation of /to-maestro-tasks? */
function invokesRoute(p) {
  if (p.hook_event_name === "UserPromptExpansion") return isRoute(p.command_name);
  if (p.hook_event_name === "PreToolUse") {
    if ((p.tool_name || "") !== "Skill") return false;
    const input = p.tool_input || {};
    return isRoute(input.skill || input.name || input.skill_name);
  }
  return false;
}

/**
 * Flip `use_maestro_tasks` to `true` in `<cwd>/.claude/maestro.json`, mutating nothing else.
 *
 * Every failure — no file, corrupt JSON, an unexpected shape — resolves to doing nothing, and no
 * file is ever created where none existed. Already `true` is also a no-op. Serialized exactly as
 * `writeConfig` does: `JSON.stringify(cfg, null, 2)`, no trailing newline.
 */
function enableTaskRouting(cwd) {
  const configPath = path.join(cwd, ".claude", "maestro.json");
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return;
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return;
  if (cfg.use_maestro_tasks === true) return;
  cfg.use_maestro_tasks = true;
  try {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
  } catch {
    // a hook that cannot answer must not take the session down with it
  }
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  if (!invokesRoute(p)) process.exit(0);

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  // Same arbitration maestro-step0.js uses: when the project registers its own copy of this hook,
  // the plugin's copy — running from the marketplace cache — stands down, so the two never race.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) process.exit(0);

  try {
    enableTaskRouting(cwd);
  } catch {
    // never take the session down over this
  }
  process.exit(0);
})().catch(() => process.exit(0));
