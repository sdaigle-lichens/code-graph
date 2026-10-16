#!/usr/bin/env node
// Fails when the three published version strings drift apart: packages/code-graph/package.json
// (baked into the bundle as the CLI version and every vertex's extractor_version), the plugin's
// plugin.json and the root marketplace.json. Run by `pnpm check` and by the bundle step.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), "utf8"));
}

/** The version found in each file, keyed by repo-relative path. */
export function readVersions() {
  const market = readJson(".claude-plugin/marketplace.json");
  return {
    "packages/code-graph/package.json": readJson("packages/code-graph/package.json").version,
    "plugin/.claude-plugin/plugin.json": readJson("plugin/.claude-plugin/plugin.json").version,
    ".claude-plugin/marketplace.json": (market.plugins ?? []).map((p) => p.version).join(","),
  };
}

/** Throws naming every file and version when they are not all equal. */
export function assertVersionsAligned() {
  const versions = readVersions();
  if (new Set(Object.values(versions)).size > 1) {
    const lines = Object.entries(versions).map(([file, v]) => `  ${file}: ${v}`);
    throw new Error(`version drift, all three must match:\n${lines.join("\n")}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertVersionsAligned();
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
