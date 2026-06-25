import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { aql } from "arangojs/aql";
import { loadConfig } from "../config.js";
import { getDb } from "./db.js";

// ─── Pure functions (unit-testable, no DB/FS deps) ────────────────────────────

export type DanglingRef = {
  fromConcept: string;
  kind: "cross_concept_ref" | "agent_edge";
  description: string;
};

/** Remove a concept key from a scribe.config.json object (pure mutation). */
export function removeConceptFromConfig(
  config: Record<string, unknown>,
  conceptName: string,
): Record<string, unknown> {
  const concepts = config.concepts as Record<string, unknown> | undefined;
  if (!concepts || !(conceptName in concepts)) return config;
  const updated = { ...concepts };
  delete updated[conceptName];
  return { ...config, concepts: updated };
}

type VertexSummary = {
  _key: string;
  concept: string;
  name?: string;
  cross_concept_refs?: string[];
};

type EdgeSummary = {
  _from: string;
  _to: string;
  concept: string;
  type?: string;
  agent?: { authored_by?: string | null };
};

/**
 * Detect dangling refs that OTHER concepts have into the deleted concept.
 * Returns descriptions of:
 *   - live vertices in other concepts whose cross_concept_refs include deletedConcept
 *   - agent-authored edges in other concepts that point to/from the deleted concept's vertices
 */
export function computeDanglingRefs(
  deletedConcept: string,
  deletedVertexKeys: Set<string>,
  otherVertices: VertexSummary[],
  otherEdges: EdgeSummary[],
): DanglingRef[] {
  const refs: DanglingRef[] = [];

  // Cross-concept ref strings in vertices of other concepts
  const byFromConcept = new Map<string, string[]>();
  for (const v of otherVertices) {
    if (!v.cross_concept_refs?.includes(deletedConcept)) continue;
    const list = byFromConcept.get(v.concept) ?? [];
    list.push(v.name ?? v._key);
    byFromConcept.set(v.concept, list);
  }
  for (const [fromConcept, names] of byFromConcept) {
    refs.push({
      fromConcept,
      kind: "cross_concept_ref",
      description: `${names.length} cross_concept_ref(s) in \`${fromConcept}\` → deleted \`${deletedConcept}\`: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` …+${names.length - 3}` : ""}`,
    });
  }

  // Agent-authored edges that cross into the deleted concept's vertices
  const edgesByFromConcept = new Map<string, number>();
  for (const e of otherEdges) {
    if (!e.agent?.authored_by) continue;
    const toKey = e._to.split("/")[1];
    const fromKey = e._from.split("/")[1];
    if (!toKey || !fromKey) continue;
    const crossesIn = deletedVertexKeys.has(toKey) || deletedVertexKeys.has(fromKey);
    if (!crossesIn) continue;
    const cnt = (edgesByFromConcept.get(e.concept) ?? 0) + 1;
    edgesByFromConcept.set(e.concept, cnt);
  }
  for (const [fromConcept, count] of edgesByFromConcept) {
    refs.push({
      fromConcept,
      kind: "agent_edge",
      description: `${count} agent edge(s) from \`${fromConcept}\` now point into deleted \`${deletedConcept}\``,
    });
  }

  return refs;
}

/** Format the dangling-ref report as a markdown block. */
export function formatDanglingRefReport(refs: DanglingRef[]): string {
  if (refs.length === 0) return "";
  const lines = [
    "## Dangling references (stale after deletion)",
    "",
    "The following refs in other concepts now point into archived vertices.",
    "Run `/scribe-enrich` on the affected concept(s) to update them.",
    "",
  ];
  for (const r of refs) {
    lines.push(`- ${r.description}`);
  }
  return lines.join("\n");
}

// ─── Interactive confirm ──────────────────────────────────────────────────────

