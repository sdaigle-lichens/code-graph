import { existsSync, readdirSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import type { Database } from "arangojs";
import { aql } from "arangojs/aql";
import { minimatch } from "minimatch";
import type { ScribeConfig } from "../config.js";
import type { SearchResult } from "./search.js";

// ─── Tunable thresholds (deferred per phase-9; defaults are conservative) ──────

export type GapThresholds = {
  /** A concept counts as "enriched" when this fraction of its live vertices have
   *  a non-empty `purpose`. Tolerates a few un-enriched stragglers after re-extract. */
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

export type ConceptStatus =
  | "enriched"
  | "partial"
  | "un-enriched"
  | "un-applied";

export type ConceptGap = {
  concept: string;
  status: ConceptStatus;
  /** Whether `/scribe-enrich` can run — a SKILL.md is resolvable. */
  enrichable: boolean;
  liveVertices: number;
  enrichedVertices: number;
  /** enrichedVertices / liveVertices, or 0 when there are no live vertices. */
  ratio: number;
};

export type GapReport = {
  concepts: ConceptGap[];
  /** Concepts with a real gap (not fully enriched) that *can* be auto-fixed. */
  fixable: ConceptGap[];
  /** Concepts with a gap but no resolvable SKILL.md — surface, never offer the pipeline. */
  unenrichable: ConceptGap[];
  /** For the success-note ratio: "enriched / enrichable". */
  enrichedCount: number;
  enrichableTotal: number;
};

export type DeclaredConcept = { name: string; enrichable: boolean };
export type ConceptCounts = Map<string, { live: number; enriched: number }>;

/** DB-free core. Classify each declared concept and bucket the actionable gaps. */
export function analyzeConceptGaps(
  declared: DeclaredConcept[],
  counts: ConceptCounts,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS,
): GapReport {
  const concepts: ConceptGap[] = declared.map(({ name, enrichable }) => {
    const c = counts.get(name) ?? { live: 0, enriched: 0 };
    const ratio = c.live === 0 ? 0 : c.enriched / c.live;
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
    unenrichable,
    enrichedCount,
    enrichableTotal: enrichable.length,
  };
}

export type ResultStrength = "strong" | "thin";

/** Conservative thinness check — only the genuinely sparse case is "thin". */
export function classifyStrength(
  result: SearchResult,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS,
): ResultStrength {
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
  `\`code-graph extract ${c}\` → \`/scribe-enrich ${c}\` → \`code-graph apply ${c}\``;

/** The full whiff diagnostic block (markdown), printed to stdout before exit 6.
 *  `uncovered` is the set of source files matched by no concept's globs; the skill
 *  greps these for the query and surfaces (c) evidence. */
export function formatGapDiagnostic(
  report: GapReport,
  uncovered: string[],
  opts: { uncoveredCap?: number } = {},
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
            : `partially enriched (${c.enrichedVertices}/${c.liveVertices} vertices)`;
      lines.push(`- \`${c.concept}\` — ${detail}. Build: ${PIPELINE(c.concept)}`);
    }
    lines.push("");
  }

  if (report.unenrichable.length > 0) {
    lines.push("**Concepts with no SKILL.md (enrichment unavailable):**");
    lines.push("");
    for (const c of report.unenrichable) {
      lines.push(
        `- \`${c.concept}\` — add \`concepts.${c.concept}.skill\` or set \`skillsDir\` in scribe.config.json`,
      );
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

/** One aggregation: live vertex count + count of vertices with a non-empty purpose,
 *  grouped by concept. */
export async function fetchConceptCounts(db: Database): Promise<ConceptCounts> {
  const cursor = await db.query<{ concept: string; live: number; enriched: number }>(aql`
    FOR v IN vertices
      FILTER v.status == "live"
      COLLECT concept = v.concept AGGREGATE
        live = SUM(1),
        enriched = SUM((v.purpose != null AND v.purpose != "") ? 1 : 0)
      RETURN { concept, live, enriched }
  `);
  const rows = await cursor.all();
  const map: ConceptCounts = new Map();
  for (const r of rows) map.set(r.concept, { live: r.live, enriched: r.enriched });
  return map;
}

/** Mirror of /scribe-enrich's skill resolution: a concept is enrichable when a
 *  SKILL.md actually exists via `concepts.<name>.skill` or `<skillsDir>/<name>/SKILL.md`. */
export function conceptEnrichable(config: ScribeConfig, name: string): boolean {
  const c = config.concepts[name];
  if (c?.skill) return existsSync(join(config.configRoot, c.skill));
  if (config.skillsDir)
    return existsSync(join(config.configRoot, config.skillsDir, name, "SKILL.md"));
  return false;
}

export function declaredConcepts(config: ScribeConfig): DeclaredConcept[] {
  return Object.keys(config.concepts).map((name) => ({
    name,
    enrichable: conceptEnrichable(config, name),
  }));
}

/** Orchestrator: declared concepts + DB counts → GapReport. */
export async function computeGapReport(
  db: Database,
  config: ScribeConfig,
  thresholds: GapThresholds = DEFAULT_THRESHOLDS,
): Promise<GapReport> {
  const counts = await fetchConceptCounts(db);
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
        const covered = globs.some(
          (g) => minimatch(rel, g, { dot: true }) || minimatch(abs, g, { dot: true }),
        );
        if (!covered) out.push(rel);
      }
    }
  };

  walk(config.configRoot);
  out.sort();
  return out;
}
