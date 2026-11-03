#!/usr/bin/env node
// Builds this repo's graph store before `just eval` / `just eval-as-is` measure it. A fresh git
// worktree has no scribe-output/graph.db (gitignored), and `code-graph eval` then creates an empty
// store and scores 0/7, which reads as a retrieval regression.
//
// Does nothing (a stat and a few counts) when every concept in scribe.config.json already has live
// vertices or a docs row in the store. Otherwise it runs `extract` + `apply` (the `just regraph`
// steps) for the concepts that are missing, and only those, so an existing store and its
// `*.enriched.json` files are never rebuilt or rewritten. It never opens a missing db (that would
// create an empty one). A failed build exits 3 with one line naming `just regraph`.
//
// Sandbox-safe like ensure-dist.mjs: node only, no pnpm, no network.
// `--check` reports what would be built without building (exit 1 when something is missing).

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT_BUILD_FAILED = 3;

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(pkgDir, "..", "..");
const cli = path.join(pkgDir, "dist", "cli.js");

function readConfig() {
  try {
    return JSON.parse(readFileSync(path.join(root, "scribe.config.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The concepts the store lacks and why, as `{ missing: string[], reason: string } | null`.
 * Null when the store is current (or there is no config / no concepts to check).
 */
export async function storeGap() {
  const config = readConfig();
  const concepts = config && config.concepts ? Object.keys(config.concepts) : [];
  if (concepts.length === 0) return null;

  const dbPath = path.resolve(root, config.dbPath ?? path.join("scribe-output", "graph.db"));
  if (!existsSync(dbPath)) {
    return { missing: concepts, reason: `${path.relative(root, dbPath)} is missing` };
  }

  let db;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    db = new DatabaseSync(dbPath, { readOnly: true });
    const live = db.prepare("SELECT count(*) AS n FROM vertices WHERE concept = ? AND status = 'live'");
    const docs = db.prepare("SELECT count(*) AS n FROM docs WHERE concept = ?");
    const missing = concepts.filter((c) => Number(live.get(c).n) === 0 && Number(docs.get(c).n) === 0);
    if (missing.length === 0) return null;
    const empty = missing.length === concepts.length;
    return {
      missing,
      reason: empty
        ? `${path.relative(root, dbPath)} holds none of the repo's concepts`
        : `the store has no ${missing.join(", ")}`,
    };
  } catch (err) {
    return { missing: concepts, reason: `${path.relative(root, dbPath)} is empty or unreadable (${err.message})` };
  } finally {
    try {
      db?.close();
    } catch {
      // nothing to release
    }
  }
}

/** True when this file is the process entrypoint (realpath of argv[1], so a symlinked checkout still runs). */
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const gap = await storeGap();
  if (gap === null) process.exit(0);

  if (process.argv.includes("--check")) {
    console.error(`store: ${gap.reason}; would build ${gap.missing.join(", ")}`);
    process.exit(1);
  }

  const fail = (what) => {
    console.error(
      `eval: could not build the graph store (${gap.reason}; ${what}); fix the error above, then run: just regraph`
    );
    process.exit(EXIT_BUILD_FAILED);
  };
  if (!existsSync(cli)) fail("dist/cli.js is missing");

  console.log(
    `store: ${gap.reason}; building ${gap.missing.length} concept(s) (${gap.missing.join(", ")}) from ${root}`
  );
  for (const concept of gap.missing) {
    for (const step of ["extract", "apply"]) {
      const r = spawnSync(process.execPath, [cli, "--root", root, step, concept], { stdio: "inherit" });
      if (r.status !== 0) fail(`${step} ${concept} exited ${r.status ?? "abnormally"}`);
    }
  }
  console.log(`store: built just now from ${root} (${gap.missing.join(", ")}; extract + apply)`);
}
