// The canvas model against the real thing: the graph:concept payload main builds from a copy of this
// repo's own store, laid out by the renderer's model. No mocks, no hand-built edges.

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

afterAll(() => {
  closeAllStores();
  for (const d of roots) fs.rmSync(d, { recursive: true, force: true });
});

describe("canvas model over the real store", () => {
  it("search concept: per-concept edge counts, default toggles, one node per vertex plus the skill doc", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const counts = Object.fromEntries(edgeCounts(g.edges).map((c) => [c.type, c.count]));
    expect(counts).toEqual({ calls: 78, "has-type": 67, describes: 1, "documented-by": 74 });
    expect([...defaultEnabledTypes(g.edges)].sort()).toEqual(["calls", "describes", "has-type"]);
    const l = layoutGraph(g, defaultEnabledTypes(g.edges));
    expect(l.nodes).toHaveLength(75);
    expect(l.nodes.filter((n) => n.isDoc)).toHaveLength(1);
    expect(l.edges.some((e) => e.type === "documented-by")).toBe(false);
    for (const n of l.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("pipeline concept: 54 nodes, no skill doc root, counts sum with search to the store totals", async () => {
    const root = projectCopy();
    const p = await conceptGraph(root, { concept: "scribe-pipeline" });
    const s = await conceptGraph(root, { concept: "code-graph-search" });
    const total = (g: typeof p, t: string) => g.edges.filter((e) => e.type === t).length;
    expect(total(p, "calls")).toBe(74);
    expect(total(p, "has-type")).toBe(19);
    expect(total(p, "calls") + total(s, "calls")).toBe(152);
    expect(total(p, "has-type") + total(s, "has-type")).toBe(86);
    const l = layoutGraph(p, defaultEnabledTypes(p.edges));
    expect(l.nodes).toHaveLength(54);
    expect(l.nodes.some((n) => n.isDoc)).toBe(false);
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
    expect(l.skipped).toBe(1);
    expect(l.edges.some((e) => e.type === "describes")).toBe(false);
  });

  it("documented-by on: the skill doc is the sink of every live vertex; off restores the layout exactly", async () => {
    const g = await conceptGraph(projectCopy(), { concept: "code-graph-search" });
    const base = defaultEnabledTypes(g.edges);
    const off = layoutGraph(g, base);
    const on = layoutGraph(g, new Set([...base, "documented-by"]));
    const doc = g.doc!._key;
    expect(on.edges.filter((e) => e.type === "documented-by" && e.to === doc)).toHaveLength(74);
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