async function confirmDelete(conceptName: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `Archive concept "${conceptName}" and remove from config? This cannot be undone without re-running extract+apply. [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === "y");
      },
    );
  });
}

// ─── Main delete-concept implementation ───────────────────────────────────────

export async function deleteConcept(
  conceptName: string,
  opts: { yes?: boolean },
): Promise<void> {
  const config = loadConfig();
  const { configRoot } = config;

  if (!config.concepts?.[conceptName]) {
    console.error(`error: concept "${conceptName}" not found in scribe.config.json`);
    console.error(`  available: ${Object.keys(config.concepts ?? {}).join(", ") || "(none)"}`);
    process.exit(1);
  }

  if (!opts.yes) {
    const confirmed = await confirmDelete(conceptName);
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const now = new Date().toISOString();

  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
    // Quick connectivity check
    await db.version();
  } catch {
    console.error("error: ArangoDB is not reachable — run: code-graph up");
    process.exit(2);
  }

  // ── 1. Collect deleted concept's vertex keys (for dangling ref detection) ──
  const vertexCursor = await db.query<VertexSummary>(aql`
    FOR v IN vertices
      FILTER v.concept == ${conceptName}
      RETURN { _key: v._key, concept: v.concept, name: v.name, cross_concept_refs: v.cross_concept_refs }
  `);
  const deletedVertices = await vertexCursor.all();
  const deletedVertexKeys = new Set(deletedVertices.map((v) => v._key));

  // ── 2. Compute dangling refs BEFORE archiving ──────────────────────────────
  const otherVertexCursor = await db.query<VertexSummary>(aql`
    FOR v IN vertices
      FILTER v.concept != ${conceptName} AND v.status == "live"
        AND v.cross_concept_refs != null AND LENGTH(v.cross_concept_refs) > 0
      RETURN { _key: v._key, concept: v.concept, name: v.name, cross_concept_refs: v.cross_concept_refs }
  `);
  const otherVertices = await otherVertexCursor.all();

  const otherEdgeCursor = await db.query<EdgeSummary>(aql`
    FOR e IN edges
      FILTER e.concept != ${conceptName} AND e.agent != null AND e.agent.authored_by != null
      RETURN { _from: e._from, _to: e._to, concept: e.concept, type: e.type, agent: e.agent }
  `);
  const otherEdges = await otherEdgeCursor.all();

  const danglingRefs = computeDanglingRefs(
    conceptName,
    deletedVertexKeys,
    otherVertices,
    otherEdges,
  );

  // ── 3. Archive all vertices for the concept ────────────────────────────────
  // Count via the modification's RETURN (only newly-archived vertices) — a trailing
  // RETURN is the one operation AQL permits after UPDATE; COLLECT after UPDATE is not.
  const archiveVertexCursor = await db.query<number>(aql`
    FOR v IN vertices
      FILTER v.concept == ${conceptName} AND v.status == "live"
      UPDATE v WITH { status: "archived", archivedAt: ${now} } IN vertices
      RETURN 1
  `);
  const archivedVertices = (await archiveVertexCursor.all()).length;

  // ── 4. Archive all edges for the concept ──────────────────────────────────
  await db.query(aql`
    FOR e IN edges
      FILTER e.concept == ${conceptName}
      UPDATE e WITH { status: "archived", archivedAt: ${now} } IN edges
  `);
  const edgeCountCursor = await db.query<number>(aql`
    FOR e IN edges
      FILTER e.concept == ${conceptName} AND e.status == "archived"
      COLLECT WITH COUNT INTO c
      RETURN c
  `);
  const archivedEdges = (await edgeCountCursor.all())[0] ?? 0;

  // ── 5. Archive the docs/<concept>::skill vertex ────────────────────────────
  const docKey = `${conceptName}::skill`;
  await db.query(aql`
    FOR d IN docs
      FILTER d._key == ${docKey}
      UPDATE d WITH { status: "archived", archivedAt: ${now} } IN docs
  `);

  // ── 6. Remove concept from scribe.config.json ─────────────────────────────
  const configPath = join(configRoot, "scribe.config.json");
  const rawConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const updatedConfig = removeConceptFromConfig(rawConfig, conceptName);
  writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2) + "\n", "utf-8");

  // ── 7. Remove scribe-output artifacts ─────────────────────────────────────
  const removedArtifacts: string[] = [];
  for (const suffix of ["ast.json", "enriched.json"]) {
    const p = join(configRoot, "scribe-output", `${conceptName}.${suffix}`);
    if (existsSync(p)) {
      rmSync(p);
      removedArtifacts.push(`scribe-output/${conceptName}.${suffix}`);
    }
  }

  // ── 8. Print summary ──────────────────────────────────────────────────────
  console.log(`Archived concept: ${conceptName}`);
  console.log(`  vertices: ${archivedVertices} archived`);
  console.log(`  edges:    ${archivedEdges} archived`);
  console.log(`  config:   removed from scribe.config.json`);
  if (removedArtifacts.length > 0) {
    console.log(`  removed:  ${removedArtifacts.join(", ")}`);
  }

  if (danglingRefs.length > 0) {
    console.log();
    console.log(formatDanglingRefReport(danglingRefs));
  } else {
    console.log("  dangling refs: none");
  }
}
