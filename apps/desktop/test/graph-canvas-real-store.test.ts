// The canvas model against the real thing: the graph:concept payload main builds from a copy of this
// repo's own store, laid out by the renderer's model. No mocks, no hand-built edges.

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { closeAllStores, conceptGraph } from "../src/main/graph.js";
import { defaultEnabledTypes, edgeCounts, layoutGraph, neighborsOf } from "../src/renderer/src/lib/graph-model";
import { EDGE_TYPES, VERTEX_TYPES } from "../src/renderer/src/lib/graph-palette";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];

function projectCopy(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cg-canvas-"));
  roots.push(d);
  fs.copyFileSync(path.join(repo, "scribe.config.json"), path.join(d, "scribe.config.json"));
  fs.mkdirSync(path.join(d, "scribe-output"));
  fs.copyFileSync(path.join(repo, "scribe-output/graph.db"), path.join(d, "scribe-output/graph.db"));
  return d;
}

/** Ground truth read straight from the source store, so the tests track this repo's graph as it is regraphed. */
function truth(concept: string) {
  const db = new DatabaseSync(path.join(repo, "scribe-output/graph.db"), { readOnly: true });
  const live = (
    db.prepare("SELECT count(*) AS c FROM vertices WHERE concept=? AND status='live'").get(concept) as { c: number }
  ).c;
  const hasDoc = (db.prepare("SELECT count(*) AS c FROM docs WHERE concept=?").get(concept) as { c: number }).c > 0;
  const rows = db.prepare("SELECT type, count(*) AS c FROM edges WHERE concept=? GROUP BY type").all(concept) as {
    type: string;
    c: number;
  }[];
  // Layout nodes are the concept's live vertices plus its skill doc; an edge with any other endpoint is skipped.
  const nodeKeys = new Set([
    ...(db.prepare("SELECT key FROM vertices WHERE concept=? AND status='live'").all(concept) as { key: string }[]).map(
      (r) => r.key
    ),
    ...(db.prepare("SELECT key FROM docs WHERE concept=?").all(concept) as { key: string }[]).map((r) => r.key),
  ]);
  const ends = db.prepare("SELECT from_key, to_key, crosses_concept AS x FROM edges WHERE concept=?").all(concept) as {
    from_key: string;
    to_key: string;
    x: number;
  }[];
  const outside = ends.filter((e) => !nodeKeys.has(e.from_key) || !nodeKeys.has(e.to_key));
  const skipped = outside.length;
  const skippedCross = outside.filter((e) => e.x === 1).length;
  db.close();
  const edges = Object.fromEntries(rows.map((r) => [r.type, r.c]));
  return { live, hasDoc, edges, skipped, skippedCross, count: (t: string) => edges[t] ?? 0 };
}

afterAll(() => {
  closeAllStores();
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
});

describe("canvas model over the real store", () => {
  it("search concept: per-concept edge counts, default toggles, one node per vertex plus the skill doc", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const counts = Object.fromEntries(edgeCounts(g.edges).map((c) => [c.type, c.count]));
    const t = truth("code-graph-search");
    expect(counts).toEqual(t.edges);
    expect(counts["documented-by"]).toBe(t.live);
    expect([...defaultEnabledTypes(g.edges)].sort()).toEqual(["calls", "describes", "has-type"]);
    const l = layoutGraph(g, defaultEnabledTypes(g.edges));
    expect(l.nodes).toHaveLength(t.live + 1);
    expect(l.nodes.filter((n) => n.isDoc)).toHaveLength(1);
    expect(l.edges.some((e) => e.type === "documented-by")).toBe(false);
    for (const n of l.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("pipeline concept: one node per vertex (plus the skill doc when the store has one), counts sum with search to the store totals", async () => {
    const root = projectCopy();
    const p = await conceptGraph(root, { concept: "scribe-pipeline" });
    const s = await conceptGraph(root, { concept: "code-graph-search" });
    const total = (g: typeof p, t: string) => g.edges.filter((e) => e.type === t).length;
    const tp = truth("scribe-pipeline");
    const ts = truth("code-graph-search");
    expect(total(p, "calls")).toBe(tp.count("calls"));
    expect(total(p, "has-type")).toBe(tp.count("has-type"));
    expect(total(p, "calls") + total(s, "calls")).toBe(tp.count("calls") + ts.count("calls"));
    expect(total(p, "has-type") + total(s, "has-type")).toBe(tp.count("has-type") + ts.count("has-type"));
    const l = layoutGraph(p, defaultEnabledTypes(p.edges));
    expect(l.nodes).toHaveLength(tp.live + (tp.hasDoc ? 1 : 0));
    expect(l.nodes.some((n) => n.isDoc)).toBe(tp.hasDoc);
  });

  it("the store's own edge types and vertex types are all in the palette", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    for (const e of g.edges) expect(EDGE_TYPES as readonly string[]).toContain(e.type);
    for (const v of g.vertices) expect(VERTEX_TYPES as readonly string[]).toContain(v.type);
  });

  it("the describes edge points at the concept, not a vertex: it is skipped, never drawn, never a throw", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const all = new Set(g.edges.map((e) => e.type));
    const l = layoutGraph(g, all);
    const d = g.edges.find((e) => e.type === "describes")!;
    expect(d.toKey).toBe("code-graph-search");
    expect(l.skipped).toBe(truth("code-graph-search").skipped);
    expect(l.edges.some((e) => e.type === "describes")).toBe(false);
  });

  it("cross-concept edges are among the skipped ones, and the store must hold some", async () => {
    const t = truth("code-graph-search");
    expect(
      t.skippedCross,
      "the local store has no crosses_concept=1 edge outside code-graph-search; run `just regraph` (extract >= 0.3.27)"
    ).toBeGreaterThan(0);
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const l = layoutGraph(g, new Set(g.edges.map((e) => e.type)));
    // every skipped edge is the describes edge or a cross-concept/non-live one; cross ones are counted in the total
    expect(l.skipped).toBeGreaterThanOrEqual(t.skippedCross);
    expect(l.skipped).toBe(t.skipped);
  });

  it("documented-by on: the skill doc is the sink of every live vertex; off restores the layout exactly", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const base = defaultEnabledTypes(g.edges);
    const off = layoutGraph(g, base);
    const on = layoutGraph(g, new Set([...base, "documented-by"]));
    const doc = g.doc!._key;
    expect(on.edges.filter((e) => e.type === "documented-by" && e.to === doc)).toHaveLength(
      truth("code-graph-search").live
    );
    expect(layoutGraph(g, base)).toEqual(off);
  });

  it("neighbours of every vertex resolve from the fetched edges, and vertex neighbours exist in the concept", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const keys = new Set(g.vertices.map((v) => v._key));
    for (const v of g.vertices) {
      for (const n of neighborsOf(g, v._key)) {
        expect(n.vertex === null || keys.has(n.key)).toBe(true);
        if (n.vertex) expect(n.vertex._key).toBe(n.key);
      }
    }
  });
});
