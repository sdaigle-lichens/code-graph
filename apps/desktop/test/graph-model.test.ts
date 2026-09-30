import { describe, it, expect } from "vitest";
import type { ConceptGraph, GraphEdge, GraphVertex } from "../src/shared/ipc";
import { defaultEnabledTypes, edgeCounts, layoutGraph, neighborsOf } from "../src/renderer/src/lib/graph-model";

const vertex = (key: string, over: Partial<GraphVertex> = {}): GraphVertex => ({
  _key: key,
  displayKey: key,
  concept: "c",
  type: "function",
  name: `fn_${key}`,
  filepath: `src/${key}.ts`,
  start_line: 3,
  end_line: 9,
  signature: `function fn_${key}()`,
  status: "live",
  ...over,
});
const edge = (key: string, type: string, from: string, to: string): GraphEdge => ({
  _key: key,
  _from: `vertices/${from}`,
  _to: `vertices/${to}`,
  fromKey: from,
  toKey: to,
  type,
  concept: "c",
});
const doc = { _key: "c::skill", concept: "c", kind: "skill", path: "skills/c/SKILL.md", body_md: "", body_hash: "h" };

const graph: ConceptGraph = {
  concept: "c",
  vertices: [
    vertex("a"),
    vertex("b", { type: "type-def" }),
    vertex("s", { agent: { authored_by: "claude", stale: true } }),
  ],
  edges: [
    edge("e1", "calls", "a", "b"),
    edge("e2", "has-type", "a", "b"),
    edge("e3", "documented-by", "c::skill", "a"),
    edge("e4", "documented-by", "c::skill", "b"),
    edge("e5", "calls", "a", "elsewhere-concept-key"),
    { ...edge("e6", "calls", "gone", "a"), crosses_concept: true },
  ],
  doc,
};

describe("edge counts and defaults", () => {
  it("counts every edge by type, in palette order", () => {
    expect(edgeCounts(graph.edges)).toEqual([
      { type: "calls", count: 3 },
      { type: "has-type", count: 1 },
      { type: "documented-by", count: 2 },
    ]);
  });
  it("starts with documentation edges off", () => {
    expect([...defaultEnabledTypes(graph.edges)].sort()).toEqual(["calls", "has-type"]);
  });
});

describe("layoutGraph", () => {
  const on = (...t: string[]) => new Set(t);

  it("tolerates edge endpoints with no matching node: skipped, counted, no throw", () => {
    const l = layoutGraph(graph, on("calls"));
    expect(l.edges.map((e) => e.key)).toEqual(["e1"]);
    expect(l.skipped).toBe(2);
    expect(l.nodes.map((n) => n.key).sort()).toEqual(["a", "b", "c::skill", "s"]);
    for (const n of l.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
  });

  it("does not count a skipped edge whose type is off", () => {
    expect(layoutGraph(graph, on("has-type")).skipped).toBe(0);
  });

  it("does not draw self-references, and does not throw on them", () => {
    const g = { ...graph, edges: [edge("loop", "calls", "a", "a"), edge("e1", "calls", "a", "b")] };
    const l = layoutGraph(g, on("calls"));
    expect(l.selfLoops).toBe(1);
    expect(l.edges.map((e) => e.key)).toEqual(["e1"]);
  });

  it("collapses parallel call sites and lays out a pair carrying several types without throwing", () => {
    const g = {
      ...graph,
      edges: [edge("x1", "calls", "a", "b"), edge("x2", "calls", "a", "b"), edge("x3", "has-type", "a", "b")],
    };
    const l = layoutGraph(g, on("calls", "has-type"));
    expect(l.edges.map((e) => e.type).sort()).toEqual(["calls", "has-type"]);
    const [p, q] = l.edges;
    expect(p!.points[0]!.y).not.toBe(q!.points[0]!.y);
  });

  it("lays out left to right: a caller sits left of its callee", () => {
    const l = layoutGraph(graph, on("calls"));
    const at = (k: string) => l.nodes.find((n) => n.key === k)!;
    expect(at("a").x).toBeLessThan(at("b").x);
  });

  it("recomputes when a type is toggled: documented-by makes the doc node the hub", () => {
    const off = layoutGraph(graph, on("calls", "has-type"));
    const withDocs = layoutGraph(graph, on("calls", "has-type", "documented-by"));
    expect(off.edges.some((e) => e.type === "documented-by")).toBe(false);
    expect(withDocs.edges.filter((e) => e.from === "c::skill")).toHaveLength(2);
    expect(withDocs.nodes.find((n) => n.key === "c::skill")!.x).toBeLessThan(
      withDocs.nodes.find((n) => n.key === "a")!.x
    );
    expect(layoutGraph(graph, on("calls", "has-type")).nodes).toEqual(off.nodes);
  });

  it("gives the skill document a distinct root node, and flags stale vertices", () => {
    const l = layoutGraph(graph, on());
    expect(l.nodes.find((n) => n.key === "c::skill")).toMatchObject({ isDoc: true, type: "skill-doc" });
    expect(l.nodes.find((n) => n.key === "s")!.stale).toBe(true);
    expect(l.nodes.find((n) => n.key === "a")!.stale).toBe(false);
  });

  it("labels a node with its name and file path with start line", () => {
    const a = layoutGraph(graph, on()).nodes.find((n) => n.key === "a")!;
    expect(a.name).toBe("fn_a");
    expect(a.detail).toBe("src/a.ts:3");
  });

  it("handles a concept with no skill doc and no edges", () => {
    const l = layoutGraph({ concept: "c", vertices: [vertex("a")], edges: [], doc: null }, on());
    expect(l.nodes).toHaveLength(1);
  });
});

describe("neighborsOf", () => {
  it("derives neighbours from all fetched edges, whatever the toggles", () => {
    const n = neighborsOf(graph, "a");
    expect(n.map((x) => `${x.direction}:${x.edgeType}:${x.key}`).sort()).toEqual([
      "in:calls:gone",
      "in:documented-by:c::skill",
      "out:calls:b",
      "out:calls:elsewhere-concept-key",
      "out:has-type:b",
    ]);
  });
  it("dedupes repeated edges to one target by direction, type and other end", () => {
    const g = {
      ...graph,
      edges: [edge("d1", "calls", "a", "b"), edge("d2", "calls", "a", "b"), edge("d3", "has-type", "a", "b")],
    };
    expect(neighborsOf(g, "a").map((n) => n.edgeType)).toEqual(["calls", "has-type"]);
  });
  it("marks the doc and outside endpoints as non-vertices", () => {
    const n = neighborsOf(graph, "a");
    expect(n.find((x) => x.key === "b")!.vertex?.name).toBe("fn_b");
    expect(n.find((x) => x.key === "c::skill")).toMatchObject({ vertex: null, isDoc: true });
    expect(n.find((x) => x.key === "gone")).toMatchObject({ vertex: null, isDoc: false });
  });
});
