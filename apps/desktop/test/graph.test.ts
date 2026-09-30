// Behavioral tests of main/graph.ts against a real store: a temp copy of this repo's own graph.
// No mocks. The repo's scribe.config.json and graph.db are only ever read (copied), never written.

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addConceptToProject,
  closeAllStores,
  conceptGraph,
  withEndpointKeys,
  deleteConceptFromProject,
  graphStatus,
  initProject,
  listConcepts,
} from "../src/main/graph.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const srcDb = path.join(repo, "scribe-output/graph.db");
const tmpRoots: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cg-desktop-"));
  tmpRoots.push(d);
  return d;
}

/** A project dir holding a copy of this repo's config and graph. */
function projectCopy(): string {
  const d = tmp();
  fs.copyFileSync(path.join(repo, "scribe.config.json"), path.join(d, "scribe.config.json"));
  fs.mkdirSync(path.join(d, "scribe-output"));
  fs.copyFileSync(srcDb, path.join(d, "scribe-output/graph.db"));
  return d;
}

/** Does this process hold an open descriptor on the file? */
function heldOpen(file: string): boolean {
  const real = fs.realpathSync(file);
  return fs.readdirSync("/proc/self/fd").some((fd) => {
    try {
      return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(real);
    } catch {
      return false;
    }
  });
}

const listing = (d: string) => fs.readdirSync(d).sort();

afterEach(() => closeAllStores());
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

describe("status against a copy of this repo's own graph", () => {
  it("reports config, store, matching schema and 128/313/1", () => {
    const d = projectCopy();
    const s = graphStatus(d);
    expect(s.config?.path).toBe(path.join(fs.realpathSync(d), "scribe.config.json").replace(fs.realpathSync(d), d));
    expect(s.store.present).toBe(true);
    expect(s.store.schemaMatches).toBe(true);
    expect(s.store.schemaVersion).toBe(s.store.expectedSchemaVersion);
    expect(s.store.counts).toEqual({ vertices: 128, edges: 313, docs: 1 });
  });

  it("lists both concepts with real counts, including the one with no concepts row", () => {
    const list = listConcepts(projectCopy());
    expect(list.storeAvailable).toBe(true);
    const by = Object.fromEntries(list.concepts.map((c) => [c.name, c]));
    expect(Object.keys(by).sort()).toEqual(["code-graph-search", "scribe-pipeline"]);
    expect(by["code-graph-search"]!.liveVertices).toBe(74);
    expect(by["scribe-pipeline"]!.liveVertices).toBe(54);
    expect(by["scribe-pipeline"]!.inConfig).toBe(true);
    expect(by["scribe-pipeline"]!.hasSkillDoc).toBe(false);
    expect(by["scribe-pipeline"]!.badges.noSkillDoc).toBe(true);
    expect(by["code-graph-search"]!.hasSkillDoc).toBe(true);
    expect(by["code-graph-search"]!.badges.neverExtracted).toBe(false);
    expect(by["code-graph-search"]!.liveEdges).toBeGreaterThan(0);
  });

  it("includes a concept present only in the store, not in the config", () => {
    const d = projectCopy();
    const cfgPath = path.join(d, "scribe.config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    delete cfg.concepts["scribe-pipeline"];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    const c = listConcepts(d).concepts.find((x) => x.name === "scribe-pipeline");
    expect(c).toMatchObject({ inConfig: false, liveVertices: 54, globs: [] });
  });
});

describe("never creating a store", () => {
  it("a bare directory: status and list create nothing", () => {
    const d = tmp();
    const s = graphStatus(d);
    expect(s.config).toBeNull();
    expect(s.configError).toBeNull();
    expect(s.defaults).toEqual({ project: path.basename(d), tsconfig: "tsconfig.json" });
    expect(listConcepts(d)).toMatchObject({ configRoot: null, concepts: [] });
    expect(listing(d)).toEqual([]);
  });

  it("a config without a store: status/list/add leave no store or output dir", () => {
    const d = tmp();
    fs.writeFileSync(
      path.join(d, "scribe.config.json"),
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: {} })
    );
    const s = graphStatus(d);
    expect(s.config).not.toBeNull();
    expect(s.store.present).toBe(false);
    expect(s.store.counts).toBeNull();
    listConcepts(d);
    addConceptToProject(d, { name: "x", globs: ["src/**/*.ts"] });
    expect(listing(d)).toEqual(["scribe.config.json"]);
  });

  it("init writes only scribe.config.json", () => {
    const d = tmp();
    const s = initProject(d, { project: "demo", tsconfig: "tsconfig.json" });
    expect(s.config?.project).toBe("demo");
    expect(listing(d)).toEqual(["scribe.config.json"]);
    expect(s.store.present).toBe(false);
  });

  it("init refuses to clobber an existing or invalid config, and validates input", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "scribe.config.json"), "{not json");
    expect(graphStatus(d).configError).toMatch(/not a valid scribe config/);
    expect(() => initProject(d, { project: "p", tsconfig: "t" })).toThrow();
    expect(fs.readFileSync(path.join(d, "scribe.config.json"), "utf8")).toBe("{not json");
    const e = tmp();
    expect(() => initProject(e, { project: " ", tsconfig: "t" })).toThrow(/name/);
    expect(() => initProject(e, { project: "p", tsconfig: "" })).toThrow(/tsconfig/);
    expect(listing(e)).toEqual([]);
  });

  it("a nonexistent project directory throws rather than reading or creating", () => {
    expect(() => graphStatus("/nonexistent/cg-desktop")).toThrow(/not found/);
    expect(() => graphStatus("")).toThrow(/No project is open/);
  });
});

