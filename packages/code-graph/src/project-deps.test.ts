import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depsStatus } from "./deps.js";
import {
  cacheDepsDir,
  depsKey,
  MissingProjectDependencyError,
  pluginDepsDirs,
  PINNED_DEPS,
  probeDepsDir,
  requireFromProject,
} from "./project-deps.js";
import { packageVersion } from "./version.js";

const saved = { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, CLAUDE_PLUGIN_DATA: process.env.CLAUDE_PLUGIN_DATA };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("plugin deps folder key", () => {
  it("is derived from the pinned deps, not the code-graph version", () => {
    assert.equal(depsKey(), "ts-morph@28.0.0");
    assert.equal(depsKey(PINNED_DEPS), depsKey());
    assert.ok(!depsKey().includes(packageVersion()));
  });

  it("changes when a pin changes or a dep is added, and ignores key order", () => {
    assert.notEqual(depsKey({ "ts-morph": "29.0.0" }), depsKey({ "ts-morph": "28.0.0" }));
    assert.equal(depsKey({ b: "1.0.0", a: "2.0.0" }), depsKey({ a: "2.0.0", b: "1.0.0" }));
    assert.equal(depsKey({ b: "1.0.0", a: "2.0.0" }), "a@2.0.0+b@1.0.0");
  });

  it("is the last segment of both the cache and the plugin-data directories", () => {
    process.env.XDG_CACHE_HOME = "/tmp/xdg";
    process.env.CLAUDE_PLUGIN_DATA = "/tmp/plugin-data";
    assert.equal(cacheDepsDir(), join("/tmp/xdg", "code-graph", "deps", depsKey()));
    assert.deepEqual(pluginDepsDirs(), [join("/tmp/plugin-data", "deps", depsKey()), cacheDepsDir()]);
  });
});

describe("unreadable vs missing deps dir", () => {
  const savedEnv = process.env.SANDBOX_RUNTIME;
  const savedCwd = process.cwd();
  let tmp = "";
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SANDBOX_RUNTIME;
    else process.env.SANDBOX_RUNTIME = savedEnv;
    process.chdir(savedCwd);
    if (tmp) {
      chmodSync(tmp, 0o755);
      rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  function emptyCache(): string {
    tmp = mkdtempSync(join(tmpdir(), "cg-deps-"));
    process.env.XDG_CACHE_HOME = join(tmp, "cache");
    delete process.env.CLAUDE_PLUGIN_DATA;
    return tmp;
  }

  function statusOutput(): string {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      depsStatus();
    } finally {
      console.log = orig;
    }
    return lines.join("\n");
  }

  it("treats ENOENT as absent outside the sandbox and keeps the deps install advice", () => {
    delete process.env.SANDBOX_RUNTIME;
    const dir = emptyCache();
    process.chdir(dir);
    assert.equal(probeDepsDir(cacheDepsDir()), "absent");
    const out = statusOutput();
    assert.match(out, /ts-morph: missing — run `code-graph deps install`/);
    assert.doesNotMatch(out, /allowRead/);
    const err = new MissingProjectDependencyError("ts-morph", dir);
    assert.match(err.message, /deps install/);
    assert.doesNotMatch(err.message, /allowRead/);
  });

  it("treats ENOENT as unreadable in a sandboxed session and names allowRead", () => {
    process.env.SANDBOX_RUNTIME = "1";
    const dir = emptyCache();
    process.chdir(dir);
    assert.equal(probeDepsDir(cacheDepsDir()), "unreadable");
    const out = statusOutput();
    assert.match(out, /unreadable/);
    assert.match(out, /sandbox\.filesystem\.allowRead/);
    assert.ok(out.includes(join(dir, "cache", "code-graph")));
    const err = new MissingProjectDependencyError("ts-morph", dir, true);
    assert.match(err.message, /sandboxed session/);
    assert.match(err.message, /code-graph deps status/);
    assert.match(err.message, /sandbox\.filesystem\.allowRead/);
    assert.ok(err.message.includes(join(dir, "cache", "code-graph")));
  });

  it("requireFromProject picks the sandbox message only when sandboxed (same error class either way)", () => {
    const dir = emptyCache();
    process.chdir(dir);
    delete process.env.SANDBOX_RUNTIME;
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError && /deps install/.test(e.message) && !/allowRead/.test(e.message)
    );
    process.env.SANDBOX_RUNTIME = "1";
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError &&
        /sandbox\.filesystem\.allowRead/.test(e.message) &&
        e.message.includes(join(dir, "cache", "code-graph"))
    );
  });

  it("reports an EACCES stat as unreadable even without the sandbox flag", (t) => {
    if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
    delete process.env.SANDBOX_RUNTIME;
    const dir = emptyCache();
    const deps = cacheDepsDir();
    mkdirSync(join(deps, "node_modules"), { recursive: true });
    chmodSync(dir, 0o000);
    assert.equal(probeDepsDir(deps), "unreadable");
    chmodSync(dir, 0o755);
    assert.equal(probeDepsDir(deps), "present");
  });
});
