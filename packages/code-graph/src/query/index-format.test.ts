// An index built by an older code-graph (no meta.fts_format, raw camelCase names) is rebuilt once by
// `search`; when the store cannot be written, search says so on stderr and still answers.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applySchema,
  bootstrapStore,
  rebuildSearchIndex,
  ensureSearchIndexFormat,
  storedFtsFormat,
  FTS_FORMAT,
  SCHEMA_VERSION,
} from "../scribe/bootstrap.js";
import { closeStores } from "../scribe/db.js";
import { search } from "./search.js";

const vertex = {
  _key: "v1",
  concept: "wo",
  type: "function",
  name: "setIndexValue",
  filepath: "src/wo.ts",
  start_line: 1,
  end_line: 5,
  status: "live",
};

const put = (db: DatabaseSync) =>
  db.prepare("INSERT INTO vertices(key, doc) VALUES('v1', ?)").run(JSON.stringify(vertex));

/** Makes the index look like one built before FTS_FORMAT existed: raw names, no meta row. */
function age(db: DatabaseSync): void {
  db.exec("DELETE FROM search_fts");
  db.prepare(
    "INSERT INTO search_fts(ref_kind, ref_key, name, purpose, tags, body_md) VALUES ('vertex','v1',?,'','','')"
  ).run(vertex.name);
  db.exec("DELETE FROM meta");
}

const ftsNames = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM search_fts WHERE ref_kind = 'vertex'").all() as { name: string }[]).map((r) => r.name);

describe("ensureSearchIndexFormat", () => {
  it("applySchema creates meta without changing the schema version", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'meta'").get());
    assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, SCHEMA_VERSION);
    assert.equal(SCHEMA_VERSION, 1);
  });

  it("rebuildSearchIndex stamps the current format", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    assert.equal(storedFtsFormat(db), 0);
    rebuildSearchIndex(db);
    assert.equal(storedFtsFormat(db), FTS_FORMAT);
  });

  it("rebuilds a store with no recorded format once, then reports current", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    put(db);
    age(db);
    assert.deepEqual(ftsNames(db), ["setIndexValue"]);
    assert.equal(ensureSearchIndexFormat(db), "rebuilt");
    assert.equal(storedFtsFormat(db), FTS_FORMAT);
    assert.notDeepEqual(ftsNames(db), ["setIndexValue"], "names are word-split after the rebuild");
    assert.match(ftsNames(db)[0], /\bindex\b/i);
    assert.equal(ensureSearchIndexFormat(db), "current");
  });

  it("rebuilds when the stored format is older than FTS_FORMAT", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    put(db);
    rebuildSearchIndex(db);
    db.exec("UPDATE meta SET value = '1' WHERE key = 'fts_format'");
    assert.equal(ensureSearchIndexFormat(db), "rebuilt");
    assert.equal(storedFtsFormat(db), FTS_FORMAT);
  });

  it("leaves an empty store alone", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    assert.equal(ensureSearchIndexFormat(db), "current");
    assert.equal(storedFtsFormat(db), 0);
  });

  it("reports unwritable, and leaves the old index in place, when the rebuild cannot commit", () => {
    const db = new DatabaseSync(":memory:");
    applySchema(db);
    put(db);
    age(db);
    db.exec("CREATE TRIGGER no_meta BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'read-only'); END");
    assert.equal(ensureSearchIndexFormat(db), "unwritable");
    assert.deepEqual(ftsNames(db), ["setIndexValue"], "rolled back: the old index is untouched");
    assert.equal(storedFtsFormat(db), 0);
  });
});

describe("search() on an old-format store", () => {
  let tmp: string;
  let cwd: string;
  let errors: string[];
  let origError: typeof console.error;

  function project(): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-fts-format-"));
    fs.writeFileSync(path.join(tmp, "scribe.config.json"), JSON.stringify({ project: "p", concepts: {} }));
    const db = bootstrapStore(path.join(tmp, "scribe-output", "graph.db"));
    put(db);
    age(db);
    cwd = process.cwd();
    process.chdir(tmp);
    errors = [];
    origError = console.error;
    console.error = (...a: unknown[]) => void errors.push(a.join(" "));
    return tmp;
  }

  afterEach(() => {
    console.error = origError;
    process.chdir(cwd);
    closeStores();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds a word of a camelCase name only after the one-time reindex, and does not reindex again", async () => {
    project();
    const db = bootstrapStore(path.join(tmp, "scribe-output", "graph.db"));
    const hit = async (q: string) => {
      try {
        return (await search(q, { maxTokens: 2000, json: true })).hits.length;
      } catch {
        return 0;
      }
    };
    assert.equal(storedFtsFormat(db), 0);
    assert.equal(
      db.prepare("SELECT 1 FROM search_fts WHERE search_fts MATCH 'value'").get(),
      undefined,
      "old index misses"
    );
    assert.ok((await hit("value")) > 0, "word match works on the first search because it reindexes first");
    assert.equal(storedFtsFormat(db), FTS_FORMAT);
    assert.deepEqual(errors, []);

    // A marker row that a second rebuild would wipe.
    db.prepare(
      "INSERT INTO search_fts(ref_kind, ref_key, name, purpose, tags, body_md) VALUES ('vertex','marker','','','','')"
    ).run();
    await hit("value");
    assert.ok(db.prepare("SELECT 1 FROM search_fts WHERE ref_key = 'marker'").get(), "second search did not rebuild");
  });

  it("prints the one-line `code-graph reindex` hint when the store cannot be written, and still searches", async () => {
    project();
    const db = bootstrapStore(path.join(tmp, "scribe-output", "graph.db"));
    db.exec("CREATE TRIGGER no_meta BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'read-only'); END");
    // The raw name still matches on the old index.
    const r = await search("setIndexValue", { maxTokens: 2000, json: true });
    assert.ok(r.hits.length > 0);
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes("\n"));
    assert.match(errors[0], /code-graph reindex/);
  });
});
