#!/usr/bin/env node
// Keeps `dist/` in step with `src/` before a just recipe runs `node packages/code-graph/dist/cli.js`
// (`just eval`, `just regraph`). The eval gate must measure the code in src/; a dist/ older than
// src/ once made it report a retrieval regression that was only a stale build.
//
// Rebuilds (does not refuse) when any compiled source under src/ is newer than its dist/ output,
// has no output, or tsconfig.json is newer than dist/cli.js. It calls the package's own tsc
// directly, not `pnpm build`: pnpm fetches its pinned version from the registry, which Claude
// Code's sandbox blocks. When dist/ is current it only stats files and exits.
//
// `--check` reports staleness without rebuilding (exit 1 when stale).

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(pkgDir, "src");
const distDir = path.join(pkgDir, "dist");
const tsconfig = path.join(pkgDir, "tsconfig.json");
const tscBin = path.join(pkgDir, "node_modules", "typescript", "bin", "tsc");
const rebuildCommand = "packages/code-graph/node_modules/.bin/tsc -p packages/code-graph/tsconfig.json";

/** The tsc inputs under `dir`: .ts/.tsx files, minus tests and declaration files (tsconfig excludes them). */
function sources(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
      found.push(full);
  }
  return found;
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/** The first reason dist/ is stale, or null when every output is at least as new as its source. */
export function staleReason() {
  const cliOut = mtime(path.join(distDir, "cli.js"));
  if (cliOut === null) return "dist/cli.js is missing";
  if ((mtime(tsconfig) ?? 0) > cliOut) return "tsconfig.json is newer than dist/cli.js";
  for (const src of sources(srcDir)) {
    const rel = path.relative(srcDir, src);
    const out = path.join(distDir, rel.replace(/\.tsx?$/, ".js"));
    const outTime = mtime(out);
    if (outTime === null) return `src/${rel} has no dist output`;
    if (mtime(src) > outTime) return `src/${rel} is newer than its dist output`;
  }
  return null;
}

/**
 * True when this file is the process entrypoint. argv[1] goes through realpath because
 * import.meta.url has symlinks resolved: a path crossing a symlink must still run the guard, or a
 * stale build would silently pass.
 */
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  const reason = staleReason();
  if (reason === null) process.exit(0);

  if (process.argv.includes("--check")) {
    console.error(`error: stale code-graph build (${reason}); rebuild with: ${rebuildCommand}`);
    process.exit(1);
  }
  if (!existsSync(tscBin)) {
    console.error(
      `error: stale code-graph build (${reason}) and no typescript under packages/code-graph/node_modules; run pnpm install`
    );
    process.exit(1);
  }

  console.error(`code-graph build is stale (${reason}); rebuilding with tsc`);
  // --noEmitOnError: a src/ with type errors leaves dist/ stale, so the next run retries and fails
  // again instead of running a half-valid build.
  const result = spawnSync(process.execPath, [tscBin, "-p", tsconfig, "--noEmitOnError"], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`error: rebuild failed; fix src/ and rerun, or rebuild with: ${rebuildCommand}`);
    process.exit(result.status ?? 1);
  }
}
