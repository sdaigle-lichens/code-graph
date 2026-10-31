// `code-graph deps install|status` — the explicit, visible step that populates the plugin-owned
// deps directory (see project-deps.ts). Layer-1-safe: imports no graph stack.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  allowReadPaths,
  blockedState,
  PINNED_DEPS,
  pluginDepsDirs,
  probeDepsDir,
  projectRootForDeps,
  resolveDependency,
  sandboxReadAdvice,
} from "./project-deps.js";

export function depsStatus(): void {
  const projectRoot = projectRootForDeps();
  const dirs = pluginDepsDirs();
  console.log(`plugin deps dirs (searched in order): ${dirs.join(", ")}`);
  const states = dirs.map((dir) => ({ dir, state: probeDepsDir(dir) }));
  const blocked = blockedState(states.map((s) => s.state));
  for (const name of Object.keys(PINNED_DEPS)) {
    const found = resolveDependency(name, projectRoot);
    if (found) {
      console.log(`  ${name}: ${found.source} (${found.path})`);
      continue;
    }
    console.log(
      blocked === "unreadable"
        ? `  ${name}: not loadable — the plugin deps dir exists but cannot be read from this session`
        : blocked === "not-visible"
          ? `  ${name}: not visible from this sandboxed session: it may be absent or hidden`
          : `  ${name}: missing — run \`code-graph deps install\``
    );
  }
  if (!blocked) return;
  for (const { dir, state } of states)
    console.log(
      `  ${dir}: ${
        state === "unreadable"
          ? "unreadable (exists, not absent)"
          : state === "not-visible"
            ? "not visible from this sandboxed session: it may be absent or hidden"
            : state
      }`
    );
  console.log(sandboxReadAdvice(blocked, allowReadPaths(states, blocked)));
}

/** Install the pinned deps into the first plugin deps dir with npm. Returns the process exit code. */
export function depsInstall(): number {
  const dir = pluginDepsDirs()[0];
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "code-graph-deps", private: true, dependencies: PINNED_DEPS }, null, 2) + "\n"
  );
  const list = Object.entries(PINNED_DEPS)
    .map(([n, v]) => `${n}@${v}`)
    .join(", ");
  console.log(`installing ${list} into ${dir} (downloads from the npm registry)`);
  const res = spawnSync("npm", ["install", "--prefix", dir, "--no-audit", "--no-fund", "--loglevel=error"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    console.error(`deps install failed${res.error ? `: ${res.error.message}` : ` (npm exit ${res.status})`}`);
    return 1;
  }
  console.log(`installed. code-graph graph commands now load ts-morph from ${dir}`);
  return 0;
}
