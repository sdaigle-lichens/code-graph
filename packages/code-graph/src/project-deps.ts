// Loading `typescript` / `ts-morph` for the bundled plugin script.
//
// `plugin/scripts/code-graph.cjs` ships by file copy with no node_modules beside it, and bundling
// the TypeScript compiler would make it tens of megabytes. So the bundle marks both external and
// the build routes every `import … from "ts-morph"` / `"typescript"` through `requireFromProject`,
// which resolves them in this order:
//
//   (a) a plugin-owned deps directory, populated by the explicit `code-graph deps install` step:
//       `$CLAUDE_PLUGIN_DATA/deps/<key>` when Claude Code exposes it, and always the per-user cache
//       `<XDG_CACHE_HOME|~/.cache>/code-graph/deps/<key>` (both are searched, so an install made
//       with or without the env var is found either way). `<key>` names the pinned deps, e.g.
//       `ts-morph@28.0.0`, not the code-graph version: one install survives every plugin update and a
//       new download is needed only when a pin changes. After upgrading from <= 0.3.7, run
//       `deps install` once more; the old `deps/0.3.*` folders are never searched and can be deleted;
//   (b) the project's own install, `createRequire(<project>/package.json)` (hoisted monorepo installs
//       included) — the fallback.
//
// The project is the directory of the nearest `scribe.config.json` at or above the cwd, else the
// cwd. Only graph commands (extract, catalog) reach this; the `skills` layer never does.
//
// The tsc build (dist/) does not use this module for loading: its imports resolve against
// code-graph's own dependencies as they always have.

import { readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { findConfigRoot } from "./skills/state.js";

/**
 * What `deps install` installs. ts-morph carries its own TypeScript compiler (`@ts-morph/common`)
 * and code-graph only imports `ts-morph`, so no separate `typescript` copy is installed. Keep in
 * step with the `ts-morph` range in packages/code-graph/package.json.
 */
export const PINNED_DEPS: Readonly<Record<string, string>> = { "ts-morph": "28.0.0" };

export const INSTALL_COMMAND = "code-graph deps install";

/** Claude Code's Bash sandbox marks every sandboxed command with `SANDBOX_RUNTIME=1`. */
export function isSandboxed(): boolean {
  return process.env.SANDBOX_RUNTIME === "1";
}

/** `<XDG_CACHE_HOME|~/.cache>/code-graph`, absolute: the directory to allow-list for a sandboxed session. */
export function cacheRootDir(): string {
  return resolve(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "code-graph");
}

/**
 * How a plugin deps dir looks from this process: usable, truly absent, denied (`unreadable`), or, in a
 * sandboxed session only, not visible (the cache root itself cannot be seen, so it may be absent or hidden).
 */
export type DepsDirState = "present" | "absent" | "unreadable" | "not-visible";

const DENIED = new Set(["EACCES", "EPERM"]);

/** `ok` when the directory lists, `denied` on EACCES/EPERM, `gone` for anything else (ENOENT, ENOTDIR). */
function listing(dir: string): "ok" | "denied" | "gone" {
  try {
    readdirSync(dir);
    return "ok";
  } catch (e) {
    return DENIED.has((e as NodeJS.ErrnoException).code ?? "") ? "denied" : "gone";
  }
}

/**
 * Stat `<dir>/node_modules`. EACCES/EPERM is `unreadable`. ENOENT is `absent`, except in a sandbox,
 * where bubblewrap can leave a denied home path out of the mount so a hidden dir looks missing. There
 * the surroundings decide: if the cache root (or its parent) lists and the dir is not in it, it is
 * `absent`; if neither can be seen, it is `not-visible`.
 */
export function probeDepsDir(dir: string): DepsDirState {
  try {
    statSync(join(dir, "node_modules"));
    return "present";
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (DENIED.has(code ?? "")) return "unreadable";
    if (!isSandboxed()) return "absent";
  }
  const cacheRoot = cacheRootDir();
  // `<root>/deps/<key>`: the root is the cache root for the cache dir, else two levels up (CLAUDE_PLUGIN_DATA).
  const root = resolve(dir).startsWith(cacheRoot + sep) ? cacheRoot : dirname(dirname(resolve(dir)));
  const rootListing = listing(root);
  if (rootListing === "denied") return "unreadable";
  if (rootListing === "ok") return "absent";
  const parentListing = listing(dirname(root));
  if (parentListing === "denied") return "unreadable";
  return parentListing === "ok" ? "absent" : "not-visible";
}

/** The state that blocks a conclusion about the deps dirs: `unreadable` wins over `not-visible`; null when neither. */
export function blockedState(states: readonly DepsDirState[]): "unreadable" | "not-visible" | null {
  if (states.includes("unreadable")) return "unreadable";
  return states.includes("not-visible") ? "not-visible" : null;
}

/** Advice for a sandboxed session that cannot read, or cannot see, the plugin deps dir. */
export function sandboxReadAdvice(state: "unreadable" | "not-visible" = "unreadable"): string {
  const allow = `add ${cacheRootDir()} to \`sandbox.filesystem.allowRead\` in your Claude Code settings`;
  return state === "not-visible"
    ? `The plugin deps directory is not visible from this sandboxed session: it may be absent or hidden. ` +
        `Check with \`code-graph deps status\` in your own shell. If ts-morph is not installed there, run ` +
        `\`${INSTALL_COMMAND}\` in your shell; if it is, ${allow}, or run the graph command outside the sandbox.`
    : `The plugin deps directory may exist but cannot be read from this sandboxed session. ` +
        `Check with \`code-graph deps status\` in your own shell; if ts-morph is installed there, ${allow}, ` +
        `or run the graph command outside the sandbox.`;
}

export class MissingProjectDependencyError extends Error {
  constructor(
    readonly dependency: string,
    readonly projectRoot: string,
    readonly unreadable: boolean | "unreadable" | "not-visible" = false
  ) {
    super(
      `"${dependency}" could not be found: not in code-graph's plugin deps directory and not installed in ` +
        `${projectRoot}. ` +
        (unreadable
          ? `${sandboxReadAdvice(unreadable === "not-visible" ? "not-visible" : "unreadable")} If it is not installed anywhere, run \`${INSTALL_COMMAND}\` in your own shell. `
          : `Run \`${INSTALL_COMMAND}\` (for the plugin: \`node "\${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" deps install\`) ` +
            `to install ts-morph for code-graph, then re-run. `) +
        `The \`code-graph skills\` commands need neither.`
    );
    this.name = "MissingProjectDependencyError";
  }
}

/** Folder name for a set of pinned deps: sorted `name@version` pairs joined with `+` (stable, version-independent). */
export function depsKey(deps: Readonly<Record<string, string>> = PINNED_DEPS): string {
  return Object.entries(deps)
    .map(([name, version]) => `${name}@${version}`)
    .sort()
    .join("+");
}

/** Per-user cache location for the plugin-owned deps. */
export function cacheDepsDir(): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cache, "code-graph", "deps", depsKey());
}