describe("add concept", () => {
  it("round-trips into the config file and lists as never extracted with a command", () => {
    const d = projectCopy();
    const before = JSON.parse(fs.readFileSync(path.join(d, "scribe.config.json"), "utf8"));
    const res = addConceptToProject(d, {
      name: "new-one",
      globs: ["a/**/*.ts", " b/*.ts ", "a/**/*.ts"],
      skill: "docs/x.md",
    });
    const after = JSON.parse(fs.readFileSync(path.join(d, "scribe.config.json"), "utf8"));
    expect(after.concepts["new-one"]).toEqual({ globs: ["a/**/*.ts", "b/*.ts"], skill: "docs/x.md" });
    expect(after.concepts["code-graph-search"]).toEqual(before.concepts["code-graph-search"]);
    const c = res.concepts.find((x) => x.name === "new-one")!;
    expect(c.liveVertices).toBe(0);
    expect(c.badges.neverExtracted).toBe(true);
    expect(c.extractCommand).toContain("code-graph extract new-one && code-graph apply new-one");
    expect(c.extractCommand).toContain(fs.realpathSync(d) === d ? d : path.basename(d));
    // Existing concepts are not flagged with the command semantic change.
    expect(res.concepts.find((x) => x.name === "scribe-pipeline")!.liveVertices).toBe(54);
  });

  it("rejects duplicates and bad input without touching the file", () => {
    const d = projectCopy();
    const file = path.join(d, "scribe.config.json");
    const orig = fs.readFileSync(file, "utf8");
    expect(() => addConceptToProject(d, { name: "scribe-pipeline", globs: ["x"] })).toThrow(/already exists/);
    expect(() => addConceptToProject(d, { name: "bad name", globs: ["x"] })).toThrow();
    expect(() => addConceptToProject(d, { name: "../evil", globs: ["x"] })).toThrow();
    expect(() => addConceptToProject(d, { name: "ok", globs: [] })).toThrow(/glob/);
    expect(() => addConceptToProject(d, { name: "ok", globs: ["x"], skill: "/etc/passwd" })).toThrow();
    expect(() => addConceptToProject(d, { name: "ok", globs: ["x"], skill: "../../x.md" })).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(orig);
  });

  it("fails clearly when there is no config", () => {
    expect(() => addConceptToProject(tmp(), { name: "a", globs: ["x"] })).toThrow(/no scribe config/);
  });
});

