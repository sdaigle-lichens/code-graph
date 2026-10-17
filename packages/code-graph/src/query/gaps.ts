import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { minimatch } from "minimatch";
import type { ScribeConfig } from "../config.js";
import { isDocsOnly } from "../scribe/ast-output.js";
import { coreVertices, isThinCore, thinCoreMessage } from "../scribe/core.js";
import type { SearchResult } from "./search.js";

// ─── Tunable thresholds (deferred per phase-9; defaults are conservative) ──────

export type GapThresholds = {
  /** A concept counts as "enriched" when this fraction of its core vertices (all live vertices when
   *  the core is empty) have a non-empty `purpose` that is not stale. Tolerates a few un-enriched stragglers after re-extract. */
  enrichedRatio: number;
  /** Results are "thin" when fewer than this many vertices are returned (incl. expansion).
   *  Conservative on purpose: we'd rather suppress the note than provoke a grep-storm. */
  minVertexHits: number;
};

export const DEFAULT_THRESHOLDS: GapThresholds = {
  enrichedRatio: 0.9,
  minVertexHits: 3,
};

// ─── Pure analysis ────────────────────────────────────────────────────────────

export type ConceptStatus = "enriched" | "partial" | "un-enriched" | "un-applied";

export type ConceptGap = {
  concept: string;
  status: ConceptStatus;
  /** Whether the `scribe` skill can enrich it — a SKILL.md is resolvable. */
  enrichable: boolean;
  liveVertices: number;
  enrichedVertices: number;
  /** Core vertices (named in SKILL.md + in-concept hubs); 0 when unknown or the core is empty. */
  coreVertices: number;
  coreEnrichedVertices: number;
  /** 50+ live vertices but fewer than 5 core: the SKILL.md names too little. */
  thinCore: boolean;
  /** Enriched / measured, over the core when it is non-empty, else over all live vertices; 0 when none. */
  ratio: number;
};

export type GapReport = {
  concepts: ConceptGap[];
  /** Concepts with a real gap (not fully enriched) that *can* be auto-fixed. */
  fixable: ConceptGap[];
  /** Concepts whose core is thin: route to update-single-concept-skill. */
  thinCores: ConceptGap[];
  /** Concepts with a gap but no resolvable SKILL.md — surface, never offer the pipeline. */
  unenrichable: ConceptGap[];
  /** For the success-note ratio: "enriched / enrichable". */
  enrichedCount: number;
  enrichableTotal: number;
};

export type DeclaredConcept = { name: string; enrichable: boolean };
export type ConceptCount = { live: number; enriched: number; core?: number; coreEnriched?: number };
export type ConceptCounts = Map<string, ConceptCount>;

/** DB-free core. Classify each declared concept and bucket the actionable gaps. */
export function analyzeConceptGaps(
  declared: DeclaredConcept[],
  counts: ConceptCounts,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS
): GapReport {
  const concepts: ConceptGap[] = declared.map(({ name, enrichable }) => {
    const c = counts.get(name) ?? { live: 0, enriched: 0 };
    const core = c.core ?? 0;
    const useCore = core > 0;
    const measured = useCore ? core : c.live;
    const done = useCore ? (c.coreEnriched ?? 0) : c.enriched;
    const ratio = measured === 0 ? 0 : done / measured;
    let status: ConceptStatus;
    if (c.live === 0) status = "un-applied";
    else if (ratio === 0) status = "un-enriched";
    else if (ratio >= thresholds.enrichedRatio) status = "enriched";
    else status = "partial";
    return {
      concept: name,
      status,
      enrichable,
      liveVertices: c.live,
      enrichedVertices: c.enriched,
      coreVertices: core,
      coreEnrichedVertices: c.coreEnriched ?? 0,
      thinCore: c.core !== undefined && isThinCore(c.live, core),
      ratio,
    };
  });

  const withGap = concepts.filter((c) => c.status !== "enriched");
  const fixable = withGap.filter((c) => c.enrichable);
  const unenrichable = withGap.filter((c) => !c.enrichable);

  const enrichable = concepts.filter((c) => c.enrichable);
  const enrichedCount = enrichable.filter((c) => c.status === "enriched").length;

  return {
    concepts,
    fixable,
    thinCores: concepts.filter((c) => c.thinCore),
    unenrichable,
    enrichedCount,
    enrichableTotal: enrichable.length,
  };
}

