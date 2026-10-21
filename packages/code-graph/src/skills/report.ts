// `skills check` and `skills status`: concept skills held up against the config's concepts, and
// against git.
//
// A concept (a `concepts.<name>` entry of scribe.config.json) is matched to its concept skill by
// the `skill` path it declares, else by a marked skill whose id or directory name equals the
// concept key. A marked skill that matches no concept is allowed — it is a docs-only concept, which
// is how a repo with no graph (or no TypeScript) keeps concept skills at all.
//
// Layer 1: git is the only freshness source here. Nothing may load `node:sqlite`, `typescript` or
// `ts-morph`.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { discoverConceptSkills, type ConceptSkill } from "./concept-skills.js";
import { readConcepts, readConceptSkillsState, type SkillsConcept } from "./state.js";
// Graph-free on purpose (fs + hashing + minimatch): see the header and the layer-1 import guard test.
import { unextractedChanges, type UnextractedChanges } from "../scribe/unextracted.js";

interface Matched {
  concept: string;
  config: SkillsConcept;
  /** The declared `skill` path, absolute; null when the concept declares none. */
  declared: string | null;
  /** The marked skill at the declared path. */
  byPath: ConceptSkill | null;
  /** A marked skill whose id or directory name is the concept key. */
  byName: ConceptSkill | null;
}

function matchConcepts(projectRoot: string, skills: ConceptSkill[]): Matched[] {
  return Object.entries(readConcepts(projectRoot)).map(([concept, config]) => {
    const declared = config.skill ? resolve(projectRoot, config.skill) : null;
    return {
      concept,
      config,
      declared,
      byPath: declared ? (skills.find((s) => s.skillPath === declared) ?? null) : null,
      byName: skills.find((s) => s.id === concept || basename(s.dir) === concept) ?? null,
    };
  });
}

const rel = (projectRoot: string, p: string) => relative(projectRoot, p).replace(/\\/g, "/");

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

export interface CheckReport {
  /** No missing skills and no path mismatches. Unmarked and docs-only entries do not clear it. */
  ok: boolean;
  /** Concepts with no SKILL.md: none declared and none found by name, or a declared path that is not there. */
  missing: { concept: string; declared: string | null }[];
  /** A concept whose declared `skill` path disagrees with the marked skill named after it. */
  mismatches: { concept: string; declared: string; found: string }[];
  /** A concept whose declared SKILL.md exists but carries no concept-skill marker yet. */
  unmarked: { concept: string; path: string }[];
  /** Marked skills that belong to no concept — allowed: docs-only concepts. */
  docsOnly: { id: string; path: string }[];
}

