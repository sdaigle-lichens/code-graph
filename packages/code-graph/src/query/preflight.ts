import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolveDbPath } from "../scribe/db.js";
import { openStoreOrExit } from "../scribe/bootstrap.js";
import { tryLoadConfig, type ScribeConfig } from "../config.js";

// Exit 3 means "this store was written by a newer code-graph" (`openStoreOrExit`, which reads the
// stored version before anything writes it).

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
  const db = openStoreOrExit(dbPath);
  return { config, db };
}