export type ResultStrength = "strong" | "thin";

/** Conservative thinness check — only the genuinely sparse case is "thin". */
export function classifyStrength(result: SearchResult, thresholds: GapThresholds = DEFAULT_THRESHOLDS): ResultStrength {
  const vertexHits = result.hits.filter((h) => h.vertex !== null).length;
  return vertexHits < thresholds.minVertexHits ? "thin" : "strong";
}

// ─── Formatters ─────────────────────────────────────────────────────────────

/** The terse one-line FYI for the success path. Returns null when there's nothing
 *  worth saying (graph fully enriched, or no enrichable concepts). Caller gates on
 *  thin results before showing it. */
export function buildSuccessNote(report: GapReport): string | null {
  if (report.enrichableTotal === 0) return null;
  if (report.fixable.length === 0) return null;
  return `> ⚠ graph ${report.enrichedCount}/${report.enrichableTotal} concepts enriched — results may be partial`;
}

const PIPELINE = (c: string) =>
  `\`code-graph extract ${c}\` → ask the \`scribe\` skill to enrich ${c} → \`code-graph apply ${c}\``;

/** The full whiff diagnostic block (markdown), printed to stdout before exit 6.
 *  `uncovered` is the set of source files matched by no concept's globs; the skill
 *  greps these for the query and surfaces (c) evidence. */
