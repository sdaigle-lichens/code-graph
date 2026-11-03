// Reference solution for bench case t4-test-channel-lanes (051). Never shown to a model.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { pendingLanes, sweep, CHANNEL_AGE_CAP_MS } from "../../src/core/handoff-channels.js";

function fixture() {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-ref-"));
  fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
  return { proj, cleanup: () => fs.rmSync(proj, { recursive: true, force: true }) };
}
function lane(proj: string, receiver: string, file: string, content: string, ageMs = 0) {
  const dir = path.join(proj, ".claude", "channels", receiver);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, file);
  fs.writeFileSync(p, content);
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(p, when, when);
  return p;
}
function liveSession(proj: string, id: string, runId: string | null) {
  const dir = path.join(proj, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ workflow: null, generated_instances: [], run_id: runId }));
}
const stamped = (runId: string, body = "payload") => `<!-- maestro:run_id=${runId} -->\n${body}`;

describe("pendingLanes", () => {
  it("splits current from stranded by the live sessions' run ids", () => {
    const f = fixture();
    try {
      liveSession(f.proj, "s1", "run-live");
      lane(f.proj, "test", "backend.1.md", stamped("run-live"));
      lane(f.proj, "test", "frontend.1.md", stamped("run-dead"));
      lane(f.proj, "test", "mobile.1.md", "no stamp at all");
      const [l] = pendingLanes(f.proj);
      assert.equal(l.receiver, "test");
      assert.equal(l.count, 3);
      assert.equal(l.current, 1);
      assert.equal(l.stranded, 2);
    } finally { f.cleanup(); }
  });

  it("with no live session every entry is stranded", () => {
    const f = fixture();
    try {
      lane(f.proj, "reviewer", "backend.1.md", stamped("run-x"));
      const [l] = pendingLanes(f.proj);
      assert.equal(l.current, 0);
      assert.equal(l.stranded, 1);
    } finally { f.cleanup(); }
  });

  it("run ids of every live session count, and a session with no run id adds nothing", () => {
    const f = fixture();
    try {
      liveSession(f.proj, "s1", "run-a");
      liveSession(f.proj, "s2", "run-b");
      liveSession(f.proj, "s3", null);
      lane(f.proj, "test", "a.1.md", stamped("run-a"));
      lane(f.proj, "test", "b.1.md", stamped("run-b"));
      const [l] = pendingLanes(f.proj);
      assert.equal(l.current, 2);
      assert.equal(l.stranded, 0);
    } finally { f.cleanup(); }
  });

  it("reports the oldest age and skips empty lanes and the consumed dir", () => {
    const f = fixture();
    try {
      const now = Date.now();
      lane(f.proj, "test", "a.1.md", "x", 1000);
      lane(f.proj, "test", "b.1.md", "y", 90_000);
      fs.mkdirSync(path.join(f.proj, ".claude", "channels", "empty"), { recursive: true });
      lane(f.proj, ".consumed", "z.1.md", "gone");
      const lanes = pendingLanes(f.proj, now);
      assert.equal(lanes.length, 1);
      assert.ok(lanes[0].oldestAgeMs >= 89_000 && lanes[0].oldestAgeMs < 95_000, String(lanes[0].oldestAgeMs));
    } finally { f.cleanup(); }
  });
});

describe("sweep", () => {
  it("empties .consumed and removes lane files past the age cap, keeping fresher ones", () => {
    const f = fixture();
    try {
      const consumed = path.join(f.proj, ".claude", "channels", ".consumed", "test");
      fs.mkdirSync(consumed, { recursive: true });
      fs.writeFileSync(path.join(consumed, "old.1.md"), "c");
      const old = lane(f.proj, "test", "old.1.md", "o", CHANNEL_AGE_CAP_MS + 3_600_000);
      const fresh = lane(f.proj, "test", "fresh.1.md", "f", CHANNEL_AGE_CAP_MS - 3_600_000);
      const res = sweep(f.proj);
      assert.equal(fs.existsSync(path.join(consumed, "old.1.md")), false);
      assert.equal(fs.existsSync(old), false);
      assert.equal(fs.existsSync(fresh), true);
      assert.equal(res.removed.length, 2);
    } finally { f.cleanup(); }
  });

  it("honours an injected age cap and clock", () => {
    const f = fixture();
    try {
      const p = lane(f.proj, "scribe", "x.1.md", "x", 10_000);
      assert.equal(sweep(f.proj, { ageCapMs: 60_000 }).removed.length, 0);
      assert.equal(fs.existsSync(p), true);
      assert.equal(sweep(f.proj, { ageCapMs: 5_000 }).removed.length, 1);
    } finally { f.cleanup(); }
  });
});
