// `code-graph scout --proposals`: the deterministic half of the skill's last step. The skill pipes in the
// `PROPOSALS:` sections its Haiku sessions returned; this prints one `PROPOSALS:` block whose every path is
// relative to the git root, whatever form a session answered in (absolute, `./`-prefixed, or relative to
// the config root when `scribe.config.json` sits in a subdirectory). A prompt alone cannot promise that:
// a model can still answer with an absolute path. The rest of each line is kept as returned.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";

/** Stdin held no `PROPOSALS:` line: no session answered, so there is nothing to print, not a clean result. */
export const EXIT_SCOUT_NO_PROPOSALS = 13;

export type ProposalRoots = {
  /** The git root: printed paths are relative to it. */
  repoRoot: string;
  /** The directory holding `scribe.config.json`, at or below `repoRoot`. */
  configRoot: string;
  /** Overridable for tests; defaults to `existsSync`. */
  exists?: (absolute: string) => boolean;
};

export type AssembledProposals = {
  /** True when at least one `PROPOSALS:` line was given: a scan answered. */
  answered: boolean;
  /** Every bullet (`- `, `* `, `1. `, `1) `) after a `PROPOSALS:` line, as a `- ` line, its path normalised. */
  lines: string[];
  /** Paths outside the repository, kept as given. */
  outside: string[];
};

const SECTION = /^\s*PROPOSALS:/;
/** A `- `, `* `, `1. ` or `1) ` bullet; every one is printed as a `- ` bullet. */
const BULLET = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/;
/** A trailing `:12` or `:12-30` line reference, kept apart from the file part. */
const LINE_REF = /(:\d+(?:-\d+)?)$/;
/** A path in backticks, with an optional line reference after the closing backtick. */
const QUOTED_PATH = /^`([^`]+)`(:\d+(?:-\d+)?)?$/;

const toPosix = (p: string) => p.split(sep).join("/");
const leavesRoot = (rel: string) => rel === ".." || rel.startsWith("../") || isAbsolute(rel);

/**
 * One path, git-root-relative when it is inside the repository, else `null` (the caller keeps it as given).
 * A relative path is taken from the git root when it exists there, else from the config root when it
 * exists there; for a file neither has (a proposed new file), the same test runs on its directory, and
 * the git root wins when nothing settles it. A `../` path is judged from the config root, so only one that
 * leaves the git root from there is null. The root itself is `.`.
 */
export function normaliseProposalPath(path: string, roots: ProposalRoots): string | null {
  const exists = roots.exists ?? existsSync;
  if (isAbsolute(path)) {
    const rel = toPosix(relative(roots.repoRoot, path));
    if (rel === "") return ".";
    return leavesRoot(rel) ? null : rel;
  }
  const clean = posix.normalize(toPosix(path));
  if (clean === ".") return null;
  const subdir = toPosix(relative(roots.repoRoot, roots.configRoot));
  const nested = subdir !== "" && !leavesRoot(subdir);
  // `..` is judged after the config root is joined: `../shared/x.ts` from `pkg/` is `shared/x.ts`, inside.
  const inConfig = nested ? posix.join(subdir, clean) : null;
  if (leavesRoot(clean)) return inConfig === null || leavesRoot(inConfig) ? null : inConfig;
  if (inConfig === null) return clean;
  const candidates: Array<(p: string) => string> = [(p) => p, (p) => posix.dirname(p)];
  for (const pick of candidates) {
    if (exists(join(roots.repoRoot, pick(clean)))) return clean;
    if (exists(join(roots.repoRoot, pick(inConfig)))) return inConfig;
  }
  return clean;
}

/**
 * The file part and line reference of a path token, backticks dropped: `` `a.ts`:12 ``, `` `a.ts:12` ``,
 * `` `a.ts` `` and `a.ts:12` all give `a.ts` (and `:12`). A token with any other backtick layout keeps
 * its backticks, so it is no path and stays as given.
 */
function splitPathToken(raw: string): { file: string; ref: string } {
  const quoted = raw.match(QUOTED_PATH);
  if (quoted?.[2]) return { file: quoted[1], ref: quoted[2] };
  const token = quoted ? quoted[1] : raw;
  const ref = token.match(LINE_REF)?.[1] ?? "";
  return { file: token.slice(0, token.length - ref.length), ref };
}

/** Splits `<path>: <rest>` and rewrites the path; a line with no `: ` is kept as given. */
function normaliseLine(body: string, roots: ProposalRoots, outside: string[]): string {
  const cut = body.indexOf(": ");
  if (cut <= 0) return `- ${body}`;
  const { file, ref } = splitPathToken(body.slice(0, cut));
  const rewritten = file ? normaliseProposalPath(file, roots) : null;
  if (rewritten === null) {
    // null means outside the repository, except for the relative `.`, which names no file.
    if (file && posix.normalize(toPosix(file)) !== ".") outside.push(`${file}${ref}`);
    return `- ${body}`;
  }
  return `- ${rewritten}${ref}${body.slice(cut)}`;
}

/** All of stdin when it is piped; "" for a TTY or a closed stream, which then holds no section. */
export function readStdin(): string {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Reads the sessions' returned sections: every bullet after a `PROPOSALS:` line, prose ignored. */
export function assembleProposals(text: string, roots: ProposalRoots): AssembledProposals {
  const lines: string[] = [];
  const outside: string[] = [];
  let answered = false;
  for (const line of text.split(/\r?\n/)) {
    if (SECTION.test(line)) {
      answered = true;
      continue;
    }
    if (!answered) continue;
    const bullet = line.match(BULLET);
    if (bullet && bullet[1].trim()) lines.push(normaliseLine(bullet[1].trim(), roots, outside));
  }
  return { answered, lines, outside };
}

/** What the skill prints. Only called when `answered`: no section means no scan, never `PROPOSALS: none`. */
export function formatProposals(result: AssembledProposals): string {
  const out: string[] = [];
  if (result.outside.length > 0) {
    out.push(`outside the repository: ${result.outside.length} path(s) kept as given: ${result.outside.join(", ")}`);
  }
  out.push(result.lines.length > 0 ? "PROPOSALS:" : "PROPOSALS: none", ...result.lines);
  return out.join("\n");
}
