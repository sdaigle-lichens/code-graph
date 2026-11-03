// Graph freshness per concept, for `skills status --json`. Read-only against the store and the
// `scribe-output/` artifacts; it never extracts (that needs the TypeScript compiler).
//
// "changed" is the pending-apply drift: vertices whose `contentHash` in `<concept>.ast.json` (the
// last extract) differs from the stored one. Re-run `extract <concept>` first to fold in source
// edits. "stale" is the stored vertices flagged `agent.stale` (body changed after enrichment).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tryLoadConfig } from "../config.js";
import { getStore, resolveDbPath } from "./db.js";
import { toDocs } from "./rows.js";
import type { Vertex } from "../schema.js";

export interface GraphFreshness {
  /** `<concept>.ast.json` exists; `extractedAt` is its `meta.extracted_at`. */
  extracted: boolean;
  extractedAt: string | null;
  /** `<concept>.enriched.json` exists. */
  enriched: boolean;
  /** Live vertices in the store. */
  vertices: number;
  /** Live vertices with an agent-authored `purpose`. */
  enrichedVertices: number;
  /** Vertices the last extract changed relative to the store (apply pending). */
  changed: number;
  /** Live vertices flagged `agent.stale`. */
  stale: number;
}

function readJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Freshness for each named concept, or null when the project has no store (or it cannot be read).
 * A concept with no live vertices (docs-only) is omitted, so it keeps its git-diff window.
 */
export function graphFreshness(projectRoot: string, concepts: string[]): Record<string, GraphFreshness> | null {
  const config = tryLoadConfig(projectRoot);
  if (!config) return null;
  const dbPath = resolveDbPath(config);
  if (!existsSync(dbPath)) return null;

  try {
    const store = getStore(dbPath);
    const out: Record<string, GraphFreshness> = {};
    for (const concept of concepts) {
      const live = toDocs<Vertex>(
        store.prepare("SELECT doc FROM vertices WHERE concept = ? AND status = 'live'").all(concept) as {
          doc: string;
        }[]
      );
      if (live.length === 0) continue;
      const dir = join(config.configRoot, "scribe-output");
      const ast = readJson(join(dir, `${concept}.ast.json`));
      const stored = new Map(live.map((v) => [v._key, v.contentHash]));
      const changed = Array.isArray(ast?.vertices)
        ? (ast.vertices as Vertex[]).filter((v) => stored.has(v._key) && stored.get(v._key) !== v.contentHash).length
        : 0;
      out[concept] = {
        extracted: ast !== null,
        extractedAt: ast?.meta?.extracted_at ?? null,
        enriched: existsSync(join(dir, `${concept}.enriched.json`)),
        vertices: live.length,
        enrichedVertices: live.filter((v) => v.purpose).length,
        changed,
        stale: live.filter((v) => v.agent?.stale === true).length,
      };
    }
    return out;
  } catch {
    return null;
  }
}
