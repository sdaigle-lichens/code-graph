import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolveDbPath } from "../scribe/db.js";
import { bootstrapStore, SCHEMA_VERSION } from "../scribe/bootstrap.js";
import { tryLoadConfig, type ScribeConfig } from "../config.js";

/**
 * Exit 3 now means "this store was written by a newer code-graph", the one
 * store-level failure a user can act on. It used to mean "database not found",
 * which can no longer happen: the store is a file next to the config and is
 * created on demand.
 */
export function checkSchemaVersion(store: DatabaseSync, dbPath: string): void {
  const row = store.prepare("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version > SCHEMA_VERSION) {
    console.error(
      `store "${dbPath}" was written by a newer code-graph (schema ${row.user_version} > ${SCHEMA_VERSION}); upgrade the CLI`
    );
    process.exit(3);
  }
}

export function loadConfigOrExit(): ScribeConfig {
  const config = tryLoadConfig(process.cwd());
  if (!config) {
    console.error(`no scribe.config.json found above ${process.cwd()}`);
    process.exit(5);
  }
  return config;
}

export function storeExists(config: ScribeConfig): boolean {
  return existsSync(resolveDbPath(config));
}

export async function preflight(): Promise<{ config: ScribeConfig; db: DatabaseSync }> {
  const config = loadConfigOrExit();
  const dbPath = resolveDbPath(config);
  const db = bootstrapStore(dbPath);
  checkSchemaVersion(db, dbPath);
  return { config, db };
}
