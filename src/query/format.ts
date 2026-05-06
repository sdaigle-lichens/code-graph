import type {
  ConceptResult,
  ImpactResult,
  CrossEntry,
  VertexResult,
  DocVertex,
  FileResult,
} from "./queries.js";
import type { Vertex, Edge } from "../schema.js";

export type FormatOpts = {
  maxTokens: number;
  includeSkill: boolean;
  json: boolean;
};

// Token estimator: chars / 4
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function vertexLine(v: Vertex): string {
  const loc = `@${v.filepath}:${v.start_line}-${v.end_line}`;
  const purpose = v.purpose ? ` — ${v.purpose}` : "";
  return `- ${loc} — \`${v.name}\` (${v.type})${purpose}`;
}

function edgeLine(e: Edge, fromName?: string, toName?: string): string {
  const from = fromName ?? e._from.split("/")[1] ?? e._from;
  const to = toName ?? e._to.split("/")[1] ?? e._to;
  const line = e.line !== undefined ? ` (line ${e.line})` : "";
  const reason = e.reason ? ` — ${e.reason}` : "";
  return `- \`${from}\` --${e.type}--> \`${to}\`${line}${reason}`;
}

export function truncate(markdown: string, maxTokens: number): string {
  if (estimateTokens(markdown) <= maxTokens) return markdown;

  // Pass 1: strip reason strings from edge lines (lines containing "--type-->")
  const pass1 = markdown.replace(/(--[\w-]+-->[^—\n]+) — [^\n]+/g, "$1");

  if (estimateTokens(pass1) <= maxTokens) return pass1;

  // Pass 2: truncate skill body, preserving first ~500 chars.
  // Skill body ends at "## Vertices" or "## Edges" (known top-level sections).
  const skillHeader = "## Skill";
  const skillIdx = pass1.indexOf(skillHeader);
  if (skillIdx !== -1) {
    const skillContentStart = skillIdx + skillHeader.length;
    // Find next top-level section (Vertices or Edges), not any ## inside the skill body
    let nextSection = -1;
    for (const marker of ["\n## Vertices", "\n## Edges"]) {
      const idx = pass1.indexOf(marker, skillContentStart);
      if (idx !== -1 && (nextSection === -1 || idx < nextSection)) {
        nextSection = idx;
      }
    }
    if (nextSection !== -1) {
      const keep500 = pass1.slice(skillContentStart, skillContentStart + 2000);
      const truncated =
        pass1.slice(0, skillContentStart) +
        keep500 +
        "\n\n_[skill body truncated]_\n" +
        pass1.slice(nextSection);
      if (estimateTokens(truncated) <= maxTokens) return truncated;
      // Still over budget — hard truncate
      const targetChars = maxTokens * 4;
      return truncated.slice(0, targetChars) + "\n\n_[truncated]_";
    }
  }

  // Final fallback: hard truncate
  const targetChars = maxTokens * 4;
  return pass1.slice(0, targetChars) + "\n\n_[truncated]_";
}

export function formatConcept(
  result: ConceptResult,
  conceptName: string,
  opts: FormatOpts
): string {
  const { vertices, edges, doc } = result;

  const nameMap = new Map(vertices.map((v) => [v._key, v.name]));

  const lines: string[] = [];
  lines.push(`# Concept: ${conceptName}`);
  lines.push("");

  if (opts.includeSkill && doc?.body_md) {
    lines.push("## Skill (invariants, algorithms, gotchas)");
    lines.push("");
    lines.push(doc.body_md);
    lines.push("");
  }

  lines.push(`## Vertices (${vertices.length})`);
  lines.push("");
  for (const v of vertices) {
    lines.push(vertexLine(v));
  }
  lines.push("");

  lines.push(`## Edges (${edges.length})`);
  lines.push("");
  for (const e of edges) {
    const fromKey = e._from.split("/")[1] ?? e._from;
    const toKey = e._to.split("/")[1] ?? e._to;
    lines.push(edgeLine(e, nameMap.get(fromKey), nameMap.get(toKey)));
  }

  return truncate(lines.join("\n"), opts.maxTokens);
}

export function formatImpact(
  result: ImpactResult,
  symbol: string,
  direction: string,
  opts: FormatOpts
): string {
  if (result.ambiguous) return ""; // handled by caller (exit 4)
  if (result.notFound) return ""; // handled by caller (exit 6)

  const direct = result.results.filter((r) => r.depth === 1);
  const indirect = result.results.filter((r) => r.depth >= 2);

  const lines: string[] = [];
  lines.push(`# Impact (${direction}, depth 2): ${symbol}`);
  lines.push("");

  if (direct.length > 0) {
    lines.push(`## Direct ${direction === "in" ? "callers" : direction === "out" ? "callees" : "neighbors"}`);
    lines.push("");
    for (const r of direct) {
      const loc = `@${r.vertex.filepath}:${r.edge.line ?? r.vertex.start_line}`;
      const reason = r.edge.reason ? ` — ${r.edge.reason}` : "";
      lines.push(`- ${loc} — \`${r.vertex.name}\`${reason}`);
    }
    lines.push("");
  }

  if (indirect.length > 0) {
    lines.push(`## Indirect ${direction === "in" ? "callers" : direction === "out" ? "callees" : "neighbors"} (depth 2)`);
    lines.push("");
    for (const r of indirect) {
      const loc = `@${r.vertex.filepath}:${r.vertex.start_line}`;
      lines.push(`- ${loc} — \`${r.vertex.name}\``);
    }
    lines.push("");
  }

  if (direct.length === 0 && indirect.length === 0) {
    lines.push(`No ${direction} impact found for \`${symbol}\`.`);
  }

  return truncate(lines.join("\n"), opts.maxTokens);
}

