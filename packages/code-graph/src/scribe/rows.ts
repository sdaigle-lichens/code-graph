/**
 * Row helpers for the SQLite store.
 *
 * Every table stores its payload as a JSON `doc` column, so the objects handed
 * back to callers are byte-identical to what the driver used to return. These
 * helpers cover the two places that needs care: unwrapping that column, and the
 * `"<collection>/<key>"` document-handle strings that appear inside `_from` /
 * `_to` and leak into plain JS in several call sites.
 */

export type DocRow = { doc: string };

export function toDoc<T>(row: DocRow | undefined): T | null {
  return row ? (JSON.parse(row.doc) as T) : null;
}

export function toDocs<T>(rows: DocRow[]): T[] {
  return rows.map((r) => JSON.parse(r.doc) as T);
}

/** `"abc123"` -> `"vertices/abc123"` */
export function vertexId(key: string): string {
  return `vertices/${key}`;
}

/** `"workorder-store"` -> `"workorder-store::skill"` (the docs `_key`) */
export function docKey(concept: string): string {
  return `${concept}::skill`;
}

/** `"workorder-store"` -> `"docs/workorder-store::skill"` */
export function docId(concept: string): string {
  return `docs/${docKey(concept)}`;
}

/**
 * `"vertices/abc123"` -> `"abc123"`. Splits on the first `/` only: doc keys
 * contain `::` and must survive intact.
 */
export function keyOf(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

/**
 * Stopwords stripped by ArangoDB's `text_en` analyzer. FTS5's `porter
 * unicode61` tokenizer does not strip anything, so without this the filler
 * words in a natural-language query ("why does X re-render") carry BM25 mass —
 * and they match long `body_md` far more often than short `name`, which floats
 * skill documents above the vertices the query was actually about.
 */
const STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "did",
  "do",
  "does",
  "for",
  "from",
  "get",
  "gets",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "so",
  "some",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** `parseGapsHandled` / `parse_gaps_handled` / `HTTPServer2` -> its words, lower-cased. */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * What the FTS `name` column holds: the identifier itself (so an exact or whole-token query still
 * hits) followed by its words, because `unicode61` does not split camelCase and a plain-language
 * query ("gaps handled") would otherwise never reach `parseGapsHandled`.
 */
export function nameIndexText(name: string): string {
  const words = splitIdentifier(name);
  return words.length > 1 ? `${name} ${words.join(" ")}` : name;
}

/**
 * Builds an FTS5 MATCH expression from a free-text query.
 *
 * Every token is quoted: an unquoted `AND` / `OR` / `NOT` / `NEAR` / `*` / `-`
 * / `:` in user input is an FTS5 syntax error, not a literal. Returns null when
 * nothing survives tokenization, which callers treat as "no results" (exit 6).
 */
export function toMatchExpr(query: string): string | null {
  const raw = (query.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // `unicode61` treats `_` as a separator, so a quoted SCREAMING_SNAKE token is a phrase that
  // only matches the same words in the same order. Also offer its words alone: they reach a
  // camelCase name whose indexed words (`nameIndexText`) are split the same way.
  const tokens = raw.flatMap((t) =>
    t.includes("_") ? [t, ...t.split("_").filter((p) => p.length > 1 && !STOPWORDS.has(p))] : [t]
  );
  if (tokens.length === 0) return null;
  const seen = new Set<string>();
  const unique = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  return unique.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}

// ─── Record writes ───────────────────────────────────────────────────────────

import type { DatabaseSync } from "node:sqlite";

export type StoreTable = "vertices" | "edges" | "docs" | "concepts";

export function getRecord<T>(store: DatabaseSync, table: StoreTable, key: string): T | null {
  const row = store.prepare(`SELECT doc FROM ${table} WHERE key = ?`).get(key) as DocRow | undefined;
  return toDoc<T>(row);
}

/** Replaces the whole record, creating it when absent. */
export function putRecord(store: DatabaseSync, table: StoreTable, key: string, doc: unknown): void {
  store
    .prepare(
      `INSERT INTO ${table}(key, doc) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET doc = excluded.doc`
    )
    .run(key, JSON.stringify(doc));
}

/**
 * Merges `patch` into an existing record, top level only.
 *
 * Read-modify-write rather than `json_patch`: RFC 7396 merge-patch treats a
 * null value as "delete this key", but `document_ref` is legitimately
 * `string | null` and must survive as an explicit null.
 *
 * A shallow merge is enough because every caller that touches a nested object
 * (`agent`, `ast`) builds the complete replacement object itself rather than
 * relying on the driver to merge it.
 */
export function mergeRecord(store: DatabaseSync, table: StoreTable, key: string, patch: Record<string, unknown>): void {
  const existing = getRecord<Record<string, unknown>>(store, table, key);
  putRecord(store, table, key, { ...(existing ?? {}), ...patch });
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export function inTransaction<T>(store: DatabaseSync, fn: () => T): T {
  store.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    store.exec("COMMIT");
    return result;
  } catch (err) {
    store.exec("ROLLBACK");
    throw err;
  }
}
