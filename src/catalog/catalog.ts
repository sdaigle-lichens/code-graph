import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { minimatch } from "minimatch";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceUnit = {
  name: string;
  root: string;       // absolute path
  packageName: string;
};

export type FileKind =
  | "component"
  | "hook"
  | "store"
  | "types"
  | "test"
  | "index"
  | "config"
  | "module";

export type FileDigest = {
  path: string;       // relative to project root
  unit: string;
  exports: string[];
  kind: FileKind;
  leadingDoc?: string;
};

export type ImportEdge = {
  from: string;
  to: string;
};

export type CatalogResult = {
  units: WorkspaceUnit[];
  files: FileDigest[];
  imports: ImportEdge[];
  fanIn: Record<string, number>;
  fanOut: Record<string, number>;
  hubs: string[];
};

// Injectable FS adapter — allows unit tests to pass fake implementations.
export type FsAdapter = {
  exists(p: string): boolean;
  readText(p: string): string | null;
  readJson(p: string): Record<string, unknown> | null;
  listDirs(p: string): string[];
};

// ─── Pure analysis functions ───────────────────────────────────────────────────

/**
 * Parse the `packages:` list from a pnpm-workspace.yaml string.
 * No YAML library needed — the format is a simple list of strings.
 */
export function parsePnpmWorkspaceYaml(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      if (line.length > 0 && !/^\s/.test(line)) { inPackages = false; continue; }
      // Match "  - 'pattern'" or "  - pattern", skip exclusions (starting with !)
      const m = line.match(/^\s+-\s+['"]?([^'"!\s][^'"]*?)['"]?\s*$/);
      if (m) patterns.push(m[1].trim());
    }
  }
  return patterns;
}

/**
 * Extract workspace package globs from a parsed package.json object.
 * Handles both array form and `{ packages: [...] }` (Yarn Berry / npm) form.
 */
export function parsePackageJsonWorkspaces(json: Record<string, unknown>): string[] {
  const ws = json.workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((s): s is string => typeof s === "string");
  }
  if (ws && typeof ws === "object") {
    const nested = (ws as Record<string, unknown>).packages;
    if (Array.isArray(nested)) {
      return nested.filter((s): s is string => typeof s === "string");
    }
  }
  return [];
}

/** Infer a FileKind from relative path and its export names. */
export function inferFileKind(path: string, exportNames: string[]): FileKind {
  const base = basename(path);
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base)) return "test";
  if (/^index\.(ts|tsx|js|jsx)$/.test(base)) return "index";
  // foo.config.ts / foo.rc.ts  OR  dotfile like .eslintrc.js / .prettierrc
  if (
    /\.(config|rc)\.(ts|js|mjs|cjs)$/.test(base) ||
    /^\..+rc(\.(ts|js|mjs|cjs))?$/.test(base)
  ) return "config";
  if (/\.d\.ts$/.test(base)) return "types";
  if (/\.types?\.(ts|tsx)$/.test(base)) return "types";
  if (/\.store\.(ts|tsx)$/.test(base) || /[Ss]tore\.(ts|tsx)$/.test(base)) return "store";
  // Hook: filename starts with "use" OR any export starts with "use" + uppercase
  const nameWithoutExt = base.replace(/\.(ts|tsx|js|jsx)$/, "");
  if (/^use[A-Z]/.test(nameWithoutExt)) return "hook";
  if (exportNames.some((n) => /^use[A-Z]/.test(n))) return "hook";
  // Component: has an export starting with uppercase (React convention)
  if (exportNames.some((n) => /^[A-Z]/.test(n))) return "component";
  return "module";
}

/** Compute fan-in (# of files that import this file) and fan-out (# of files this file imports). */
export function computeFanInOut(imports: ImportEdge[]): {
  fanIn: Record<string, number>;
  fanOut: Record<string, number>;
} {
  const fanIn: Record<string, number> = {};
  const fanOut: Record<string, number> = {};
  for (const { from, to } of imports) {
    fanIn[to] = (fanIn[to] ?? 0) + 1;
    fanOut[from] = (fanOut[from] ?? 0) + 1;
  }
  return { fanIn, fanOut };
}

/**
 * Return files whose fan-in count is >= minFanIn (default: 5).
 * These are likely shared infrastructure, not domain concept roots.
 */
export function flagHubs(fanIn: Record<string, number>, minFanIn = 5): string[] {
  return Object.entries(fanIn)
    .filter(([, count]) => count >= minFanIn)
    .sort((a, b) => b[1] - a[1])
    .map(([path]) => path);
}

