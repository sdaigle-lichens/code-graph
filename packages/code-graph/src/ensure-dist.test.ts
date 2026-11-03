// scripts/ensure-dist.mjs keeps dist/ in step with src/ before `just eval` / `just regraph` run
// dist/cli.js. The script resolves its package from its own location, so each test copies it into a
// throwaway package under $TMPDIR (scripts/, src/, dist/, tsconfig.json) and imports or spawns that
// copy for real. The rebuild cases link the real node_modules so the package's own tsc runs.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const SCRIPT = path.join(PKG, "scripts/ensure-dist.mjs");
const REBUILD_CMD = "packages/code-graph/node_modules/.bin/tsc -p packages/code-graph/tsconfig.json";

let tmp = "";
let importCount = 0;

function write(rel: string, body: string, mtimeSec?: number) {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (mtimeSec !== undefined) fs.utimesSync(file, mtimeSec, mtimeSec);
}

function touch(rel: string, mtimeSec: number) {
  fs.utimesSync(path.join(tmp, rel), mtimeSec, mtimeSec);
}

/** A package where every source is older (t=1000) than its output (t=2000). */
function currentPackage() {
  write("tsconfig.json", JSON.stringify({ compilerOptions: { outDir: "dist", rootDir: "src" } }), 1000);
  write("src/cli.ts", "export const a = 1;\n", 1000);
  write("src/query/search.ts", "export const b = 2;\n", 1000);
  write("src/view.tsx", "export const c = 3;\n", 1000);
  write("dist/cli.js", "", 2000);
  write("dist/query/search.js", "", 2000);
  write("dist/view.js", "", 2000);
}

/** staleReason() from a fresh import of the copied script (a new URL each time defeats the module cache). */
async function staleReason(): Promise<string | null> {
  const url = pathToFileURL(path.join(tmp, "scripts/ensure-dist.mjs")).href + `?n=${importCount++}`;
  const mod = (await import(url)) as { staleReason: () => string | null };
  return mod.staleReason();
}

/**
 * Spawns the copy the way the justfile does: a path relative to the cwd. (os.tmpdir() is under the
 * /tmp symlink on macOS; a relative path resolves against the physical cwd, so the script's
 * entrypoint check matches. A test below covers the absolute-symlinked-path case.)
 */
