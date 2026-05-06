import type { Database } from "arangojs";
import { getSystemDb, getProjectDb } from "../scribe/db.js";
import { tryLoadConfig, type ScribeConfig } from "../config.js";

export async function checkServerReachable(): Promise<void> {
  const url = process.env.ARANGO_URL ?? "http://localhost:8529";
  try {
    await getSystemDb().version();
  } catch {
    console.error(
      `ArangoDB not reachable at ${url}; try \`code-graph up\``
    );
    process.exit(2);
  }
}

export async function checkDbExists(dbName: string): Promise<void> {
  const databases = await getSystemDb().listDatabases();
  if (!databases.includes(dbName)) {
    console.error(
      `DB "${dbName}" not found; try \`code-graph bootstrap\``
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

export async function preflight(): Promise<{ config: ScribeConfig; db: Database }> {
  const config = loadConfigOrExit();
  await checkServerReachable();
  const dbName = process.env.ARANGO_DB ?? config.project;
  await checkDbExists(dbName);
  const db = getProjectDb(dbName);
  return { config, db };
}
