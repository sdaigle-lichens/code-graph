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
 * The root a deps dir `<root>/deps/<key>` lives under: the cache root for the cache dir, else two
 * levels up (`$CLAUDE_PLUGIN_DATA`). This is the absolute path to add to `sandbox.filesystem.allowRead`.
 */
export function depsRootDir(dir: string): string {
  const cacheRoot = cacheRootDir();
  return resolve(dir).startsWith(cacheRoot + sep) ? cacheRoot : dirname(dirname(resolve(dir)));
}

/**
 * Stat `<dir>/node_modules`, then list it. EACCES/EPERM on either is `unreadable`: the macOS Seatbelt
 * sandbox allows stat on a denied path but refuses to list or open it, so a stat alone would call a
 * denied deps dir `present` and the later resolve would fail as if it were missing. ENOENT is
 * `absent`, except in a sandbox, where bubblewrap can leave a denied home path out of the mount so a
 * hidden dir looks missing. There the surroundings decide: if the root (or its parent) lists, or is
 * denied while still visible to stat (Seatbelt, where an ENOENT below it is genuine), the dir is
 * `absent`; if neither can be seen, it is `not-visible`.
 */
export function probeDepsDir(dir: string): DepsDirState {
  const modules = join(dir, "node_modules");
  try {
    statSync(modules);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (DENIED.has(code ?? "")) return "unreadable";
    if (!isSandboxed()) return "absent";
    const root = depsRootDir(dir);
    if (listing(root) !== "gone") return "absent";
    return listing(dirname(root)) === "gone" ? "not-visible" : "absent";
  }
  const modulesListing = listing(modules);
  if (modulesListing === "denied") return "unreadable";
  return modulesListing === "ok" ? "present" : "absent";
}

/** The state that blocks a conclusion about the deps dirs: `unreadable` wins over `not-visible`; null when neither. */
export function blockedState(states: readonly DepsDirState[]): "unreadable" | "not-visible" | null {
  if (states.includes("unreadable")) return "unreadable";
  return states.includes("not-visible") ? "not-visible" : null;
}

/**
 * The absolute paths to add to `sandbox.filesystem.allowRead` for the blocked deps dirs: the root of
 * each dir in `state`, deduplicated, else the cache root (where `deps install` writes).
 */
export function allowReadPaths(
  states: readonly { dir: string; state: DepsDirState }[],
  state: "unreadable" | "not-visible"
): string[] {
  const roots = [...new Set(states.filter((s) => s.state === state).map((s) => depsRootDir(s.dir)))];
  return roots.length > 0 ? roots : [cacheRootDir()];
}

/** Advice for a session that cannot read, or cannot see, the plugin deps dir; `paths` are the dirs to allow. */
export function sandboxReadAdvice(
  state: "unreadable" | "not-visible" = "unreadable",
  paths: readonly string[] = [cacheRootDir()]
): string {
  const allow = `add ${paths.join(" and ")} to \`sandbox.filesystem.allowRead\` in your Claude Code settings`;
  return state === "not-visible"
    ? `The plugin deps directory is not visible from this sandboxed session: it may be absent or hidden. ` +
        `Check with \`code-graph deps status\` in your own shell. If ts-morph is not installed there, run ` +
        `\`${INSTALL_COMMAND}\` in your shell; if it is, ${allow}, or run the graph command outside the sandbox.`
    : `The plugin deps directory exists but cannot be read from this session (in a sandboxed session, the ` +
        `sandbox denies reading it), so ts-morph cannot be loaded from it. Do not re-run \`${INSTALL_COMMAND}\` ` +
        `for this: ${allow} and re-run, or run the graph command outside the sandbox. If ` +
        `\`code-graph deps status\` still reports ts-morph missing once the directory is readable, run ` +
        `\`${INSTALL_COMMAND}\` in your own shell.`;
}

export class MissingProjectDependencyError extends Error {
  constructor(
    readonly dependency: string,
    readonly projectRoot: string,
    readonly unreadable: boolean | "unreadable" | "not-visible" = false,
    readonly allowPaths: readonly string[] = [cacheRootDir()]
  ) {
    const notFound =
      `"${dependency}" could not be found: not in code-graph's plugin deps directory and not installed in ` +
      `${projectRoot}. `;
    super(
      (unreadable === "not-visible"
        ? notFound + sandboxReadAdvice("not-visible", allowPaths) + " "
        : unreadable
          ? `"${dependency}" could not be loaded: not readable from code-graph's plugin deps directory and not ` +
            `installed in ${projectRoot}. ` +
            sandboxReadAdvice("unreadable", allowPaths) +
            " "
          : notFound +
            `Run \`${INSTALL_COMMAND}\` (for the plugin: ` +
            `\`node "\${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" deps install\`) to install ts-morph for ` +
            `code-graph, then re-run. `) + `The \`code-graph skills\` commands need neither.`
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
    const states = pluginDepsDirs().map((dir) => ({ dir, state: probeDepsDir(dir) }));
    const blocked = blockedState(states.map((s) => s.state));
    throw new MissingProjectDependencyError(
      name,
      projectRootForDeps(),
      blocked ?? false,
      blocked ? allowReadPaths(states, blocked) : undefined
    );
  }
  return createRequire(found.path)(found.path);
}
