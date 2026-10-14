// The package version, and where the package lives — in both of the forms code-graph runs as.
//
//   - `dist/cli.js` (tsc output, the global dev binary): `package.json` is one level above this
//     module, found through `import.meta.url`.
//   - `plugin/scripts/code-graph.cjs` (the esbuild bundle): there is no package directory beside
//     it, and `import.meta` is empty in CJS. The bundler defines `__CODE_GRAPH_VERSION__` instead,
//     and `packageRoot()` is null.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

declare const __CODE_GRAPH_VERSION__: string | undefined;

const BUNDLED = typeof __CODE_GRAPH_VERSION__ === "string";

/** The package directory (holding package.json and eval/), or null when running from the bundle. */
export function packageRoot(): string | null {
  if (BUNDLED) return null;
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

let cached: string | null = null;

/** The code-graph version: the bundle's baked-in constant, else the package.json beside dist/. */
export function packageVersion(): string {
  if (BUNDLED) return __CODE_GRAPH_VERSION__ as string;
  if (cached === null) {
    const pkg = JSON.parse(readFileSync(join(packageRoot()!, "package.json"), "utf-8")) as { version: string };
    cached = pkg.version;
  }
  return cached;
}
