// `code-graph deps install|status` — the explicit, visible step that populates the plugin-owned
// deps directory (see project-deps.ts). Layer-1-safe: imports no graph stack.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PINNED_DEPS, pluginDepsDirs, projectRootForDeps, resolveDependency } from "./project-deps.js";

export function depsStatus(): void {
  const projectRoot = projectRootForDeps();
  console.log(`plugin deps dirs (searched in order): ${pluginDepsDirs().join(", ")}`);
  for (const name of Object.keys(PINNED_DEPS)) {
    const found = resolveDependency(name, projectRoot);
    console.log(
      found ? `  ${name}: ${found.source} (${found.path})` : `  ${name}: missing — run \`code-graph deps install\``
    );
  }
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