/** Plugin-owned deps directories in lookup order; the first is where `deps install` writes. */
export function pluginDepsDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.CLAUDE_PLUGIN_DATA) dirs.push(join(process.env.CLAUDE_PLUGIN_DATA, "deps", depsKey()));
  dirs.push(cacheDepsDir());
  return dirs;
}

function tryResolve(name: string, base: string): string | null {
  try {
    return createRequire(join(base, "package.json")).resolve(name);
  } catch {
    return null;
  }
}

/** Where `name` resolves from: a plugin-owned dir first, then the project. Null when neither has it. */
export function resolveDependency(
  name: string,
  projectRoot: string
): { path: string; source: "plugin" | "project" } | null {
  for (const dir of pluginDepsDirs()) {
    if (probeDepsDir(dir) !== "present") continue;
    const path = tryResolve(name, dir);
    if (path) return { path, source: "plugin" };
  }
  const path = tryResolve(name, projectRoot);
  return path ? { path, source: "project" } : null;
}

export function projectRootForDeps(): string {
  return findConfigRoot(process.cwd()) ?? process.cwd();
}

/** `require(name)` from the plugin deps dir, else the project; throws `MissingProjectDependencyError` when absent. */
export function requireFromProject(name: string): unknown {
  const found = resolveDependency(name, projectRootForDeps());
  if (!found) {
    const blocked = blockedState(pluginDepsDirs().map(probeDepsDir));
    throw new MissingProjectDependencyError(name, projectRootForDeps(), blocked ?? false);
  }
  return createRequire(found.path)(found.path);
}