/** Return the subset of `files` matched by at least one of `globs`. */
export function computeGlobCoverage(files: string[], globs: string[]): string[] {
  return files.filter((f) => globs.some((g) => minimatch(f, g, { dot: true })));
}

/**
 * Find files that appear in more than one concept's matched set.
 * Returns a map of `filepath → [concept1, concept2, ...]`.
 */
export function detectOverlaps(
  conceptGlobs: Record<string, string[]>,
  files: string[],
): Record<string, string[]> {
  const fileToConceptsMap = new Map<string, string[]>();
  for (const [concept, globs] of Object.entries(conceptGlobs)) {
    for (const file of files) {
      if (globs.some((g) => minimatch(file, g, { dot: true }))) {
        const list = fileToConceptsMap.get(file) ?? [];
        list.push(concept);
        fileToConceptsMap.set(file, list);
      }
    }
  }
  const overlaps: Record<string, string[]> = {};
  for (const [file, concepts] of fileToConceptsMap) {
    if (concepts.length > 1) overlaps[file] = concepts;
  }
  return overlaps;
}

// ─── Workspace glob expansion ─────────────────────────────────────────────────

function expandWorkspaceGlobs(
  root: string,
  patterns: string[],
  fs: FsAdapter,
): WorkspaceUnit[] {
  const units: WorkspaceUnit[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;

    if (!pattern.includes("*")) {
      // Literal path
      const abs = resolve(root, pattern);
      if (seen.has(abs) || !fs.exists(abs)) continue;
      seen.add(abs);
      const pkgJson = fs.readJson(join(abs, "package.json"));
      const name = basename(abs);
      const packageName = typeof pkgJson?.name === "string" ? pkgJson.name : name;
      units.push({ name, root: abs, packageName });
      continue;
    }

    // Simple "prefix/*/..." patterns — find the wildcard segment
    const parts = pattern.split("/");
    const starIdx = parts.findIndex((p) => p.includes("*"));
    if (starIdx === -1) continue;
    const base = join(root, ...parts.slice(0, starIdx));
    const remainingPattern = parts.slice(starIdx).join("/");
    for (const dir of fs.listDirs(base)) {
      if (!minimatch(dir, remainingPattern, { dot: false })) continue;
      const abs = join(base, dir);
      if (seen.has(abs)) continue;
      seen.add(abs);
      const pkgJson = fs.readJson(join(abs, "package.json"));
      const packageName = typeof pkgJson?.name === "string" ? pkgJson.name : dir;
      units.push({ name: dir, root: abs, packageName });
    }
  }
  return units;
}

