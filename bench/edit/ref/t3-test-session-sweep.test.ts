// Reference solution for bench case t3-test-session-sweep (051). Never shown to a model: bench/edit-check.mjs
// copies it in to prove the grader gives full marks to a good suite.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sweepStaleSessions, deleteSession, SESSION_SWEEP_IDLE_CAP_MS } from "../../src/core/session-sweep.js";

const DAY = SESSION_SWEEP_IDLE_CAP_MS;
const HOUR = 3_600_000;

function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-ref-"));
  const proj = path.join(tmp, "proj");
  fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
  return { tmp, proj, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
const dirOf = (proj: string, id: string) => path.join(proj, ".claude", "maestro_sessions", id);
function touch(p: string, ageMs: number) {
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(p, when, when);
}
function makeSession(proj: string, id: string, ageMs: number, files = ["log.jsonl", "session.json"]) {
  const dir = dirOf(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f), "{}\n");
    touch(path.join(dir, f), ageMs);
  }
  touch(dir, ageMs);
  return dir;
}
const noEnv = {};

describe("sweepStaleSessions", () => {
  it("removes a session idle past 24h and keeps one idle for 2h", () => {
    const f = fixture();
    try {
      const old = makeSession(f.proj, "old", DAY + HOUR);
      const recent = makeSession(f.proj, "recent", 2 * HOUR);
      const res = sweepStaleSessions([f.proj], { env: noEnv });
      assert.equal(res.count, 1);
      assert.deepEqual(res.removed, [{ projectRoot: f.proj, sessionId: "old" }]);
      assert.equal(fs.existsSync(old), false);
      assert.equal(fs.existsSync(recent), true);
    } finally { f.cleanup(); }
  });

  it("uses the newest file in the directory: a fresh session.json keeps an old log alive", () => {
    const f = fixture();
    try {
      const dir = makeSession(f.proj, "mixed", DAY + HOUR);
      touch(path.join(dir, "session.json"), 60_000);
      touch(dir, DAY + HOUR);
      sweepStaleSessions([f.proj], { env: noEnv });
      assert.equal(fs.existsSync(dir), true);
    } finally { f.cleanup(); }
  });

  it("never removes the calling session, however old", () => {
    const f = fixture();
    try {
      const own = makeSession(f.proj, "me", DAY + 5 * HOUR);
      const other = makeSession(f.proj, "them", DAY + 5 * HOUR);
      sweepStaleSessions([f.proj], { env: { CLAUDE_CODE_SESSION_ID: "me" } });
      assert.equal(fs.existsSync(own), true);
      assert.equal(fs.existsSync(other), false);
    } finally { f.cleanup(); }
  });

  it("keeps a session whose mtimes are in the future (clock skew)", () => {
    const f = fixture();
    try {
      const dir = makeSession(f.proj, "skew", -(3 * DAY));
      sweepStaleSessions([f.proj], { env: noEnv });
      assert.equal(fs.existsSync(dir), true);
    } finally { f.cleanup(); }
  });

  it("sweeps a session that moved into a worktree: both directories go, the worktree stays", () => {
    const f = fixture();
    try {
      const wt = path.join(f.tmp, "wt");
      fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
      const wtDir = makeSession(wt, "wts", DAY + HOUR);
      const mainDir = dirOf(f.proj, "wts");
      fs.mkdirSync(mainDir, { recursive: true });
      fs.writeFileSync(path.join(mainDir, "worktree.json"), JSON.stringify({ path: wt }));
      touch(path.join(mainDir, "worktree.json"), DAY + HOUR);
      touch(mainDir, DAY + HOUR);
      const res = sweepStaleSessions([f.proj], { env: noEnv });
      assert.equal(res.count, 1);
      assert.equal(fs.existsSync(wtDir), false);
      assert.equal(fs.existsSync(mainDir), false);
      assert.equal(fs.existsSync(wt), true);
    } finally { f.cleanup(); }
  });
});

describe("deleteSession", () => {
  it("uses the 15-minute claim cap, not the 24h sweep cap", () => {
    const f = fixture();
    try {
      const idle = makeSession(f.proj, "idle1h", HOUR);
      const busy = makeSession(f.proj, "busy", 5 * 60_000);
      assert.equal(sweepStaleSessions([f.proj], { env: noEnv }).count, 0);
      assert.deepEqual(deleteSession([f.proj], f.proj, "busy", { env: noEnv }), { removed: false, reason: "running" });
      assert.equal(fs.existsSync(busy), true);
      assert.deepEqual(deleteSession([f.proj], f.proj, "idle1h", { env: noEnv }), { removed: true });
      assert.equal(fs.existsSync(idle), false);
    } finally { f.cleanup(); }
  });

  it("refuses the own session, an unknown project, a bad id and a missing session", () => {
    const f = fixture();
    try {
      makeSession(f.proj, "me", 3 * HOUR);
      assert.deepEqual(deleteSession([f.proj], f.proj, "me", { env: { CLAUDE_CODE_SESSION_ID: "me" } }), { removed: false, reason: "own-session" });
      assert.deepEqual(deleteSession([f.proj], path.join(f.tmp, "elsewhere"), "me", { env: noEnv }), { removed: false, reason: "invalid" });
      assert.deepEqual(deleteSession([f.proj], f.proj, "../x", { env: noEnv }), { removed: false, reason: "invalid" });
      assert.deepEqual(deleteSession([f.proj], f.proj, "nope", { env: noEnv }), { removed: false, reason: "not-found" });
    } finally { f.cleanup(); }
  });
});
