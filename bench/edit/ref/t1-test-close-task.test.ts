// Reference solution for bench case t1-test-close-task (044). Never shown to a model: bench/edit-check.mjs
// copies it into a fresh workspace to prove the grader (green on the original, every mutant killed).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeTask, listTasks, setTaskEpic, claimTask, tasksDirFor } from "../../src/core/tasks.js";

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "close-task-"));
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  return root;
}
function task(root: string, name: string, blockers: string[] = []): void {
  const by = blockers.length ? blockers.map((b) => `\`${b}\``).join("\n") : "None";
  fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", name), `# ${name}\n\nbody\n\n## Blocked by\n\n${by}\n`);
}
const status = (root: string) =>
  JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro-tasks", "status.json"), "utf8"));
function liveSession(root: string, id: string): void {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), "{}\n");
}
const claimFile = (root: string, name: string) => path.join(tasksDirFor(root), "claims", `${name}.json`);

test("closing a task cascades: sole dependent ready, a dependent with another open blocker stays blocked", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md", ["001-a.md"]);
  task(root, "003-c.md", ["001-a.md", "002-b.md"]);
  closeTask(root, "001-a.md");
  const s = status(root);
  assert.equal(s["001-a.md"].status, "done");
  assert.equal(s["002-b.md"].status, "ready");
  assert.equal(s["003-c.md"].status, "blocked");
});

test("a blocker whose file no longer exists counts as satisfied", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "004-d.md", ["001-a.md", "099-gone.md"]);
  closeTask(root, "001-a.md");
  assert.equal(status(root)["004-d.md"].status, "ready");
  assert.equal(listTasks(root).find((t) => t.filename === "004-d.md")?.status, "ready");
});

test("closing keeps every task's epic link", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md", ["001-a.md"]);
  setTaskEpic(root, ["001-a.md", "002-b.md"], "e1");
  closeTask(root, "001-a.md");
  assert.equal(status(root)["001-a.md"].epic, "e1");
  assert.equal(status(root)["002-b.md"].epic, "e1");
});

test("closing releases a live claim on the closed task and leaves another task's live claim", () => {
  const root = project();
  task(root, "001-a.md");
  task(root, "002-b.md");
  liveSession(root, "sess-1");
  liveSession(root, "sess-2");
  const dir = tasksDirFor(root);
  assert.equal(claimTask(root, dir, "001-a.md", "sess-1").outcome, "claimed");
  assert.equal(claimTask(root, dir, "002-b.md", "sess-2").outcome, "claimed");
  const after = closeTask(root, "001-a.md");
  assert.equal(fs.existsSync(claimFile(root, "001-a.md")), false);
  assert.equal(fs.existsSync(claimFile(root, "002-b.md")), true);
  assert.equal(after.find((t) => t.filename === "001-a.md")?.claim, null);
  assert.equal(after.find((t) => t.filename === "002-b.md")?.claim?.live, true);
});

test("closing from inside a linked worktree updates the main checkout's queue", () => {
  const main = project();
  task(main, "001-a.md");
  task(main, "002-b.md", ["001-a.md"]);
  fs.mkdirSync(path.join(main, ".git", "worktrees", "wt"), { recursive: true });
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "close-task-wt-"));
  fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "wt")}\n`);
  closeTask(wt, "001-a.md");
  assert.equal(status(main)["001-a.md"].status, "done");
  assert.equal(status(main)["002-b.md"].status, "ready");
  assert.equal(fs.existsSync(path.join(wt, ".claude", "maestro-tasks", "status.json")), false);
});
