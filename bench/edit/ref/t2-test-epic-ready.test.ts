// Reference solution for bench case t2-test-epic-ready (044). Never shown to a model: bench/edit-check.mjs
// copies it into a fresh workspace to prove the grader (green on the original, every mutant killed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createEpic, linkTasks, addWorker, readyTasks } from "../../src/core/epics.js";
import { claimTask, tasksDirFor } from "../../src/core/tasks.js";

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-ready-"));
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  createEpic(root, "e1");
  return root;
}
function task(root: string, name: string, blockers: string[] = []): void {
  const by = blockers.length ? blockers.map((b) => `\`${b}\``).join("\n") : "None";
  fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", name), `# ${name}\n\n## Blocked by\n\n${by}\n`);
}
function session(root: string, id: string, ageMs = 0): void {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "log.jsonl");
  fs.writeFileSync(log, "{}\n");
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(log, t, t);
  }
}
const readyNames = (root: string, cap?: number) => readyTasks(root, "e1", cap).ready.map((t) => t.filename);

test("a tracker 'ready' whose blocker is not done is never listed", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md", ["001-a.md"]);
  linkTasks(root, "e1", ["001-a.md", "002-b.md"]);
  const f = path.join(root, ".claude", "maestro-tasks", "status.json");
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  s["002-b.md"].status = "ready"; // stale, hand-edited
  fs.writeFileSync(f, JSON.stringify(s));
  assert.deepEqual(readyNames(root), ["001-a.md"]);
});

test("a live claim makes a task running, a dead claim does not hide it", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md");
  linkTasks(root, "e1", ["001-a.md", "002-b.md"]);
  session(root, "live-1");
  const dir = tasksDirFor(root);
  claimTask(root, dir, "001-a.md", "live-1");
  claimTask(root, dir, "002-b.md", "gone-2"); // no session directory: dead
  const view = readyTasks(root, "e1");
  assert.deepEqual(view.running.map((r) => r.filename), ["001-a.md"]);
  assert.deepEqual(view.ready.map((t) => t.filename), ["002-b.md"]);
});

test("a claim whose session log is idle past the claim cap does not count as running", () => {
  const root = project();
  task(root, "001-a.md");
  linkTasks(root, "e1", ["001-a.md"]);
  session(root, "idle-1", 60 * 60 * 1000);
  claimTask(root, tasksDirFor(root), "001-a.md", "idle-1", Date.now() - 60 * 60 * 1000);
  const view = readyTasks(root, "e1");
  assert.deepEqual(view.running, []);
  assert.deepEqual(view.ready.map((t) => t.filename), ["001-a.md"]);
});

test("a task recorded on a worker with no live claim is pending and takes a slot", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md");
  linkTasks(root, "e1", ["001-a.md", "002-b.md"]);
  addWorker(root, "e1", "e1-001", "001-a.md");
  const view = readyTasks(root, "e1", 3);
  assert.deepEqual(view.pending, [{ filename: "001-a.md", worker: "e1-001" }]);
  assert.deepEqual(view.ready.map((t) => t.filename), ["002-b.md"]);
  assert.equal(view.slots, 2);
  assert.equal(readyTasks(root, "e1", 1).slots, 0);
});
