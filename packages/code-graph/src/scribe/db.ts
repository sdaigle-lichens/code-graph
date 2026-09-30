import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig, type ScribeConfig } from "../config.js";

/**
 * The graph lives beside the other per-project artifacts that `extract` and
 * `apply` already write, so a project's graph travels with its checkout and
 * needs no server-side database naming.
 */
export function resolveDbPath(config?: ScribeConfig): string {
  const cfg = config ?? loadConfig();
  if (cfg.dbPath) return resolve(cfg.configRoot, cfg.dbPath);
  return join(cfg.configRoot, "scribe-output", "graph.db");
}

const _stores = new Map<string, DatabaseSync>();

/**
 * Opens (and caches) the store at `dbPath`. Creating the file is the caller's
 * business — `bootstrap()` owns the schema — but the pragmas belong with the
 * connection, since they are per-connection state rather than stored schema.
 */
export function getStore(dbPath: string): DatabaseSync {
  let store = _stores.get(dbPath);
  if (!store) {
    mkdirSync(dirname(dbPath), { recursive: true });
    store = new DatabaseSync(dbPath);
    // WAL lets the LSP read while `apply` writes; without busy_timeout that
    // concurrency surfaces as SQLITE_BUSY rather than a short wait.
    store.exec("PRAGMA journal_mode = WAL");
    store.exec("PRAGMA busy_timeout = 5000");
    store.exec("PRAGMA foreign_keys = ON");
    _stores.set(dbPath, store);
  }
  return store;
}

export function closeStores(): void {
  for (const store of _stores.values()) store.close();
  _stores.clear();
}
