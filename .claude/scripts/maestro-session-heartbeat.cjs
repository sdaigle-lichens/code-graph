#!/usr/bin/env node
// SessionStart hook — keeps a Maestro session's task claim live for as long as the session is open
// (`141`), whether it is busy, waiting on the user, or running only inline steps.
//
// The log (`log.jsonl`) is only written by tool calls, and no hook fires while a session is blocked
// on a question, so neither can say "still open". This hook spawns a small DETACHED process that
// watches the claude process (this hook's parent) and touches `heartbeat` in the session's
// directory every minute; when claude is gone it zeroes that file's mtime and exits, so another
// session can take the claim at once. The hook itself returns immediately. The logic (one tick, the
// liveness rule claims read) is lib/maestro-session.cjs's session-heartbeat module
// (apps/maestro/src/core/session-heartbeat.ts).
//
// Two modes, one file:
//   node maestro-session-heartbeat.js                     the hook: reads the payload on stdin
//   node maestro-session-heartbeat.js --child <claudeDir> <sessionId> <watchPid>
//                                                         the detached heartbeat loop
//
// The child is re-spawned as `process.execPath __filename`, so it works the same from the plugin
// (`.js`) and from a project copy (`.cjs`). No `.claude/maestro.json`, no session id, or any
// failure: no output, exit 0 — a hook must never block a session's start.

const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const {
  readStdin,
  projectOwnsHook,
  resolveSessionId,
  isValidSessionId,
  ensureSessionPaths,
  heartbeatTargets,
  heartbeatTick,
  heartbeatIntervalMs,
  writeHeartbeatPid,
  watchedPid,
  parentProbe,
  processInfo,
  parsePsLine,
} = require("./lib/maestro-session.cjs");

// `/proc` where it exists (Linux), else one `ps` call (macOS) — used only to skip a wrapping shell
// when picking the process to watch.
function infoOf(pid) {
  const info = processInfo(pid);
  if (info) return info;
  try {
    return parsePsLine(
      execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    );
  } catch {
    return null;
  }
}

// A missing session directory may be a worktree move caught mid-copy rather than a final
// SessionEnd, so a "stop" with the parent still alive is confirmed once after this delay.
const CONFIRM_STOP_MS = 2000;

function runChild(claudeDir, sessionId, watchPid) {
  const parentAlive = parentProbe(watchPid);
  const intervalMs = heartbeatIntervalMs(process.env);
  const first = heartbeatTargets(claudeDir, sessionId);
  // Take ownership before the first tick: any older heartbeat for this session stops at its next.
  if (!first.pidFile || !writeHeartbeatPid(first.pidFile, process.pid)) process.exit(0);

  const tick = () => {
    const targets = heartbeatTargets(claudeDir, sessionId);
    return heartbeatTick({
      parentAlive: parentAlive(),
      ownPid: process.pid,
      pidFile: targets.pidFile,
      sessionDirs: targets.sessionDirs,
      now: Date.now(),
    });
  };

  const loop = () => {
    let result;
    try {
      result = tick();
    } catch {
      result = "continue";
    }
    if (result === "continue") return setTimeout(loop, intervalMs);
    if (!parentAlive()) process.exit(0);
    // Stopped with claude still running: re-check once before giving up.
    setTimeout(() => {
      let again;
      try {
        again = tick();
      } catch {
        again = "continue";
      }
      if (again === "continue") setTimeout(loop, intervalMs);
      else process.exit(0);
    }, CONFIRM_STOP_MS);
  };
  loop();
}

async function runHook() {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  if (!p || typeof p !== "object" || p.hook_event_name !== "SessionStart") return;
  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) return;

  // The plugin's copy stands down when the project registers its own copy of this hook.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) return;

  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) return;
  const sessionId = resolveSessionId(p);
  if (!sessionId) return;

  // Create the session directory now so the watcher has somewhere to write; the watcher itself never recreates one.
  if (!ensureSessionPaths(claudeDir, p)) return;

  const child = spawn(
    process.execPath,
    [__filename, "--child", claudeDir, sessionId, String(watchedPid(process.ppid, infoOf))],
    {
      detached: true,
      stdio: "ignore",
      cwd,
      env: process.env,
    }
  );
  child.on("error", () => {});
  child.unref();
}

const args = process.argv.slice(2);
if (args[0] === "--child") {
  const [, claudeDir, sessionId, pidArg] = args;
  const watchPid = Number(pidArg);
  if (!claudeDir || !path.isAbsolute(claudeDir) || !isValidSessionId(sessionId) || !Number.isInteger(watchPid)) {
    process.exit(0);
  }
  try {
    runChild(claudeDir, sessionId, watchPid);
  } catch {
    process.exit(0);
  }
} else {
  runHook()
    .catch(() => {})
    .then(() => process.exit(0));
}
