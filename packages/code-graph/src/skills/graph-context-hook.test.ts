// The plugin's SessionStart hook must stay inert: silent without scribe.config.json, otherwise one short
// context line, always exit 0, never any file written (maestro arbitrates hooks and relies on this).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const HOOK = path.join(REPO, "plugin/hooks/graph-context.cjs");

function run(cwd: string) {
  return spawnSync(process.execPath, [HOOK], { cwd, encoding: "utf8" });
}

function listing(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true }).map(String).sort();
}

describe("plugin SessionStart hook", () => {
  it("is registered on SessionStart and runs the script from the plugin root", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO, "plugin/hooks/hooks.json"), "utf8"));
    assert.deepEqual(Object.keys(cfg.hooks), ["SessionStart"]);
    const cmd = cfg.hooks.SessionStart[0].hooks[0].command as string;
    assert.ok(cmd.includes("${CLAUDE_PLUGIN_ROOT}/hooks/graph-context.cjs"));
  });

  it("prints nothing and exits 0 without scribe.config.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-hook-"));
    try {
      const before = listing(dir);
      const r = run(dir);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr, "");
      assert.deepEqual(listing(dir), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds one short context line naming the skill when scribe.config.json exists, and writes nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-hook-"));
    try {
      fs.writeFileSync(path.join(dir, "scribe.config.json"), "{}");
      const before = listing(dir);
      const r = run(dir);
      assert.equal(r.status, 0);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
      assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
      const line = out.hookSpecificOutput.additionalContext as string;
      assert.ok(line.includes("code-graph-retrieval"));
      assert.ok(!line.includes("\n"));
      assert.ok(line.length <= 300, `context line is ${line.length} chars`);
      assert.equal(out.decision, undefined);
      assert.deepEqual(listing(dir), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
