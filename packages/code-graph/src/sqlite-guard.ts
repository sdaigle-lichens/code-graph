// The one place that turns "this Node has no node:sqlite" into a diagnosis. Layer 1 (`skills *`) never
// loads the store, so it keeps working; every command that opens the store goes through
// `ensureSqlite` (a commander preAction hook in cli.ts) before its lazy imports run.

import { isBuiltin } from "node:module";

/** The store cannot open: `node:sqlite` is missing from this Node (older than 22.5, or started with `--no-experimental-sqlite`). */
export const EXIT_NO_SQLITE = 8;

/** Keep in step with `engines.node` in packages/code-graph/package.json. */
export const REQUIRED_NODE = ">=22.5";

/** Top-level commands that open the store. `extract` and `catalog` do not, so they stay usable without it. */
export const STORE_COMMANDS: ReadonlySet<string> = new Set([
  "status",
  "bootstrap",
  "reindex",
  "apply",
  "enrich",
  "drift",
  "search",
  "eval",
  "query",
  "delete-concept",
]);

export function noSqliteMessage(nodeVersion: string = process.version): string {
  return (
    `code-graph: node:sqlite is not available in this Node (${nodeVersion}). ` +
    `code-graph needs Node ${REQUIRED_NODE} with node:sqlite enabled (no --no-experimental-sqlite); check with \`node --version\`.`
  );
}

/**
 * Returns when `node:sqlite` exists in this Node; otherwise prints the one-line fix and exits
 * `EXIT_NO_SQLITE`. `isBuiltin` checks availability without loading the module, so a command that
 * never opens the store (the no-concepts skip) still loads nothing.
 */
export function ensureSqlite(): void {
  if (isBuiltin("node:sqlite")) return;
  console.error(noSqliteMessage());
  process.exit(EXIT_NO_SQLITE);
}
