// The Layer-A gate measures a stripped copy of the store by default, so enrichment cannot change
// its verdict, and names the kind of store it measured.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema, rebuildSearchIndex } from "../scribe/bootstrap.js";
import { searchStore } from "../query/search.js";
import { describeEvalStore, isEvalStoreMode, openEvalStore } from "./store.js";

function seeded(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySchema(db);
  const v = (key: string, name: string, extra: object) =>
    db.prepare("INSERT INTO vertices(key, doc) VALUES(?, ?)").run(
      key,
      JSON.stringify({
        _key: key,
        concept: "c",
        type: "function",
        name,
        filepath: "src/a.ts",
        start_line: 1,
        end_line: 2,
        status: "live",
        ...extra,
      })
    );
  v("v1", "alphaThing", { purpose: "reticulates splines", tags: ["spline"] });
  v("v2", "betaThing", {});
  rebuildSearchIndex(db);
  return db;
}

// Points os.tmpdir() (which reads $TMPDIR on each call) at a private directory, so temp-dir checks
// see only what this test created.
type Sandbox = { dir: string; leftovers: () => string[]; restore: () => void };
const sandboxes: Sandbox[] = [];
function sandbox(tmpName = "sb"): Sandbox {
  const prev = process.env.TMPDIR;
  const base = mkdtempSync(join(tmpdir(), "eval-store-test-"));
  const dir = join(base, tmpName);
  mkdirSync(dir);
  process.env.TMPDIR = dir;
  const s: Sandbox = {
    dir,
    leftovers: () => readdirSync(dir).filter((n) => n.startsWith("code-graph-eval-")),
    restore: () => {
      if (prev === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prev;
      rmSync(base, { recursive: true, force: true });
    },
  };
  sandboxes.push(s);
  return s;
}
afterEach(() => {
  for (const s of sandboxes.splice(0)) s.restore();
});

describe("openEvalStore", () => {
  it("as-is keeps enrichment and labels the store enriched", async () => {
    const db = seeded();
    const s = openEvalStore(db, "as-is");
    assert.equal(s.db, db);
    assert.match(s.label, /^store: enriched \(as-is/);
    assert.match(s.label, /1 of 2 vertices/);
    const r = await searchStore(s.db, "splines", { maxTokens: 2000, json: false });
    assert.equal(r.hits[0]?.vertex?.name, "alphaThing");
  });

  it("stripped removes purposes and tags from a copy, leaving the source untouched", async () => {
    const db = seeded();
    const s = openEvalStore(db, "stripped");
    try {
      assert.notEqual(s.db, db);
      assert.match(s.label, /^store: un-enriched \(stripped copy/);
      assert.equal(s.enriched, 1);
      const rows = s.db.prepare("SELECT count(*) AS n FROM vertices WHERE purpose IS NOT NULL").get() as { n: number };
      assert.equal(rows.n, 0);
      await assert.rejects(() => searchStore(s.db, "splines", { maxTokens: 2000, json: false }));
      // name words still reach the vertex
      const r = await searchStore(s.db, "alpha thing", { maxTokens: 2000, json: false });
      assert.equal(r.hits[0]?.vertex?.name, "alphaThing");
    } finally {
      s.close();
    }
    const src = db.prepare("SELECT count(*) AS n FROM vertices WHERE purpose IS NOT NULL").get() as { n: number };
    assert.equal(src.n, 1);
  });

  it("removes its temp dir on close", () => {
    const sb = sandbox();
    const s = openEvalStore(seeded(), "stripped");
    assert.equal(sb.leftovers().length, 1, "the copy lives in a code-graph-eval-* dir while open");
    s.close();
    assert.deepEqual(sb.leftovers(), []);
  });

  it("copies WAL-only content: rows not yet checkpointed into the main file are measured", () => {
    const sb = sandbox();
    const file = join(sb.dir, "src.db");
    const src = new DatabaseSync(file);
    src.exec("PRAGMA journal_mode = WAL");
    applySchema(src);
    src
      .prepare("INSERT INTO vertices(key, doc) VALUES(?, ?)")
      .run("w1", JSON.stringify({ _key: "w1", name: "walOnlyThing", purpose: "lives in the wal", status: "live" }));
    rebuildSearchIndex(src);
    assert.ok(existsSync(`${file}-wal`) && statSync(`${file}-wal`).size > 0, "source must have a non-empty WAL");
    const s = openEvalStore(src, "stripped");
    try {
      const n = s.db.prepare("SELECT count(*) AS n FROM vertices").get() as { n: number };
      assert.equal(n.n, 1);
      assert.match(s.label, /1 of 1 vertices/);
    } finally {
      s.close();
    }
    const after = src.prepare("SELECT count(*) AS n FROM vertices WHERE purpose IS NOT NULL").get() as { n: number };
    assert.equal(after.n, 1, "source purpose survives the stripped copy");
    src.close();
    assert.deepEqual(sb.leftovers(), []);
  });

  it("escapes single quotes in the temp path", () => {
    const sb = sandbox("it's a dir");
    const s = openEvalStore(seeded(), "stripped");
    try {
      assert.equal(sb.dir.includes("it's"), true, "the sandbox path carries a quote");
      const n = s.db.prepare("SELECT count(*) AS n FROM vertices").get() as { n: number };
      assert.equal(n.n, 2);
      assert.equal(sb.leftovers().length, 1);
    } finally {
      s.close();
    }
    assert.deepEqual(sb.leftovers(), []);
  });

  it("handles a store with zero vertices (counts 0 of 0)", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    rebuildSearchIndex(db);
    const s = openEvalStore(db, "stripped");
    try {
      assert.equal(s.vertices, 0);
      assert.equal(s.enriched, 0);
      assert.match(s.label, /0 of 0 vertices/);
    } finally {
      s.close();
    }
  });

  // A setup failure after the temp dir is created (here: no search_fts table) must not leak the dir.
  it("removes its temp dir when setup fails after the dir is created", () => {
    const sb = sandbox();
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE vertices(key TEXT PRIMARY KEY, doc TEXT)");
    assert.throws(() => openEvalStore(db, "stripped"));
    assert.deepEqual(sb.leftovers(), []);
  });

  it("labels an as-is store with no purposes un-enriched", () => {
    assert.match(describeEvalStore("as-is", 0, 5), /^store: un-enriched \(as-is/);
  });

  it("validates the mode", () => {
    assert.ok(isEvalStoreMode("stripped"));
    assert.ok(isEvalStoreMode("as-is"));
    assert.ok(!isEvalStoreMode("other"));
  });
});