function conventionScan(root: string, rootPkg: Record<string, unknown> | null, fs: FsAdapter): WorkspaceUnit[] {
  const units: WorkspaceUnit[] = [];
  for (const topDir of ["apps", "packages"]) {
    const base = join(root, topDir);
    if (!fs.exists(base)) continue;
    for (const dir of fs.listDirs(base)) {
      const abs = join(base, dir);
      const pkgJson = fs.readJson(join(abs, "package.json"));
      if (!pkgJson) continue;
      const packageName = typeof pkgJson.name === "string" ? pkgJson.name : dir;
      units.push({ name: dir, root: abs, packageName });
    }
  }
  if (units.length > 0) return units;
  // Single-package fallback
  const rawName = rootPkg?.name;
  const packageName = typeof rawName === "string"
    ? rawName.replace(/^@[^/]+\//, "")
    : basename(root);
  return [{ name: "root", root, packageName }];
}

/**
 * Detect workspace units from the project root.
 * Priority: pnpm-workspace.yaml → package.json workspaces → turbo.json/nx.json
 * → apps+packages convention dirs → single-package fallback.
 */
export function detectWorkspaceUnits(root: string, fs: FsAdapter): WorkspaceUnit[] {
  // 1. pnpm-workspace.yaml / pnpm-workspace.yml
  for (const fname of ["pnpm-workspace.yaml", "pnpm-workspace.yml"]) {
    const content = fs.readText(join(root, fname));
    if (content != null) {
      const globs = parsePnpmWorkspaceYaml(content);
      if (globs.length > 0) return expandWorkspaceGlobs(root, globs, fs);
    }
  }

  // 2. package.json "workspaces"
  const rootPkg = fs.readJson(join(root, "package.json"));
  if (rootPkg) {
    const globs = parsePackageJsonWorkspaces(rootPkg);
    if (globs.length > 0) return expandWorkspaceGlobs(root, globs, fs);
  }

  // 3. turbo.json / nx.json → use convention scan
  if (fs.exists(join(root, "turbo.json")) || fs.exists(join(root, "nx.json"))) {
    return conventionScan(root, rootPkg, fs);
  }

  // 4. Convention fallback
  return conventionScan(root, rootPkg, fs);
}

// ─── Real FS adapter ──────────────────────────────────────────────────────────

export const realFs: FsAdapter = {
  exists: (p) => existsSync(p),
  readText: (p) => {
    try { return readFileSync(p, "utf-8"); } catch { return null; }
  },
  readJson: (p) => {
    try {
      const raw = readFileSync(p, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch { return null; }
  },
  listDirs: (p) => {
    try {
      return readdirSync(p, { withFileTypes: true })
        .filter((e) => {
          if (!e.isDirectory()) return false;
          try { return statSync(join(p, e.name)).isDirectory(); } catch { return false; }
        })
        .map((e) => e.name);
    } catch { return []; }
  },
};

// ─── ts-morph catalog pass ────────────────────────────────────────────────────

const SKIP_PATH_PATTERN = /node_modules|\/(dist|\.next|build|coverage|__pycache__)\//;

function getExportNames(sf: SourceFile): string[] {
  const names: string[] = [];
  for (const [name] of sf.getExportedDeclarations()) {
    names.push(name);
  }
  return names;
}

function getLeadingDoc(sf: SourceFile): string | undefined {
  const m = sf.getFullText().match(/^\/\*\*([\s\S]*?)\*\//);
  if (!m) return undefined;
  return m[0]
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .replace(/\s*\*\s?/gm, " ")
    .trim();
}

function assignUnit(absPath: string, units: WorkspaceUnit[]): string {
  let bestName = units[0]?.name ?? "root";
  let bestLen = 0;
  for (const u of units) {
    if (absPath.startsWith(u.root) && u.root.length > bestLen) {
      bestName = u.name;
      bestLen = u.root.length;
    }
  }
  return bestName;
}

export async function runCatalog(opts: {
  root: string;
  tsconfig: string;
  hubMinFanIn?: number;
  fs?: FsAdapter;
}): Promise<CatalogResult> {
  const { root, tsconfig, hubMinFanIn = 5, fs: fsAdp = realFs } = opts;
  const units = detectWorkspaceUnits(root, fsAdp);

  const project = new Project({
    tsConfigFilePath: tsconfig,
    skipAddingFilesFromTsConfig: false,
  });

  const files: FileDigest[] = [];
  const rawImports: Array<{ from: string; to: string }> = [];

  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath() as string;
    if (SKIP_PATH_PATTERN.test(absPath)) continue;
    const relPath = relative(root, absPath).replace(/\\/g, "/");
    if (relPath.startsWith("..")) continue;

    const exportNames = getExportNames(sf);
    const kind = inferFileKind(relPath, exportNames);
    const leadingDoc = getLeadingDoc(sf);

    files.push({
      path: relPath,
      unit: assignUnit(absPath, units),
      exports: exportNames,
      kind,
      ...(leadingDoc ? { leadingDoc } : {}),
    });

    for (const imp of sf.getImportDeclarations()) {
      const resolved = imp.getModuleSpecifierSourceFile();
      if (!resolved) continue;
      const toAbs = resolved.getFilePath() as string;
      if (SKIP_PATH_PATTERN.test(toAbs)) continue;
      const toRel = relative(root, toAbs).replace(/\\/g, "/");
      if (toRel.startsWith("..")) continue;
      rawImports.push({ from: relPath, to: toRel });
    }
  }

  // Dedupe import edges (a file may have multiple import statements from the same target)
  const seen = new Set<string>();
  const imports: ImportEdge[] = [];
  for (const e of rawImports) {
    const key = `${e.from}|${e.to}`;
    if (!seen.has(key)) { seen.add(key); imports.push(e); }
  }

  const { fanIn, fanOut } = computeFanInOut(imports);
  const hubs = flagHubs(fanIn, hubMinFanIn);

  return { units, files, imports, fanIn, fanOut, hubs };
}

/** Find the tsconfig path to use for a catalog run (no scribe.config.json needed). */
export function resolveTsconfig(cwd: string, explicit?: string): string | null {
  if (explicit) return explicit;
  for (const name of ["tsconfig.json", "tsconfig.app.json", "tsconfig.base.json"]) {
    const p = join(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}
