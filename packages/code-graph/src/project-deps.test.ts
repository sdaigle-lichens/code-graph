import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cacheDepsDir, depsKey, pluginDepsDirs, PINNED_DEPS } from "./project-deps.js";
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
