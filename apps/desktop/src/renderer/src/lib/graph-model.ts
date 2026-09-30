// Pure model behind the canvas: counts, layout, neighbours. No React, no DOM, no node — so it is
// unit-testable and cannot reach the library. Endpoints are matched on the resolved `fromKey` /
// `toKey` the main process supplies; handles are never parsed here.

import dagre from "@dagrejs/dagre";
import type { ConceptGraph, GraphEdge, GraphVertex } from "../../../shared/ipc";
import { DOCUMENTATION_EDGES, EDGE_TYPES, SKILL_DOC_TYPE } from "./graph-palette";

export const NODE_HEIGHT = 44;
export const NODE_MIN_WIDTH = 96;
export const NODE_MAX_WIDTH = 300;
const CHAR_W = 7;
const NODE_PAD = 20;
const LANE_GAP = 4;

export interface LayoutNode {
  key: string;
  type: string;
  name: string;
  detail: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stale: boolean;
  isDoc: boolean;
}

export interface LayoutEdge {
  key: string;
  type: string;
  from: string;
  to: string;
  points: { x: number; y: number }[];
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Enabled edges skipped because an endpoint has no node (cross-concept). */
  skipped: number;
  /** Enabled edges from a node to itself; dagre cannot route them, so they are not drawn. */
  selfLoops: number;
}

/** Live count of every edge type present, in palette order, then unknown types alphabetically. */
export function edgeCounts(edges: readonly GraphEdge[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const known = EDGE_TYPES.filter((t) => counts.has(t));
  const unknown = [...counts.keys()].filter((t) => !(EDGE_TYPES as readonly string[]).includes(t)).sort();
  return [...known, ...unknown].map((type) => ({ type, count: counts.get(type)! }));
}

export function defaultEnabledTypes(edges: readonly GraphEdge[]): Set<string> {
  return new Set(
    edgeCounts(edges)
      .map((c) => c.type)
      .filter((t) => !(DOCUMENTATION_EDGES as readonly string[]).includes(t))
  );
}

const nodeWidth = (...labels: string[]) =>
  Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, Math.max(...labels.map((l) => l.length)) * CHAR_W + NODE_PAD));

const clip = (s: string, width: number) => {
  const max = Math.floor((width - NODE_PAD) / CHAR_W);
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
};

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

export function layoutGraph(graph: ConceptGraph, enabled: ReadonlySet<string>): GraphLayout {
  const g = new dagre.graphlib.Graph();
  // Wide rank separation leaves room for labels; tight node separation keeps ~100 nodes on screen.
  g.setGraph({ rankdir: "LR", ranksep: 90, nodesep: 8, edgesep: 6, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const meta = new Map<string, Omit<LayoutNode, "x" | "y">>();
  if (graph.doc) {
    const name = baseName(graph.doc.path) || graph.doc._key;
    const detail = "skill document";
    const width = nodeWidth(name, detail);
    meta.set(graph.doc._key, {
      key: graph.doc._key,
      type: SKILL_DOC_TYPE,
      name: clip(name, width),
      detail,
      width,
      height: NODE_HEIGHT,
      stale: false,
      isDoc: true,
    });
  }
  for (const v of graph.vertices) {
    const detail = `${v.filepath}:${v.start_line}`;
    const width = nodeWidth(v.name, detail);
    meta.set(v._key, {
      key: v._key,
      type: v.type,
      name: clip(v.name, width),
      detail: tail(detail, Math.floor((width - NODE_PAD) / CHAR_W)),
      width,
      height: NODE_HEIGHT,
      stale: v.agent?.stale === true,
      isDoc: false,
    });
  }
  for (const n of meta.values()) g.setNode(n.key, { width: n.width, height: n.height });

  let skipped = 0;
  let selfLoops = 0;
  const drawn = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    if (!enabled.has(e.type)) continue;
    if (e.fromKey === e.toKey) {
      selfLoops++;
      continue;
    }
    if (!meta.has(e.fromKey) || !meta.has(e.toKey)) {
      skipped++;
      continue;
    }
    // dagre cannot route parallel edges between one pair of nodes (it throws), so the layout gets one
    // edge per directed pair, and a pair's types are drawn as lanes along that one route. Several
    // call sites between the same two functions collapse to one drawn edge.
    g.setEdge(e.fromKey, e.toKey, {});
    const id = `${e.fromKey}|${e.toKey}|${e.type}`;
    if (!drawn.has(id)) drawn.set(id, e);
  }
  const lanes = new Map<string, string[]>();
  for (const e of drawn.values()) {
    const pair = `${e.fromKey}|${e.toKey}`;
    lanes.set(pair, [...(lanes.get(pair) ?? []), e.type]);
  }

  dagre.layout(g);
  const info = g.graph();
  const nodes: LayoutNode[] = [...meta.values()].map((n) => {
    const p = g.node(n.key);
    return { ...n, x: p.x, y: p.y };
  });
  const edges: LayoutEdge[] = [...drawn.values()].map((e) => {
    const types = lanes.get(`${e.fromKey}|${e.toKey}`)!;
    const dy = (types.indexOf(e.type) - (types.length - 1) / 2) * LANE_GAP;
    return {
      key: e._key,
      type: e.type,
      from: e.fromKey,
      to: e.toKey,
      points: g.edge(e.fromKey, e.toKey).points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y + dy })),
    };
  });
  return { nodes, edges, width: info.width ?? 0, height: info.height ?? 0, skipped, selfLoops };
}

/** Keep the tail of a long path: the file name matters more than the leading directories. */
function tail(s: string, max: number): string {
  return s.length > max ? `…${s.slice(s.length - max + 1)}` : s;
}

export interface Neighbor {
  edgeKey: string;
  edgeType: string;
  direction: "out" | "in";
  key: string;
  /** The vertex when it is in the concept; null for the skill document or an outside endpoint. */
  vertex: GraphVertex | null;
  isDoc: boolean;
}

/** Every edge touching `key`, from the edges already fetched — all types, whatever the toggles say. */
export function neighborsOf(graph: ConceptGraph, key: string): Neighbor[] {
  const byKey = new Map(graph.vertices.map((v) => [v._key, v]));
  const out: Neighbor[] = [];
  const seen = new Set<string>();
  for (const e of graph.edges) {
    const outgoing = e.fromKey === key;
    if (!outgoing && e.toKey !== key) continue;
    const other = outgoing ? e.toKey : e.fromKey;
    // Several call sites to one target are one neighbor.
    const id = `${outgoing ? "out" : "in"}|${e.type}|${other}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      edgeKey: e._key,
      edgeType: e.type,
      direction: outgoing ? "out" : "in",
      key: other,
      vertex: byKey.get(other) ?? null,
      isDoc: graph.doc?._key === other,
    });
  }
  return out;
}
