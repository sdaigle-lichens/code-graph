// Loading `typescript` / `ts-morph` from the PROJECT being graphed, for the bundled plugin script.
//
// `plugin/scripts/code-graph.cjs` ships by file copy with no node_modules beside it, and bundling
// the TypeScript compiler would make it tens of megabytes. So the bundle marks both external and
// the build routes every `import … from "ts-morph"` / `"typescript"` through `requireFromProject`,
// which resolves them with `createRequire(<project>/package.json)` — the copy the project itself
// installed, found by Node's normal node_modules walk (hoisted monorepo installs included).
//
// The project is the directory of the nearest `scribe.config.json` at or above the cwd, else the
// cwd. Only graph commands (extract, catalog) reach this; the `skills` layer never does.
//
// The tsc build (dist/) does not use this module: its imports resolve against code-graph's own
// dependencies as they always have.

import { createRequire } from "node:module";
import { join } from "node:path";
import { findConfigRoot } from "./skills/state.js";

export class MissingProjectDependencyError extends Error {
  constructor(
    readonly dependency: string,
    readonly projectRoot: string
  ) {
    super(
      `"${dependency}" is not installed in ${projectRoot}. code-graph's graph commands use the project's own ` +
        `typescript and ts-morph — install dependencies first (e.g. \`npm install --save-dev typescript ts-morph\`), ` +
        `then re-run. The \`code-graph skills\` commands need neither.`
    );
    this.name = "MissingProjectDependencyError";
  }
}

/** `require(name)` as the project would resolve it; throws `MissingProjectDependencyError` when absent. */
export function requireFromProject(name: string): unknown {
  const projectRoot = findConfigRoot(process.cwd()) ?? process.cwd();
  const req = createRequire(join(projectRoot, "package.json"));
  let resolved: string;
  try {
    resolved = req.resolve(name);
  } catch {
    throw new MissingProjectDependencyError(name, projectRoot);
  }
  return req(resolved);
}
