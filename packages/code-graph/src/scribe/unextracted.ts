// Source changes nobody has extracted yet. `extract` records a content hash per matched source file in
// `<concept>.ast.json` `meta.files`; this module re-scans the concept's globs and compares. It is layer 1
// safe: filesystem, hashing and glob matching only, never typescript, ts-morph or the store, so
// `skills status` can call it (a test guards the import graph).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { minimatch } from "minimatch";

/** Per-file content hashes by project-relative posix path: what `meta.files` holds. */
export type FileHashes = Record<string, string>;

export interface UnextractedChanges {
  /** Files whose content differs from what the last extract recorded. */
  changed: number;
  /** Files matching the globs now that the last extract did not see. */
  new: number;
  /** Files the last extract saw that are gone (or no longer match). */
  removed: number;
  /** Every affected path, sorted, with why it counts. */
  files: { path: string; kind: "changed" | "new" | "removed" }[];
}

/** Only code files count: the extractor reads TypeScript/JavaScript, a glob like `src/**` also matches assets. */
const CODE_FILE = /\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", "scribe-output", ".turbo", ".next"]);

function sha256(buf: Buffer): string {
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

/** The literal leading directory of a glob (`src/a/**\/*.ts` -> `src/a`), so the walk starts there. */
function staticBase(glob: string): string {
  const parts = glob.split("/");
  const base: string[] = [];
  for (const p of parts.slice(0, -1)) {
    if (/[*?[\]{}()!+@]/.test(p)) break;
    base.push(p);
  }
  return base.join("/");
}

function walk(root: string, rel: string, out: Set<string>): void {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(root, child, out);
    } else if (e.isFile() && CODE_FILE.test(e.name)) {
      out.add(child);
    }
  }
}

/** Hash every code file under `root` that one of `globs` matches. Absolute globs match absolute paths. */
export function scanConceptFiles(root: string, globs: string[]): FileHashes {
  const candidates = new Set<string>();
  const relGlobs = globs.filter((g) => !g.startsWith("/"));
  const bases = new Set(relGlobs.map(staticBase));
  if (relGlobs.length < globs.length) bases.add("");
  // A base nested under another walked base is covered by it.
  for (const b of bases) {
    if (b === "" || ![...bases].some((o) => o !== b && (o === "" || b.startsWith(o + "/")))) walk(root, b, candidates);
  }
  const out: FileHashes = {};
  for (const rel of [...candidates].sort()) {
    const abs = join(root, rel);
    if (!globs.some((g) => minimatch(rel, g, { dot: true }) || minimatch(abs, g, { dot: true }))) continue;
    try {
      out[rel] = sha256(readFileSync(abs));
    } catch {
      // vanished mid-scan
    }
  }
  return out;
}

/** Diff a recorded `meta.files` against the scan of the working tree. */
export function diffFileHashes(recorded: FileHashes, current: FileHashes): UnextractedChanges {
  const files: UnextractedChanges["files"] = [];
  for (const [path, hash] of Object.entries(current)) {
    if (!(path in recorded)) files.push({ path, kind: "new" });
    else if (recorded[path] !== hash) files.push({ path, kind: "changed" });
  }
  for (const path of Object.keys(recorded)) if (!(path in current)) files.push({ path, kind: "removed" });
  files.sort((a, b) => a.path.localeCompare(b.path));
  const count = (k: string) => files.filter((f) => f.kind === k).length;
  return { changed: count("changed"), new: count("new"), removed: count("removed"), files };
}

/**
 * Unextracted changes for a concept, or null when they cannot be known: no `<concept>.ast.json`, or one
 * written before `meta.files` existed (the next `extract` adds it).
 */
export function unextractedChanges(configRoot: string, concept: string, globs: string[]): UnextractedChanges | null {
  let recorded: unknown;
  try {
    recorded = JSON.parse(readFileSync(join(configRoot, "scribe-output", `${concept}.ast.json`), "utf-8"))?.meta?.files;
  } catch {
    return null;
  }
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded)) return null;
  return diffFileHashes(recorded as FileHashes, scanConceptFiles(configRoot, globs));
}

/** One-line text form, e.g. `unextracted: 1 changed, 1 new, 0 removed file(s)`. */
export function formatUnextracted(u: UnextractedChanges): string {
  return `unextracted: ${u.changed} changed, ${u.new} new, ${u.removed} removed file(s)`;
}