export async function checkConceptSkills(projectRoot: string): Promise<CheckReport> {
  const skills = await discoverConceptSkills(projectRoot);
  const matched = matchConcepts(projectRoot, skills);
  const report: CheckReport = { ok: true, missing: [], mismatches: [], unmarked: [], docsOnly: [] };
  const claimed = new Set<string>();

  for (const m of matched) {
    if (m.byPath) claimed.add(m.byPath.skillPath);
    if (m.byName) claimed.add(m.byName.skillPath);
    const declaredExists = m.declared !== null && existsSync(m.declared);

    if (m.declared && m.byName && m.byName.skillPath !== m.declared) {
      report.mismatches.push({
        concept: m.concept,
        declared: rel(projectRoot, m.declared),
        found: rel(projectRoot, m.byName.skillPath),
      });
    } else if (!declaredExists && !m.byName) {
      report.missing.push({ concept: m.concept, declared: m.declared ? rel(projectRoot, m.declared) : null });
    }
    if (m.declared && declaredExists && !m.byPath) {
      report.unmarked.push({ concept: m.concept, path: rel(projectRoot, m.declared) });
    }
  }
  for (const s of skills) {
    if (!claimed.has(s.skillPath)) report.docsOnly.push({ id: s.id, path: rel(projectRoot, s.skillPath) });
  }
  report.ok = report.missing.length === 0 && report.mismatches.length === 0;
  return report;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export interface GitWindow {
  /** Commits in `<lastUpdate>..HEAD` touching the scope; null when it cannot be counted. */
  commitsSince: number | null;
  /** Files changed in `<lastUpdate>..HEAD` within the scope; `[]` when it cannot be computed. */
  filesChanged: string[];
  /** The same files with the commits touching each since `<lastUpdate>` (`[]` when none or not computable). */
  filesChangedCounts?: { path: string; commits: number }[];
  /** Why `commitsSince` is null: never stamped, a sha git does not know, or not a git repo. */
  reason?: "unstamped" | "unknown-commit" | "malformed-sha" | "not-a-git-repo";
  /** True when the window could not be computed because the recorded sha is unusable (unknown or malformed). */
  unknownFreshness?: true;
}

/** A stored `last-update` is hand-editable: only a plain hex object name may reach a git revision range. */
const SHA_RE = /^[0-9a-f]{4,64}$/i;

export interface ConceptStatus extends GitWindow {
  /** The config's concept key; null for a docs-only concept skill. */
  concept: string | null;
  /** The concept skill's id; null when the concept has none yet. */
  skill: string | null;
  /** The SKILL.md, relative to the project root; null when there is none. */
  path: string | null;
  version: string | null;
  lastUpdate: string | null;
  /** The pathspecs the window was counted over; `[]` means the whole repository. */
  globs: string[];
  /** `globs` when counted over the concept's globs; `repo` for a docs-only skill (whole repository). */
  scope: "globs" | "repo";
  /** Graph freshness (see `scribe/freshness.ts`); present only when a store holds this concept. */
  graph?: import("../scribe/freshness.js").GraphFreshness;
  /**
   * Source files under the globs that differ from what the last `extract` recorded (edited, new, removed).
   * Counts files, not vertices; present only when `<concept>.ast.json` records `meta.files`. A non-zero
   * count means: run `extract` then `apply`.
   */
  unextracted?: UnextractedChanges;
}

export interface StatusReport {
  /** HEAD's sha; `""` outside a git repository. */
  head: string;
  /** The repo-level record, with its own window over the whole repository; null when none. */
  list: (GitWindow & { version: string; lastUpdate: string; source: string }) | null;
  concepts: ConceptStatus[];
}

export interface StatusSummary {
  head: string;
  list: { v: string; at: string; commits: number | null } | null;
  concepts: {
    id: string;
    v: string | null;
    at: string | null;
    /** Commits since `at` over the concept's globs; null when not countable. */
    commits: number | null;
    files: number;
    /** Live vertices / enriched / changed / stale; absent when the store holds none for the concept. */
    graph?: { vertices: number; enriched: number; changed: number; stale: number };
    /** Source files edited / added / removed since the last extract (counts only); absent until the .ast.json records them. */
    unextracted?: { changed: number; new: number; removed: number };
  }[];
}

/** The compact form of `skills status --json` (one short entry per concept; no globs, paths or file lists). */
export function summarizeStatus(report: StatusReport): StatusSummary {
  return {
    head: report.head.slice(0, 8),
    list: report.list
      ? { v: report.list.version, at: report.list.lastUpdate.slice(0, 8), commits: report.list.commitsSince }
      : null,
    concepts: report.concepts.map((c) => ({
      id: c.concept ?? c.skill ?? "?",
      v: c.version,
      at: c.lastUpdate ? c.lastUpdate.slice(0, 8) : null,
      commits: c.commitsSince,
      files: c.filesChanged.length,
      ...(c.graph
        ? {
            graph: {
              vertices: c.graph.vertices,
              enriched: c.graph.enrichedVertices,
              changed: c.graph.changed,
              stale: c.graph.stale,
            },
          }
        : {}),
      ...(c.unextracted
        ? { unextracted: { changed: c.unextracted.changed, new: c.unextracted.new, removed: c.unextracted.removed } }
        : {}),
    })),
  };
}

/** Runs git in `projectRoot`; null when git fails (not a repository, unknown sha, no git). */
export function git(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** HEAD of the project's repository, or `""` outside one. */
export function headSha(projectRoot: string): string {
  return git(projectRoot, ["rev-parse", "HEAD"])?.trim() ?? "";
}

/** The git window `<sha>..HEAD` over `globs` (whole repo when empty). Globs use git's `:(glob)` magic. */
export function gitWindow(projectRoot: string, sha: string | null | undefined, globs: string[]): GitWindow {
  if (!sha) return { commitsSince: null, filesChanged: [], reason: "unstamped" };
  if (!SHA_RE.test(sha)) {
    return { commitsSince: null, filesChanged: [], reason: "malformed-sha", unknownFreshness: true };
  }
  if (git(projectRoot, ["rev-parse", "--git-dir"]) === null) {
    return { commitsSince: null, filesChanged: [], reason: "not-a-git-repo" };
  }
  if (git(projectRoot, ["cat-file", "-e", `${sha}^{commit}`]) === null) {
    return { commitsSince: null, filesChanged: [], reason: "unknown-commit", unknownFreshness: true };
  }
  const pathspecs = globs.length ? ["--", ...globs.map((g) => `:(glob)${g}`)] : [];
  const count = git(projectRoot, ["rev-list", "--count", `${sha}..HEAD`, ...pathspecs]);
  const files = git(projectRoot, ["diff", "--name-only", `${sha}..HEAD`, ...pathspecs]);
  if (count === null || files === null) {
    return { commitsSince: null, filesChanged: [], reason: "unknown-commit", unknownFreshness: true };
  }
  const filesChanged = files.split("\n").filter(Boolean);
  return {
    commitsSince: Number(count.trim()),
    filesChanged,
    filesChangedCounts: commitCounts(projectRoot, sha, pathspecs, filesChanged),
  };
}

/** Commits per file in `<sha>..HEAD` (one `git log --name-only` pass), for the files that differ. */
function commitCounts(
  projectRoot: string,
  sha: string,
  pathspecs: string[],
  filesChanged: string[]
): { path: string; commits: number }[] {
  if (filesChanged.length === 0) return [];
  const log = git(projectRoot, ["log", "--format=", "--name-only", "--no-renames", `${sha}..HEAD`, ...pathspecs]);
  const counts = new Map<string, number>();
  for (const line of (log ?? "").split("\n")) if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
  return filesChanged.map((p) => ({ path: p, commits: counts.get(p) ?? 1 }));
}

/** Files under the concept's globs at HEAD (tracked), for the changed vs. unchanged split. */
export function mappedFiles(projectRoot: string, globs: string[]): string[] {
  if (globs.length === 0) return [];
  const out = git(projectRoot, ["ls-files", "--", ...globs.map((g) => `:(glob)${g}`)]);
  return (out ?? "").split("\n").filter(Boolean);
}

/** A SKILL.md without its frontmatter `metadata:` marker lines (`version`, `last-update`), line endings normalised. */
function stripMarkerLines(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return lines.join("\n");
  const end = lines.indexOf("---", 1);
  if (end === -1) return lines.join("\n");
  let inMetadata = false;
  return lines
    .filter((l, i) => {
      if (i === 0 || i >= end) return true;
      if (/^\S/.test(l)) inMetadata = /^metadata:\s*$/.test(l);
      return !(inMetadata && /^\s+(version|last-update):/.test(l));
    })
    .join("\n");
}

export interface BlindStampWarning {
  reason: "mapped-files-changed-skill-unchanged";
  files: string[];
}

/**
 * The check behind `skills stamp <skill>`: mapped files changed since the previous stamp while the
 * SKILL.md did not (not committed in the window, nothing staged or unstaged). Null means no warning,
 * including every case where the check cannot apply (unstamped, no globs, unusable sha, no git).
 */
export function blindStampWarning(projectRoot: string, skill: ConceptSkill): BlindStampWarning | null {
  if (!skill.lastUpdate) return null;
  const m = matchConcepts(projectRoot, [skill]).find((c) => c.byPath || c.byName);
  if (!m || m.config.globs.length === 0) return null;
  const window = gitWindow(projectRoot, skill.lastUpdate, m.config.globs);
  if (window.commitsSince === null || window.filesChanged.length === 0) return null;
  const skillRel = rel(projectRoot, skill.skillPath);
  // The commit that carried the previous stamp rewrote the metadata marker lines; that alone is not
  // an edit. Only those lines, inside the frontmatter, are ignored: a body `version:` is prose.
  const pending = git(projectRoot, ["status", "--porcelain", "--", skillRel]);
  if (pending === null || pending.trim()) return null;
  const before = git(projectRoot, ["show", `${skill.lastUpdate}:${skillRel}`]);
  const after = git(projectRoot, ["show", `HEAD:${skillRel}`]);
  // Absent at either end (added or removed in the window) is an edit.
  if (before === null || after === null) return null;
  if (stripMarkerLines(before) !== stripMarkerLines(after)) return null;
  return { reason: "mapped-files-changed-skill-unchanged", files: window.filesChanged };
}

/** One concept's status for `skills status <skill>`, matched like `stamp` (id, directory or SKILL.md path). */
export function findConceptStatus(
  projectRoot: string,
  report: StatusReport,
  skillPath: string | null,
  target: string
): ConceptStatus | null {
  return (
    report.concepts.find(
      (c) =>
        (skillPath !== null && c.path !== null && resolve(projectRoot, c.path) === skillPath) ||
        c.skill === target ||
        c.concept === target
    ) ?? null
  );
}

export async function conceptSkillsStatus(projectRoot: string): Promise<StatusReport> {
  const skills = await discoverConceptSkills(projectRoot);
  const matched = matchConcepts(projectRoot, skills);
  const claimed = new Set<string>();
  const concepts: ConceptStatus[] = [];

  for (const m of matched) {
    const skill = m.byPath ?? m.byName;
    if (m.byPath) claimed.add(m.byPath.skillPath);
    if (m.byName) claimed.add(m.byName.skillPath);
    const path = skill ? skill.skillPath : m.declared && existsSync(m.declared) ? m.declared : null;
    const unextracted = unextractedChanges(projectRoot, m.concept, m.config.globs);
    concepts.push({
      concept: m.concept,
      skill: skill?.id ?? null,
      path: path ? rel(projectRoot, path) : null,
      version: skill?.version ?? null,
      lastUpdate: skill ? skill.lastUpdate : null,
      globs: m.config.globs,
      scope: "globs",
      ...gitWindow(projectRoot, skill?.lastUpdate, m.config.globs),
      ...(unextracted && { unextracted }),
    });
  }
  for (const s of skills) {
    if (claimed.has(s.skillPath)) continue;
    concepts.push({
      concept: null,
      skill: s.id,
      path: rel(projectRoot, s.skillPath),
      version: s.version,
      lastUpdate: s.lastUpdate,
      globs: [],
      scope: "repo",
      ...gitWindow(projectRoot, s.lastUpdate, []),
    });
  }

  const state = readConceptSkillsState(projectRoot);
  return {
    head: headSha(projectRoot),
    list: state
      ? {
          version: state.version,
          lastUpdate: state.last_update,
          source: state.source,
          ...gitWindow(projectRoot, state.last_update, []),
        }
      : null,
    concepts,
  };
}