describe("delete concept", () => {
  it("preview changes nothing", () => {
    const d = projectCopy();
    const file = path.join(d, "scribe.config.json");
    const orig = fs.readFileSync(file, "utf8");
    const r = deleteConceptFromProject(d, { name: "scribe-pipeline", confirm: false });
    expect(r.stage).toBe("preview");
    if (r.stage === "preview") {
      expect(r.liveVertices).toBe(54);
      expect(Array.isArray(r.danglingRefs)).toBe(true);
      expect(typeof r.reportMd).toBe("string");
    }
    expect(fs.readFileSync(file, "utf8")).toBe(orig);
    expect(graphStatus(d).store.counts?.vertices).toBe(128);
  });

  it("confirm archives rows, drops config entry, keeps the FTS index consistent", async () => {
    const d = projectCopy();
    const r = deleteConceptFromProject(d, { name: "scribe-pipeline", confirm: true });
    expect(r.stage).toBe("deleted");
    if (r.stage === "deleted") expect(r.archivedVertices).toBe(54);
    const cfg = JSON.parse(fs.readFileSync(path.join(d, "scribe.config.json"), "utf8"));
    expect(Object.keys(cfg.concepts)).toEqual(["code-graph-search"]);
    const list = listConcepts(d).concepts;
    expect(list.map((c) => c.name)).toEqual(["code-graph-search"]);
    expect(graphStatus(d).store.counts?.vertices).toBe(74);
    // Rows are archived, not hard-deleted.
    closeAllStores();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(d, "scribe-output/graph.db"), { readOnly: true });
    const n = (
      db.prepare("SELECT count(*) AS c FROM vertices WHERE concept='scribe-pipeline' AND status='archived'").get() as {
        c: number;
      }
    ).c;
    expect(n).toBe(54);
    // FTS index no longer returns archived vertices' names.
    const stale = (db.prepare("SELECT count(*) AS c FROM search_fts").get() as { c: number }).c;
    expect(stale).toBeGreaterThan(0);
    db.close();
  });

  it("unknown concept throws; a config-only concept deletes without a store", () => {
    const d = projectCopy();
    expect(() => deleteConceptFromProject(d, { name: "nope", confirm: false })).toThrow(/not found/);
    const e = tmp();
    fs.writeFileSync(
      path.join(e, "scribe.config.json"),
      JSON.stringify({ project: "p", tsconfig: "t", concepts: { a: { globs: ["x"] } } })
    );
    const r = deleteConceptFromProject(e, { name: "a", confirm: true });
    expect(r.stage).toBe("deleted");
    expect(JSON.parse(fs.readFileSync(path.join(e, "scribe.config.json"), "utf8")).concepts).toEqual({});
    expect(listing(e)).toEqual(["scribe.config.json"]);
  });
});

describe("store handle lifecycle", () => {
  it("holds the db while reading and releases it on closeAllStores", () => {
    const d = projectCopy();
    const db = path.join(d, "scribe-output/graph.db");
    graphStatus(d);
    expect(heldOpen(db)).toBe(true);
    closeAllStores();
    expect(heldOpen(db)).toBe(false);
  });

  it("switching to another project closes the previous project's handle", () => {
    const a = projectCopy();
    const b = projectCopy();
    graphStatus(a);
    expect(heldOpen(path.join(a, "scribe-output/graph.db"))).toBe(true);
    graphStatus(b);
    expect(heldOpen(path.join(a, "scribe-output/graph.db"))).toBe(false);
    expect(heldOpen(path.join(b, "scribe-output/graph.db"))).toBe(true);
  });

  it("closeAllStores is idempotent and reopening afterwards works", () => {
    const d = projectCopy();
    closeAllStores();
    closeAllStores();
    graphStatus(d);
    closeAllStores();
    expect(graphStatus(d).store.counts?.vertices).toBe(128);
  });
});

describe("schema mismatch", () => {
  it("is reported without counts", async () => {
    const d = projectCopy();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(d, "scribe-output/graph.db"));
    db.exec("PRAGMA user_version = 99");
    db.close();
    const s = graphStatus(d);
    expect(s.store.present).toBe(true);
    expect(s.store.schemaMatches).toBe(false);
    expect(s.store.schemaVersion).toBe(99);
    expect(s.store.counts).toBeNull();
    expect(listConcepts(d).storeAvailable).toBe(false);
    expect(() => deleteConceptFromProject(d, { name: "scribe-pipeline", confirm: true })).toThrow(/schema/);
  });
});

describe("concept graph", () => {
  it("returns live vertices, edges and skill doc for the search concept", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    expect(g.vertices.length).toBe(74);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.doc).not.toBeNull();
  });

  it("resolves every edge endpoint to a bare key, keeping _from/_to", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const keys = new Set(g.vertices.map((v) => v._key));
    for (const e of g.edges) {
      expect(e._from).toContain("/");
      expect(e.fromKey).toBe(e._from.slice(e._from.indexOf("/") + 1));
      expect(e.toKey).toBe(e._to.slice(e._to.indexOf("/") + 1));
    }
    expect(g.edges.some((e) => keys.has(e.fromKey))).toBe(true);
  });

  it("withEndpointKeys strips prefixes, passes bare keys through and preserves fields", () => {
    const e = withEndpointKeys({ _from: "vertices/a1", _to: "docs/c::skill", type: "calls" });
    expect(e).toEqual({ _from: "vertices/a1", _to: "docs/c::skill", type: "calls", fromKey: "a1", toKey: "c::skill" });
    expect(withEndpointKeys({ _from: "x", _to: "y" })).toMatchObject({ fromKey: "x", toKey: "y" });
  });

  it("throws without a store", async () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "scribe.config.json"), JSON.stringify({ project: "p", tsconfig: "t", concepts: {} }));
    await expect(conceptGraph(d, { concept: "a" })).rejects.toThrow(/no usable graph store/);
    expect(listing(d)).toEqual(["scribe.config.json"]);
  });
});
