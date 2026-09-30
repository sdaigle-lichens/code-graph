// The canvas palette. Every colour is a CSS custom property from @repo/styles
// (`scss/abstracts/_graph.scss`), defined for both themes, so nothing here holds a literal colour.

export const VERTEX_TYPES = [
  "store",
  "store-state",
  "store-action",
  "function",
  "hook",
  "component",
  "type-def",
  "callsite",
  "effect",
] as const;
export type VertexType = (typeof VERTEX_TYPES)[number];

export const EDGE_TYPES = [
  "calls",
  "reads",
  "writes",
  "mounts",
  "subscribes",
  "uses-hook",
  "delegates-to",
  "has-type",
  "triggers",
  "describes",
  "documented-by",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** Edges that describe documentation coverage rather than code structure. */
export const DOCUMENTATION_EDGES: readonly EdgeType[] = ["documented-by"];

/** Pseudo vertex type of the skill-document root node. */
export const SKILL_DOC_TYPE = "skill-doc";

const isVertexType = (t: string): t is VertexType => (VERTEX_TYPES as readonly string[]).includes(t);
const isEdgeType = (t: string): t is EdgeType => (EDGE_TYPES as readonly string[]).includes(t);

export interface NodeStyle {
  stroke: string;
  fill: string;
}

export function vertexColorVar(type: string): string {
  return type === SKILL_DOC_TYPE ? "--vt-skill-doc" : isVertexType(type) ? `--vt-${type}` : "--vt-callsite";
}

export function nodeStyle(type: string): NodeStyle {
  const v = `var(${vertexColorVar(type)})`;
  return { stroke: v, fill: `color-mix(in srgb, ${v} 14%, var(--bg-elev))` };
}

export interface EdgeStyle {
  stroke: string;
  /** SVG stroke-dasharray; colour alone is not enough to tell eleven types apart. */
  dash: string | undefined;
  width: number;
}

const EDGE_DASH: Record<EdgeType, string | undefined> = {
  calls: undefined,
  reads: "6 3",
  writes: "2 3",
  mounts: undefined,
  subscribes: "8 3 2 3",
  "uses-hook": "6 3",
  "delegates-to": "10 4",
  "has-type": "1 4",
  triggers: "8 3 2 3",
  describes: "2 3",
  "documented-by": "1 5",
};

export function edgeStyle(type: string): EdgeStyle {
  const known = isEdgeType(type);
  return {
    stroke: `var(${known ? `--et-${type}` : "--et-calls"})`,
    dash: known ? EDGE_DASH[type] : undefined,
    width: type === "calls" ? 1 : 1.4,
  };
}
