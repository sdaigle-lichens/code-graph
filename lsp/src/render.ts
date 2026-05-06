import { isAbsolute, resolve as resolvePath } from "node:path";
import type { FileVertexEntry, FileResult } from "./types.js";

function fileLink(label: string, filepath: string, line: number, workspaceRoot: string): string {
  const abs = isAbsolute(filepath) ? filepath : resolvePath(workspaceRoot, filepath);
  const uri = `file://${abs}#L${line}`;
  return `[\`${label}\`](${uri})`;
}

export function renderHover(
  entry: FileVertexEntry,
  result: FileResult,
  workspaceRoot = ""
): string {
  const v = entry.vertex;
  const lines: string[] = [];

  lines.push(`**${v.name}** · \`${v.type}\` · \`${v.concept}\``);
  lines.push("");

  if (v.purpose) {
    lines.push(v.purpose);
  } else {
    lines.push(`_unenriched — run \`/scribe-enrich ${v.concept}\`_`);
  }
  lines.push("");

  if (v.tags && v.tags.length > 0) {
    lines.push(`**tags**: ${v.tags.map((t) => `\`${t}\``).join(" · ")}`);
  }

  if (v.inputs && v.inputs.length > 0) {
    lines.push(`**inputs**: ${v.inputs.map((s) => `\`${s}\``).join(", ")}`);
  }
  if (v.outputs && v.outputs.length > 0) {
    lines.push(`**outputs**: ${v.outputs.map((s) => `\`${s}\``).join(", ")}`);
  }

  if (v.cross_concept_refs && v.cross_concept_refs.length > 0) {
    lines.push(
      `**cross-concept refs**: ${v.cross_concept_refs
        .map((r) => `\`${r}\``)
        .join(", ")}`
    );
  }

  const doc = v.document_ref ? result.doc_by_concept[v.concept] : null;
  if (doc) {
    lines.push(`**document**: \`${doc.path}\``);
  }

  if (v.agent.stale) {
    lines.push(`> ⚠ \`agent.stale = true\` — purpose may be outdated.`);
  }

  const outNamed = entry.edges_out.filter((n) => n.vertex.name);
  const inNamed = entry.edges_in.filter((n) => n.vertex.name);

  lines.push("");
  lines.push(`↓ calls: ${outNamed.length} · ↑ called by: ${inNamed.length}`);

  if (outNamed.length > 0) {
    lines.push("");
    lines.push("**Calls**:");
    for (const n of outNamed.slice(0, 10)) {
      const name =
        workspaceRoot && n.vertex.filepath && n.vertex.start_line
          ? fileLink(n.vertex.name, n.vertex.filepath, n.vertex.start_line, workspaceRoot)
          : `\`${n.vertex.name}\``;
      const loc =
        !workspaceRoot && n.vertex.filepath && n.vertex.start_line
          ? ` — \`${n.vertex.filepath}:${n.vertex.start_line}\``
          : "";
      lines.push(`- ${name} (${n.edge.type})${loc}`);
    }
  }

  if (inNamed.length > 0) {
    lines.push("");
    lines.push("**Called by**:");
    for (const n of inNamed.slice(0, 10)) {
      const name =
        workspaceRoot && n.vertex.filepath && n.vertex.start_line
          ? fileLink(n.vertex.name, n.vertex.filepath, n.vertex.start_line, workspaceRoot)
          : `\`${n.vertex.name}\``;
      const loc =
        !workspaceRoot && n.vertex.filepath && n.vertex.start_line
          ? ` — \`${n.vertex.filepath}:${n.vertex.start_line}\``
          : "";
      lines.push(`- ${name} (${n.edge.type})${loc}`);
    }
  }

  return lines.join("\n");
}

export function renderLensTitle(entry: FileVertexEntry): string {
  const v = entry.vertex;
  const refs = v.cross_concept_refs?.length ?? 0;
  const status = v.purpose ? "" : " · ⚠ unenriched";
  const outCount = entry.edges_out.filter((n) => n.vertex.name).length;
  const inCount = entry.edges_in.filter((n) => n.vertex.name).length;
  return `↓ ${outCount} · ↑ ${inCount} · ⇄ ${refs}${status}`;
}
