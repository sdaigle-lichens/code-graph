// The scout's scope: reading the scope file (one existing file per line, relative to the git root, the
// contract of Maestro task 158) and splitting a large scope into sessions by import links.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

/** The largest scope the bench measured: one Haiku session never gets more files than this. */
export const MAX_FILES_PER_SESSION = 11;
/** The most sessions one run spends; the files past it are named as not scanned. */
export const MAX_SESSIONS = 5;

export type SkippedLine = { line: string; reason: string };
export type Scope = { files: string[]; skipped: SkippedLine[] };
export type Split = { sessions: string[][]; notScanned: string[] };

/** The scope file itself is missing or unreadable, as opposed to a bad line in it. */
export class ScopeFileError extends Error {}

const isOutside = (path: string) => path === ".." || path.startsWith("../");

/**
 * The directory the scope lines are relative to: the nearest one holding `.git` (a directory, or a file
 * in a worktree), as git itself finds it. Walking up keeps the result a textual prefix of `start`, even
 * through a symlink. Outside a git repository the start directory stands in.
 */
export function findRepoRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

function lineProblem(path: string, repoRoot: string, configRoot: string): string | null {
  if (isAbsolute(path)) return "absolute path";
  if (isOutside(path)) return "outside the repository";
  const absolute = join(repoRoot, path);
  try {
    if (!statSync(absolute).isFile()) return "not a file";
  } catch {
    return "no such file";
  }
  return isOutside(relative(configRoot, absolute)) ? `outside the config root ${relative(repoRoot, configRoot)}` : null;
}

/**
 * The usable files of a scope file, deduped and normalized, as paths from `repoRoot`. `scopePath` resolves
 * against the working directory, each line against `repoRoot`. A file above or beside `configRoot` exists
 * but no index of this config can hold it. A bad line never stops the run: it is kept with its reason, so
 * the caller can name it. Blank lines mean nothing.
 */
export function readScope(scopePath: string, repoRoot: string, configRoot: string = repoRoot): Scope {
  let text: string;
  try {
    text = readFileSync(resolve(scopePath), "utf8");
  } catch (err) {
    throw new ScopeFileError(`cannot read scope file ${scopePath}: ${(err as Error).message}`);
  }
  const files = new Set<string>();
  const skipped: SkippedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const path = normalize(line);
    const reason = lineProblem(path, repoRoot, configRoot);
    if (reason) skipped.push({ line, reason });
    else files.add(path);
  }
  return { files: [...files].sort(), skipped };
}

function neighbours(files: string[], edges: Array<{ from: string; to: string }>): Map<string, string[]> {
  const inScope = new Set(files);
  const sets = new Map(files.map((f) => [f, new Set<string>()]));
  for (const { from, to } of edges) {
    if (from === to || !inScope.has(from) || !inScope.has(to)) continue;
    sets.get(from)!.add(to);
    sets.get(to)!.add(from);
  }
  return new Map([...sets].map(([f, near]) => [f, [...near].sort()]));
}

/** Connected groups of at most `size` files: each grows breadth-first from the best linked file left. */
function growGroups(files: string[], near: Map<string, string[]>, size: number): string[][] {
  const left = new Set(files);
  const degree = (f: string) => near.get(f)!.filter((n) => left.has(n)).length;
  const groups: string[][] = [];
  while (left.size > 0) {
    // `files` is sorted and reduce keeps the first of equals, so a tie goes to the first path.
    const seed = [...left].reduce((best, f) => (degree(f) > degree(best) ? f : best));
    const group = [seed];
    left.delete(seed);
    for (let i = 0; i < group.length && group.length < size; i++) {
      for (const n of near.get(group[i])!) {
        if (group.length < size && left.delete(n)) group.push(n);
      }
    }
    groups.push(group.sort());
  }
  return groups;
}

/**
 * One session per scope when the scope fits. A larger one is cut along its import links into connected
 * groups, then packed largest first so that small groups share a session instead of each spending one.
 * Sessions past `maxSessions` are not spent: their files come back in `notScanned`, the smallest
 * sessions being the ones cut.
 */
export function splitScope(
  files: string[],
  edges: Array<{ from: string; to: string }>,
  maxFiles: number = MAX_FILES_PER_SESSION,
  maxSessions: number = MAX_SESSIONS
): Split {
  const sorted = [...new Set(files)].sort();
  if (sorted.length === 0) return { sessions: [], notScanned: [] };
  if (sorted.length <= maxFiles) return { sessions: [sorted], notScanned: [] };

  const groups = growGroups(sorted, neighbours(sorted, edges), maxFiles);
  groups.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  const bins: string[][] = [];
  for (const group of groups) {
    const bin = bins.find((b) => b.length + group.length <= maxFiles);
    if (bin) bin.push(...group);
    else bins.push([...group]);
  }
  // First fit opens a bin before later groups fill it, so creation order says nothing about size.
  const ranked = bins.map((b) => b.sort()).sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
  return {
    sessions: ranked.slice(0, maxSessions),
    notScanned: ranked.slice(maxSessions).flat().sort(),
  };
}
