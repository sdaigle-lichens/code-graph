import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { depsStatus } from "./deps.js";
import {
  allowReadPaths,
  cacheDepsDir,
  depsRootDir,
  sandboxReadAdvice,
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

  it("says absent in a sandboxed session when the cache root is visible and the deps dir is missing", () => {
    process.env.SANDBOX_RUNTIME = "1";
    const dir = emptyCache();
    mkdirSync(join(dir, "cache", "code-graph"), { recursive: true });
    process.chdir(dir);
    assert.equal(probeDepsDir(cacheDepsDir()), "absent");
    const out = statusOutput();
    assert.match(out, /ts-morph: missing — run `code-graph deps install`/);
    assert.doesNotMatch(out, /allowRead|not visible|unreadable/);
  });

  it("says absent in a sandboxed session when only the cache root's parent can be listed", () => {
    process.env.SANDBOX_RUNTIME = "1";
    const dir = emptyCache();
    mkdirSync(join(dir, "cache"), { recursive: true });
    assert.equal(probeDepsDir(cacheDepsDir()), "absent");
  });

  it("says not visible in a sandboxed session when the cache root cannot be seen, with both fixes", () => {
    process.env.SANDBOX_RUNTIME = "1";
    const dir = emptyCache();
    process.env.XDG_CACHE_HOME = join(dir, "hidden", "cache");
    process.chdir(dir);
    assert.equal(probeDepsDir(cacheDepsDir()), "not-visible");
    const out = statusOutput();
    assert.match(out, /not visible from this sandboxed session: it may be absent or hidden/);
    assert.match(out, /deps install/);
    assert.match(out, /sandbox\.filesystem\.allowRead/);
    assert.ok(out.includes(join(dir, "hidden", "cache", "code-graph")));
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError &&
        /not visible from this sandboxed session/.test(e.message) &&
        /deps install/.test(e.message) &&
        /allowRead/.test(e.message)
    );
  });

  it("says unreadable on EACCES under the sandbox flag too, and names allowRead", (t) => {
    if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
    process.env.SANDBOX_RUNTIME = "1";
    const dir = emptyCache();
    mkdirSync(join(cacheDepsDir(), "node_modules"), { recursive: true });
    process.chdir(dir);
    chmodSync(dir, 0o000);
    const state = probeDepsDir(cacheDepsDir());
    chmodSync(dir, 0o755);
    assert.equal(state, "unreadable");
    chmodSync(join(dir, "cache"), 0o000);
    const out = statusOutput();
    chmodSync(join(dir, "cache"), 0o755);
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
    process.env.XDG_CACHE_HOME = join(dir, "hidden", "cache");
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError &&
        /sandbox\.filesystem\.allowRead/.test(e.message) &&
        e.message.includes(join(dir, "hidden", "cache", "code-graph"))
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

// The macOS Seatbelt shape: stat on a denied path succeeds, listing or opening it fails with EPERM.
// A directory with mode 0o000 under a readable parent reproduces it with real filesystem calls:
// statSync works (the parent is searchable), readdirSync fails with EACCES.
describe("deps dir present but unreadable (stat ok, listing denied)", () => {
  const savedEnv = process.env.SANDBOX_RUNTIME;
  const savedCwd = process.cwd();
  let tmp = "";
  const locked: string[] = [];
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.SANDBOX_RUNTIME;
    else process.env.SANDBOX_RUNTIME = savedEnv;
    process.chdir(savedCwd);
    for (const p of locked.splice(0)) chmodSync(p, 0o755);
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  function lock(path: string, mode: number): void {
    chmodSync(path, mode);
    locked.push(path);
  }

  function setup(): string {
    tmp = mkdtempSync(join(tmpdir(), "cg-deps-ro-"));
    process.env.XDG_CACHE_HOME = join(tmp, "cache");
    delete process.env.CLAUDE_PLUGIN_DATA;
    process.chdir(tmp);
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

  for (const sandboxed of [true, false]) {
    it(`calls a stat-able but unlistable node_modules unreadable and names the cache root to allow (sandboxed=${sandboxed})`, (t) => {
      if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
      if (sandboxed) process.env.SANDBOX_RUNTIME = "1";
      else delete process.env.SANDBOX_RUNTIME;
      const dir = setup();
      const modules = join(cacheDepsDir(), "node_modules");
      mkdirSync(join(modules, "ts-morph"), { recursive: true });
      lock(modules, 0o000);
      assert.doesNotThrow(() => statSync(modules), "the Seatbelt shape: stat still succeeds");
      assert.equal(probeDepsDir(cacheDepsDir()), "unreadable");

      const root = join(dir, "cache", "code-graph");
      const out = statusOutput();
      assert.match(out, /ts-morph: not loadable — the plugin deps dir exists but cannot be read/);
      assert.match(out, /unreadable \(exists, not absent\)/);
      assert.match(out, /sandbox\.filesystem\.allowRead/);
      assert.ok(out.includes(`add ${root} to`), `status names the absolute root:\n${out}`);
      assert.doesNotMatch(out, /missing — run `code-graph deps install`/);

      assert.throws(
        () => requireFromProject("ts-morph"),
        (e: Error) => {
          assert.ok(e instanceof MissingProjectDependencyError);
          assert.match(e.message, /could not be loaded: not readable from code-graph's plugin deps directory/);
          assert.match(e.message, /exists but cannot be read from this session/);
          assert.match(e.message, /sandbox\.filesystem\.allowRead/);
          assert.ok(e.message.includes(`add ${root} to`), e.message);
          assert.match(e.message, /Do not re-run `code-graph deps install`/);
          assert.doesNotMatch(e.message, /could not be found/);
          assert.doesNotMatch(e.message, /Run `code-graph deps install` \(for the plugin/);
          return true;
        }
      );
    });
  }

  it("calls a denied but stat-able deps root with nothing inside absent in the sandbox", (t) => {
    if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
    process.env.SANDBOX_RUNTIME = "1";
    setup();
    const root = join(tmp, "cache", "code-graph");
    mkdirSync(root, { recursive: true });
    // Execute-only: entries below can be stat'd (ENOENT is genuine), the root itself cannot be listed.
    lock(root, 0o100);
    assert.throws(() => readdirSync(root), /EACCES/);
    assert.throws(() => statSync(join(cacheDepsDir(), "node_modules")), /ENOENT/);
    assert.equal(probeDepsDir(cacheDepsDir()), "absent");
    const out = statusOutput();
    assert.match(out, /ts-morph: missing — run `code-graph deps install`/);
    assert.doesNotMatch(out, /allowRead|unreadable|not visible/);
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError && /deps install/.test(e.message) && !/allowRead/.test(e.message)
    );
  });

  for (const sandboxed of [true, false]) {
    it(`keeps the deps install advice when the deps dir really does not exist (sandboxed=${sandboxed})`, () => {
      if (sandboxed) process.env.SANDBOX_RUNTIME = "1";
      else delete process.env.SANDBOX_RUNTIME;
      setup();
      mkdirSync(join(tmp, "cache", "code-graph"), { recursive: true });
      assert.equal(probeDepsDir(cacheDepsDir()), "absent");
      const out = statusOutput();
      assert.match(out, /ts-morph: missing — run `code-graph deps install`/);
      assert.doesNotMatch(out, /allowRead/);
      assert.throws(
        () => requireFromProject("ts-morph"),
        (e: Error) => {
          assert.ok(e instanceof MissingProjectDependencyError);
          assert.match(e.message, /could not be found/);
          assert.match(e.message, /Run `code-graph deps install`/);
          assert.doesNotMatch(e.message, /allowRead/);
          return true;
        }
      );
    });
  }

  it("names CLAUDE_PLUGIN_DATA, not the cache root, when the plugin-data deps dir is the unreadable one", (t) => {
    if (process.getuid?.() === 0) return t.skip("root ignores directory modes");
    process.env.SANDBOX_RUNTIME = "1";
    setup();
    const pluginData = join(tmp, "plugin-data");
    process.env.CLAUDE_PLUGIN_DATA = pluginData;
    mkdirSync(join(tmp, "cache", "code-graph"), { recursive: true });
    const [dataDir, cacheDir] = pluginDepsDirs();
    assert.equal(depsRootDir(dataDir), pluginData);
    const modules = join(dataDir, "node_modules");
    mkdirSync(modules, { recursive: true });
    lock(modules, 0o000);

    const states = pluginDepsDirs().map((d) => ({ dir: d, state: probeDepsDir(d) }));
    assert.deepEqual(
      states.map((s) => s.state),
      ["unreadable", "absent"]
    );
    assert.deepEqual(allowReadPaths(states, "unreadable"), [pluginData]);
    const cacheRoot = join(tmp, "cache", "code-graph");
    assert.equal(depsRootDir(cacheDir), cacheRoot);

    const out = statusOutput();
    assert.ok(out.includes(`add ${pluginData} to`), out);
    assert.ok(!out.includes(`add ${cacheRoot}`), out);
    assert.throws(
      () => requireFromProject("ts-morph"),
      (e: Error) =>
        e instanceof MissingProjectDependencyError &&
        e.message.includes(`add ${pluginData} to`) &&
        !e.message.includes(`add ${cacheRoot}`)
    );
  });

  it("allowReadPaths dedupes roots and falls back to the cache root when no dir is in the state", () => {
    setup();
    const pluginData = join(tmp, "plugin-data");
    const cacheRoot = join(tmp, "cache", "code-graph");
    const a = { dir: join(pluginData, "deps", "a@1"), state: "unreadable" as const };
    const b = { dir: join(pluginData, "deps", "b@1"), state: "unreadable" as const };
    const c = { dir: join(cacheRoot, "deps", "a@1"), state: "unreadable" as const };
    assert.deepEqual(allowReadPaths([a, b], "unreadable"), [pluginData]);
    assert.deepEqual(allowReadPaths([a, c], "unreadable"), [pluginData, cacheRoot]);
    assert.deepEqual(allowReadPaths([{ dir: a.dir, state: "absent" }], "not-visible"), [cacheRoot]);
    assert.ok(
      sandboxReadAdvice("unreadable", [pluginData, cacheRoot]).includes(`add ${pluginData} and ${cacheRoot} to`)
    );
  });
});
