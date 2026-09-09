import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { loadConfig } from "../config.js";
import { resolveDbPath } from "./db.js";
import { bootstrapStore, rebuildSearchIndex } from "./bootstrap.js";
import type { DatabaseSync } from "node:sqlite";
import { docKey, inTransaction, toDocs } from "./rows.js";

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

/**
 * Archives every vertex, edge and skill doc belonging to a concept.
 *
 * Nothing is hard-deleted — `status: "archived"` is the tombstone, so a concept
 * can be re-applied later and drift detection still sees its history.
 */
export function archiveConcept(
  store: DatabaseSync,
  conceptName: string,
  now: string
): { archivedVertices: number; archivedEdges: number } {
  return inTransaction(store, () => {
    const stamp = (table: string, where: string, ...params: unknown[]) =>
      store
        .prepare(
          `UPDATE ${table}
              SET doc = json_set(doc, '$.status', 'archived', '$.archivedAt', ?)
            WHERE ${where}`
        )
        .run(now, ...(params as never[])).changes;

    // Only live vertices are counted, so a repeated delete reports zero.
    const archivedVertices = Number(
      stamp("vertices", "concept = ? AND status = 'live'", conceptName)
    );

    // Edges are re-stamped regardless of current status, matching the previous
    // behaviour, so the count below is every edge of the concept.
    stamp("edges", "concept = ?", conceptName);
    const archivedEdges = Number(
      (
        store
          .prepare(
            `SELECT count(*) AS c FROM edges
              WHERE concept = ? AND json_extract(doc, '$.status') = 'archived'`
          )
          .get(conceptName) as { c: number }
      ).c
    );

    stamp("docs", "key = ?", docKey(conceptName));

    rebuildSearchIndex(store);
    return { archivedVertices, archivedEdges };
  });
}

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

  // Creates the store if this is a fresh project, in which case there is simply
  // nothing to archive.
  const store = bootstrapStore(resolveDbPath(config));

  // ── 1. Collect deleted concept's vertex keys (for dangling ref detection) ──
  const deletedVertices = toDocs<VertexSummary>(
    store.prepare("SELECT doc FROM vertices WHERE concept = ?").all(conceptName) as {
      doc: string;
    }[]
  ).map((v) => ({
    _key: v._key,
    concept: v.concept,
    name: v.name,
    cross_concept_refs: v.cross_concept_refs,
  }));
  const deletedVertexKeys = new Set(deletedVertices.map((v) => v._key));

  // ── 2. Compute dangling refs BEFORE archiving ──────────────────────────────
  const otherVertices = toDocs<VertexSummary>(
    store
      .prepare(
        `SELECT doc FROM vertices
          WHERE concept != ? AND status = 'live'
            AND json_array_length(coalesce(json_extract(doc, '$.cross_concept_refs'), '[]')) > 0`
      )
      .all(conceptName) as { doc: string }[]
  ).map((v) => ({
    _key: v._key,
    concept: v.concept,
    name: v.name,
    cross_concept_refs: v.cross_concept_refs,
  }));

  const otherEdges = toDocs<EdgeSummary>(
    store
      .prepare("SELECT doc FROM edges WHERE concept != ? AND authored_by IS NOT NULL")
      .all(conceptName) as { doc: string }[]
  ).map((e) => ({
    _from: e._from,
    _to: e._to,
    concept: e.concept,
    type: e.type,
    agent: e.agent,
  }));

  const danglingRefs = computeDanglingRefs(
    conceptName,
    deletedVertexKeys,
    otherVertices,
    otherEdges,
  );

  const { archivedVertices, archivedEdges } = archiveConcept(store, conceptName, now);

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