export function formatGapDiagnostic(
  report: GapReport,
  uncovered: string[],
  opts: { uncoveredCap?: number } = {}
): string {
  const cap = opts.uncoveredCap ?? 25;
  const lines: string[] = ["## Graph completeness", ""];

  if (report.fixable.length > 0) {
    lines.push("**Declared concepts not fully built — these may hold what you searched for:**");
    lines.push("");
    for (const c of report.fixable) {
      const detail =
        c.status === "un-applied"
          ? "not built (0 vertices)"
          : c.status === "un-enriched"
            ? `not enriched (${c.liveVertices} vertices, 0 with purpose)`
            : c.coreVertices > 0
              ? `partially enriched (${c.coreEnrichedVertices}/${c.coreVertices} core vertices)`
              : `partially enriched (${c.enrichedVertices}/${c.liveVertices} vertices)`;
      lines.push(`- \`${c.concept}\` — ${detail}. Build: ${PIPELINE(c.concept)}`);
    }
    lines.push("");
  }

  if (report.thinCores.length > 0) {
    lines.push("**Concepts with a thin core (update-single-concept-skill to deepen the SKILL.md):**");
    lines.push("");
    for (const c of report.thinCores)
      lines.push(`- \`${c.concept}\` — ${thinCoreMessage(c.coreVertices, c.liveVertices)}`);
    lines.push("");
  }

  if (report.unenrichable.length > 0) {
    lines.push("**Concepts with no SKILL.md (enrichment unavailable):**");
    lines.push("");
    for (const c of report.unenrichable) {
      lines.push(`- \`${c.concept}\` — add \`concepts.${c.concept}.skill\` or set \`skillsDir\` in scribe.config.json`);
    }
    lines.push("");
  }

  if (uncovered.length > 0) {
    lines.push("**Source files covered by no concept (the graph is blind here):**");
    lines.push("");
    for (const f of uncovered.slice(0, cap)) lines.push(`- ${f}`);
    if (uncovered.length > cap) lines.push(`- …and ${uncovered.length - cap} more`);
    lines.push("");
    lines.push("Grep these for your query; if they match, consider declaring a concept for them.");
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ─── DB + filesystem gathering ────────────────────────────────────────────────

/** Live vertex count + count with a non-empty, non-stale `purpose`, grouped by concept. With
 *  `opts.core`, also the same two numbers over each concept's core (SKILL.md body from the docs row,
 *  in-concept calls/mounts edges); needs the `edges` and `docs` tables. */
export async function fetchConceptCounts(store: DatabaseSync, opts: { core?: boolean } = {}): Promise<ConceptCounts> {
  const rows = store
    .prepare(
      `SELECT concept,
              count(*) AS live,
              sum(CASE WHEN purpose IS NOT NULL AND purpose != ''
                       AND coalesce(json_extract(doc, '$.agent.stale'), 0) != 1 THEN 1 ELSE 0 END) AS enriched
         FROM vertices
        WHERE status = 'live'
        GROUP BY concept`
    )
    .all() as Array<{ concept: string; live: number; enriched: number }>;
  const map: ConceptCounts = new Map();
  for (const r of rows) map.set(r.concept, { live: r.live, enriched: r.enriched });
  if (opts.core) addCoreCounts(store, map);
  return map;
}

function addCoreCounts(store: DatabaseSync, map: ConceptCounts): void {
  const vrows = store
    .prepare(
      `SELECT key, concept, name,
              (purpose IS NOT NULL AND purpose != '' AND coalesce(json_extract(doc, '$.agent.stale'), 0) != 1) AS enriched
         FROM vertices WHERE status = 'live'`
    )
    .all() as Array<{ key: string; concept: string; name: string; enriched: number }>;
  const erows = store
    .prepare(`SELECT concept, from_id AS _from, to_id AS _to, type FROM edges WHERE type IN ('calls', 'mounts')`)
    .all() as Array<{ concept: string; _from: string; _to: string; type: string }>;
  const drows = store.prepare(`SELECT concept, json_extract(doc, '$.body_md') AS body FROM docs`).all() as Array<{
    concept: string;
    body: string | null;
  }>;
  const bodies = new Map(drows.map((d) => [d.concept, d.body]));
  for (const [concept, count] of map) {
    const vs = vrows.filter((v) => v.concept === concept);
    const es = erows.filter((e) => e.concept === concept);
    const core = coreVertices(
      vs.map((v) => ({ _key: v.key, name: v.name })),
      es,
      bodies.get(concept) ?? null
    );
    count.core = core.keys.size;
    count.coreEnriched = vs.filter((v) => core.keys.has(v.key) && v.enriched).length;
  }
}

/** Mirror of the `scribe` skill's enrichment resolution: a concept is enrichable when a
 *  SKILL.md actually exists via `concepts.<name>.skill` or `<skillsDir>/<name>/SKILL.md`. */
export function conceptEnrichable(config: ScribeConfig, name: string): boolean {
  const c = config.concepts[name];
  if (c?.skill) return existsSync(join(config.configRoot, c.skill));
  if (config.skillsDir) return existsSync(join(config.configRoot, config.skillsDir, name, "SKILL.md"));
  return false;
}

/** Declared concepts that have code to build and enrich. Docs-only concepts (no tsconfig, or only
 *  non-code globs) hold a skill doc and zero vertices by design, so they are never a "gap". */
export function declaredConcepts(config: ScribeConfig): DeclaredConcept[] {
  return Object.keys(config.concepts)
    .filter((name) => !isDocsOnly(config, name))
    .map((name) => ({
      name,
      enrichable: conceptEnrichable(config, name),
    }));
}

/** Orchestrator: declared concepts + DB counts → GapReport. */
export async function computeGapReport(
  db: DatabaseSync,
  config: ScribeConfig,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS
): Promise<GapReport> {
  const counts = await fetchConceptCounts(db, { core: true });
  return analyzeConceptGaps(declaredConcepts(config), counts, thresholds);
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "scribe-output", ".next", "build", "coverage"]);

/** Lightweight walk of the project for source files matched by no concept's glob.
 *  Only called on a whiff, so the cost is bounded to the rare zero-result case. */
export function uncoveredSourceFiles(config: ScribeConfig): string[] {
  const globs = Object.values(config.concepts).flatMap((c) => c.globs);
  const out: string[] = [];

  const walk = (dir: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile() && SOURCE_EXT.test(e.name)) {
        const rel = relative(config.configRoot, abs).replace(/\\/g, "/");
        const covered = globs.some((g) => minimatch(rel, g, { dot: true }) || minimatch(abs, g, { dot: true }));
        if (!covered) out.push(rel);
      }
    }
  };

  walk(config.configRoot);
  out.sort();
  return out;
}
