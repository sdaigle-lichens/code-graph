// `skills stamp a b` when one write fails with an error that is not a sandbox block (ENOSPC): the
// skill lands in `failed[]`, the others are still written, and the exit code is 1.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stampBatch } from "./commands.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-stamp-batch-"));
});
afterEach(() => {
  mock.restoreAll();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function skill(name: string): string {
  const p = path.join(tmp, ".claude/skills", name, "SKILL.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `---\nname: ${name}\ndescription: "x"\nmetadata:\n  type: concept-skill\n  version: "1.0"\n  last-update: old\n---\n\n# Body\n`
  );
  return p;
}

describe("stampBatch failed[] path", () => {
  it("reports a non-sandbox write error under failed, still writes the rest, exits 1", async () => {
    const a = skill("alpha");
    const b = skill("beta");
    const stdout: string[] = [];
    const stderr: string[] = [];
    // The test runner shares these streams: keep only what stampBatch itself prints.
    mock.method(process.stdout, "write", (s: unknown) => (typeof s === "string" && stdout.push(s), true));
    mock.method(process.stderr, "write", (s: unknown) => (typeof s === "string" && stderr.push(s), true));
    const exit = mock.method(process, "exit", (code?: number) => {
      throw new Error(`exit:${code}`);
    });

    const write = (p: string, plan: { content: string }): boolean => {
      if (p === a) throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      fs.writeFileSync(p, plan.content);
      return true;
    };
    await assert.rejects(
      stampBatch(
        tmp,
        ["alpha", "beta"],
        { bump: "minor", lastUpdate: "newsha", json: true, root: tmp },
        write as never
      ),
      /exit:1/
    );
    mock.restoreAll();

    assert.equal(exit.mock.calls.length, 1);
    const line = stdout
      .join("")
      .split("\n")
      .find((l) => l.startsWith('{"stamped"'));
    assert.ok(line, "stampBatch printed its --json report");
    const report = JSON.parse(line);
    assert.deepEqual(report.failed, [{ path: a, error: "ENOSPC: no space left on device" }]);
    assert.deepEqual(report.blocked, []);
    assert.deepEqual(
      report.stamped.map((s: { path: string }) => s.path),
      [b]
    );
    assert.match(fs.readFileSync(b, "utf8"), /version: "1.1"/);
    assert.match(fs.readFileSync(a, "utf8"), /version: "1.0"/, "the failed skill is untouched");
    assert.ok(stderr.join("").includes(`${a}: ENOSPC`));
  });
});
