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
}

export interface StatusReport {
  /** HEAD's sha; `""` outside a git repository. */
  head: string;
  /** The repo-level record, with its own window over the whole repository; null when none. */
  list: (GitWindow & { version: string; lastUpdate: string; source: string }) | null;
  concepts: ConceptStatus[];
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
  return {
    commitsSince: Number(count.trim()),
    filesChanged: files.split("\n").filter(Boolean),
  };
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
    concepts.push({
      concept: m.concept,
      skill: skill?.id ?? null,
      path: path ? rel(projectRoot, path) : null,
      version: skill?.version ?? null,
      lastUpdate: skill ? skill.lastUpdate : null,
      globs: m.config.globs,
      scope: "globs",
      ...gitWindow(projectRoot, skill?.lastUpdate, m.config.globs),
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
