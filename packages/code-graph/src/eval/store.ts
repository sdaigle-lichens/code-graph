import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildSearchIndex } from "../scribe/bootstrap.js";

/**
 * Which store the Layer-A gate measures.
 *
 * `stripped` (default): a temp copy of the store with every enrichment field (`purpose`, `tags`)
 * removed and the search index rebuilt, so the verdict does not depend on which concepts a
 * developer's gitignored `*.enriched.json` files happen to cover. `as-is`: the store untouched;
 * informational, since its verdict moves with local enrichment.
 */
export type EvalStoreMode = "stripped" | "as-is";

export type EvalStore = {
  db: DatabaseSync;
  mode: EvalStoreMode;
  /** Vertices with a non-empty purpose in the real store (before any stripping). */
  enriched: number;
  vertices: number;
  /** One line naming the kind of store measured, printed next to the `build:` line. */
  label: string;
  close: () => void;
};

export function isEvalStoreMode(v: string): v is EvalStoreMode {
  return v === "stripped" || v === "as-is";
}

function countVertices(db: DatabaseSync): { enriched: number; vertices: number } {
  const row = db
    .prepare(
      `SELECT count(*) AS vertices,
              coalesce(sum(CASE WHEN coalesce(json_extract(doc, '$.purpose'), '') <> '' THEN 1 ELSE 0 END), 0) AS enriched
         FROM vertices`
    )
    .get() as { vertices: number; enriched: number };
  return { enriched: Number(row.enriched), vertices: Number(row.vertices) };
}

export function describeEvalStore(mode: EvalStoreMode, enriched: number, vertices: number): string {
  const counts = `${enriched} of ${vertices} vertices carry a purpose in the real store`;
  if (mode === "stripped") {
    return `store: un-enriched (stripped copy, purposes and tags removed, index rebuilt; ${counts})`;
  }
  const kind = enriched > 0 ? "enriched" : "un-enriched";
  return `store: ${kind} (as-is, not stripped; ${counts}; verdict depends on local enrichment)`;
}

/** Opens the store the gate measures. `source` stays open and untouched; the caller owns it. */
export function openEvalStore(source: DatabaseSync, mode: EvalStoreMode): EvalStore {
  const { enriched, vertices } = countVertices(source);
  const label = describeEvalStore(mode, enriched, vertices);
  if (mode === "as-is") {
    return { db: source, mode, enriched, vertices, label, close: () => {} };
  }
  const dir = mkdtempSync(join(tmpdir(), "code-graph-eval-"));
  const copyPath = join(dir, "graph.db");
  let db: DatabaseSync | undefined;
  try {
    // VACUUM INTO writes a consistent snapshot, including anything still in the WAL.
    source.exec(`VACUUM INTO '${copyPath.replace(/'/g, "''")}'`);
    db = new DatabaseSync(copyPath);
    db.exec("UPDATE vertices SET doc = json_remove(doc, '$.purpose', '$.tags')");
    rebuildSearchIndex(db);
  } catch (err) {
    try {
      db?.close();
    } catch {
      // already unusable; the dir removal below is what matters
    }
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const copy = db;
  return {
    db: copy,
    mode,
    enriched,
    vertices,
    label,
    close: () => {
      copy.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