export function formatCross(
  entries: CrossEntry[],
  a: string,
  b: string,
  opts: FormatOpts
): string {
  if (entries.length === 0) {
    return `No cross-concept edges between ${a} and ${b}.`;
  }

  const lines: string[] = [];
  lines.push(`# Cross: ${a} ↔ ${b}`);
  lines.push("");

  for (const { edge, from, to } of entries) {
    const reason = edge.reason ? ` — ${edge.reason}` : "";
    lines.push(
      `- \`${from.concept}::${from.name}\` --${edge.type}--> \`${to.concept}::${to.name}\`${reason}`
    );
  }

  return truncate(lines.join("\n"), opts.maxTokens);
}

export function formatFile(result: FileResult, opts: FormatOpts): string {
  const lines: string[] = [];
  lines.push(`# File: ${result.filepath}`);
  lines.push(`Vertices: ${result.entries.length}`);
  lines.push("");

  for (const entry of result.entries) {
    const v = entry.vertex;
    const purpose = v.purpose ? ` — ${v.purpose}` : " — _unenriched_";
    lines.push(
      `## \`${v.name}\` (${v.type}, ${v.concept}) — L${v.start_line}-${v.end_line}`
    );
    lines.push(purpose);
    if (v.tags && v.tags.length > 0) lines.push(`tags: ${v.tags.join(", ")}`);
    if (v.cross_concept_refs && v.cross_concept_refs.length > 0) {
      lines.push(`cross-concept refs: ${v.cross_concept_refs.join(", ")}`);
    }
    const outNamed = entry.edges_out.filter((n) => n.vertex.name);
    const inNamed = entry.edges_in.filter((n) => n.vertex.name);
    if (outNamed.length > 0) {
      lines.push(
        `↓ calls (${outNamed.length}): ${outNamed
          .map((n) => `\`${n.vertex.name}\``)
          .slice(0, 8)
          .join(", ")}`
      );
    }
    if (inNamed.length > 0) {
      lines.push(
        `↑ called by (${inNamed.length}): ${inNamed
          .map((n) => `\`${n.vertex.name}\``)
          .slice(0, 8)
          .join(", ")}`
      );
    }
    lines.push("");
  }

  return truncate(lines.join("\n"), opts.maxTokens);
}

export function formatVertex(
  result: VertexResult,
  opts: FormatOpts
): string {
  if (!result) return "";

  const { vertex: v, neighbors } = result;
  const lines: string[] = [];

  lines.push(`# Vertex: \`${v.name}\` @${v.filepath}:${v.start_line}`);
  lines.push("");

  lines.push(`\`${v.name}\` (${v.type}) — ${v.concept}`);
  lines.push(`Lines: ${v.start_line}-${v.end_line}`);
  if (v.purpose) lines.push(`Purpose: ${v.purpose}`);
  lines.push(`Signature: \`${v.signature}\``);
  if (v.inputs && v.inputs.length > 0) {
    if (v.inputs.length === 1) lines.push(`Inputs: ${v.inputs[0]}`);
    else { lines.push("Inputs:"); for (const i of v.inputs) lines.push(`  - ${i}`); }
  }
  if (v.outputs && v.outputs.length > 0) {
    if (v.outputs.length === 1) lines.push(`Outputs: ${v.outputs[0]}`);
    else { lines.push("Outputs:"); for (const o of v.outputs) lines.push(`  - ${o}`); }
  }
  if (v.tags && v.tags.length > 0) lines.push(`Tags: ${v.tags.join(", ")}`);
  if (v.cross_concept_refs && v.cross_concept_refs.length > 0) lines.push(`Cross-concept refs: ${v.cross_concept_refs.join(", ")}`);
  lines.push("");

  if (neighbors.length > 0) {
    lines.push("## Neighbors");
    lines.push("");
    for (const { neighbor: n, edge: e } of neighbors) {
      const isOut = e._from === `vertices/${v._key}`;
      const loc = n.filepath ? ` — ${n.filepath}:${n.start_line}` : "";
      const arrow = isOut ? `→ \`${n.name}\`` : `← \`${n.name}\``;
      lines.push(`- ${arrow} via ${e.type}${loc}`);
    }
  }

  return truncate(lines.join("\n"), opts.maxTokens);
}
