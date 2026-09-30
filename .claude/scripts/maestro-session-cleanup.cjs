#!/usr/bin/env node
// SessionEnd hook — the PROJECT-LOCAL cleanup, copied into <project>/.claude/scripts/ by the
// desktop app's installer (apps/maestro/src/core/install.ts).
//
// It removes ONLY THE ENDING SESSION'S state (`064`): the directory
// .claude/maestro_sessions/<session_id>/, plus the three pre-`064` flat files
// (maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json) if an older
// runtime left them behind. A SIBLING session's directory is never touched — before `064` this
// hook deleted the one shared log out from under a concurrent session mid-run, which is half of
// what that task exists to fix. With no session id resolvable it removes nothing at all: a
// SessionEnd that cannot say which session it is has no business deleting anyone's state.
// The source of truth (.claude/maestro.json) and the orchestrator skill are kept.
//
// Then (`036`) it SWEEPS `.claude/channels/` — retiring `.consumed/` outright and aging out
// anything left in a live lane past the cap, via `sweep()` in
// apps/maestro/src/core/handoff-channels.ts (re-exported through lib/maestro-session.cjs, so this
// script and the delivery hook cannot disagree about what "too old" means). A channel file is
// deliberately NOT flushed here the way the three ephemeral files above are: a lane the receiving
// agent hasn't been invoked yet (the routine case for an abandoned `human review` stop) still has
// to survive SessionEnd, or the whole feature loses its point.
//
// Why this exists next to maestro-session-cleanup.sh, now that both do the same thing: the .sh
// runs from the plugin, this runs from the project, and node rather than bash is what makes the
// project-local copy portable — the .sh shells out to python3 to parse the hook payload, which a
// project cannot assume is installed.
//
// Reads the hook payload on stdin; no-op when it carries no cwd.

const path = require("path");
const { readStdin, sweep, resolveSessionId, removeSessionState } = require("./lib/maestro-session.cjs");

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const cwd = payload.cwd;
  if (!cwd) return;
  try {
    // `064`: the payload's own `session_id` first, CLAUDE_CODE_SESSION_ID second, and nothing at
    // all when neither resolves. `removeSessionState` owns the "only mine, plus the legacy flat
    // files" rule so this hook and its bash twin cannot disagree about what SessionEnd deletes.
    removeSessionState(path.join(cwd, ".claude"), resolveSessionId(payload));
  } catch {
    // A session file we cannot delete is not worth failing the session's exit over.
  }
  try {
    sweep(cwd);
  } catch {
    // Same discipline as the deletions above — not worth failing the session's exit over.
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