function runScript(args: string[] = [], script = "scripts/ensure-dist.mjs") {
  return spawnSync(process.execPath, [script, ...args], { cwd: tmp, encoding: "utf8" });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-ensure-dist-"));
  fs.mkdirSync(path.join(tmp, "scripts"));
  fs.copyFileSync(SCRIPT, path.join(tmp, "scripts/ensure-dist.mjs"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("staleReason()", () => {
  it("is null when every output is at least as new as its source", async () => {
    currentPackage();
    assert.equal(await staleReason(), null);
  });

  it("treats equal mtimes as current", async () => {
    currentPackage();
    touch("src/cli.ts", 2000);
    assert.equal(await staleReason(), null);
  });

  it("reports a missing dist/cli.js first", async () => {
    currentPackage();
    fs.rmSync(path.join(tmp, "dist/cli.js"));
    assert.equal(await staleReason(), "dist/cli.js is missing");
  });

  it("reports a missing dist/ entirely as dist/cli.js missing", async () => {
    currentPackage();
    fs.rmSync(path.join(tmp, "dist"), { recursive: true });
    assert.equal(await staleReason(), "dist/cli.js is missing");
  });

  it("reports tsconfig.json newer than dist/cli.js", async () => {
    currentPackage();
    touch("tsconfig.json", 3000);
    assert.equal(await staleReason(), "tsconfig.json is newer than dist/cli.js");
  });

  it("names a nested source newer than its output", async () => {
    currentPackage();
    touch("src/query/search.ts", 3000);
    assert.equal(await staleReason(), `${path.join("src", "query", "search.ts")} is newer than its dist output`);
  });

  it("maps .tsx sources to .js outputs", async () => {
    currentPackage();
    touch("src/view.tsx", 3000);
    assert.equal(await staleReason(), "src/view.tsx is newer than its dist output");
  });

  it("names a source with no dist output (new file)", async () => {
    currentPackage();
    write("src/added.ts", "export {};\n", 1000);
    assert.equal(await staleReason(), "src/added.ts has no dist output");
  });

  it("ignores *.test.ts and *.d.ts, which tsc does not emit", async () => {
    currentPackage();
    write("src/cli.test.ts", "", 5000);
    write("src/query/search.test.tsx", "", 5000);
    write("src/types.d.ts", "", 5000);
    assert.equal(await staleReason(), null);
  });

  it("ignores non-TypeScript files under src/", async () => {
    currentPackage();
    write("src/data.json", "{}", 5000);
    write("src/README.md", "", 5000);
    assert.equal(await staleReason(), null);
  });

  it("does not run the CLI block when imported", async () => {
    currentPackage();
    fs.rmSync(path.join(tmp, "dist/cli.js"));
    // Stale and no typescript here: running the CLI block would exit the test process.
    assert.equal(await staleReason(), "dist/cli.js is missing");
  });
});

describe("ensure-dist.mjs --check", () => {
  it("exits 0 silently when current", () => {
    currentPackage();
    const r = runScript(["--check"]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  });

  it("exits 1 with one line naming the reason and the rebuild command, and never builds", () => {
    currentPackage();
    touch("src/cli.ts", 3000);
    const r = runScript(["--check"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    const lines = r.stderr.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /src\/cli\.ts is newer than its dist output/);
    assert.ok(lines[0].includes(REBUILD_CMD), lines[0]);
    // Untouched: dist/cli.js keeps its old mtime and empty body.
    assert.equal(fs.statSync(path.join(tmp, "dist/cli.js")).mtimeMs, 2000 * 1000);
    assert.equal(fs.readFileSync(path.join(tmp, "dist/cli.js"), "utf8"), "");
  });

  it("refuses when invoked through an absolute path that crosses a symlink", () => {
    currentPackage();
    touch("src/cli.ts", 3000);
    const linked = path.join(os.tmpdir(), `cg-ensure-dist-link-${process.pid}`);
    fs.symlinkSync(tmp, linked, "dir");
    try {
      const r = runScript(["--check"], path.join(linked, "scripts/ensure-dist.mjs"));
      assert.equal(r.status, 1);
    } finally {
      fs.rmSync(linked);
    }
  });
});

describe("ensure-dist.mjs (rebuild mode)", () => {
  it("is a no-op when current", () => {
    currentPackage();
    const r = runScript();
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.equal(fs.readFileSync(path.join(tmp, "dist/cli.js"), "utf8"), "");
  });

  it("fails with one line naming pnpm install when typescript is not installed", () => {
    currentPackage();
    touch("src/cli.ts", 3000);
    const r = runScript();
    assert.equal(r.status, 1);
    const lines = r.stderr.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /no typescript under packages\/code-graph\/node_modules; run pnpm install/);
  });

  describe("with the real typescript", () => {
    beforeEach(() => {
      fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
      write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: { target: "ES2022", module: "ES2022", outDir: "dist", rootDir: "src", strict: true },
          include: ["src/**/*"],
          exclude: ["src/**/*.test.ts"],
        }),
        1000
      );
      write("src/cli.ts", 'import { b } from "./lib/b.js";\nexport const a: number = b + 1;\n', 1000);
      write("src/lib/b.ts", "export const b: number = 2;\n", 1000);
    });

    it("builds a missing dist/, after which the check is current", async () => {
      const r = runScript();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /code-graph build is stale \(dist\/cli\.js is missing\); rebuilding with tsc/);
      assert.match(fs.readFileSync(path.join(tmp, "dist/cli.js"), "utf8"), /b \+ 1/);
      assert.ok(fs.existsSync(path.join(tmp, "dist/lib/b.js")));
      assert.equal(await staleReason(), null);
      assert.equal(runScript(["--check"]).status, 0);
    });

    it("rebuilds after a touch with no content change (tsc rewrites every output)", async () => {
      assert.equal(runScript().status, 0);
      // Outputs dated before their (unchanged) sources, as after a `touch src/lib/b.ts`.
      touch("src/lib/b.ts", 2000);
      touch("dist/lib/b.js", 1500);
      assert.equal(await staleReason(), "src/lib/b.ts is newer than its dist output");
      const r = runScript();
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stderr, /src\/lib\/b\.ts is newer than its dist output\); rebuilding with tsc/);
      assert.ok(fs.statSync(path.join(tmp, "dist/lib/b.js")).mtimeMs > 2000 * 1000);
      assert.equal(await staleReason(), null);
    });

    it("on a type error exits non-zero, emits nothing, and stays stale for the next run", async () => {
      write("src/lib/b.ts", 'export const b: number = "two";\n', 1000);
      const r = runScript();
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /rebuild failed; fix src\/ and rerun/);
      assert.ok(r.stderr.includes(REBUILD_CMD));
      assert.ok(!fs.existsSync(path.join(tmp, "dist/cli.js")), "no output emitted");
      assert.equal(await staleReason(), "dist/cli.js is missing");
      assert.notEqual(runScript().status, 0, "the next run retries and fails again");
    });

    it("on a type error leaves an existing dist/ untouched", () => {
      assert.equal(runScript().status, 0);
      const before = fs.readFileSync(path.join(tmp, "dist/lib/b.js"), "utf8");
      write("src/lib/b.ts", 'export const b: number = "two";\n');
      const r = runScript();
      assert.notEqual(r.status, 0);
      assert.equal(fs.readFileSync(path.join(tmp, "dist/lib/b.js"), "utf8"), before);
      assert.equal(runScript(["--check"]).status, 1);
    });
  });
});
