// Concept skills — the marker, its version arithmetic, discovery and stamping.
//
// Ported from maestro's `packages/concept-skills/src/concept-skills.ts`. The marker is
// byte-compatible with it, so a skill maestro already stamped is picked up here unedited.
//
// A "concept skill" is an ordinary `.claude/skills/<id>/SKILL.md` whose frontmatter `metadata:` map
// says it explains one of the project's core concepts, and how fresh that explanation is:
//
//   metadata:
//     type: concept-skill
//     version: "1.0"
//     last-update: <commit sha>
//
// `metadata` is the only right home for these keys. Claude Code ignores its contents by design, and
// it is one of the six fields that survive a claude.ai upload, the Skills API and
// `package_skill.py` packaging — which reject an unknown top-level key with a HARD ERROR. It must
// be read with `parseFrontmatterMetadata`, never off `parseFrontmatter`: that reader flattens the
// block, so `metadata.version` would be indistinguishable from a top-level `version`.
//
// `type: concept-skill` is the discriminator; the other two only mean anything alongside it.
//
// The version is `major.minor` and the two bumps mean different amounts of work:
//   - create writes 1.0                    — a skeleton, never deeply researched
//   - a list-wide update bumps the MINOR   — reconciled against a diff, still shallow
//   - a single-concept pass bumps MAJOR    — one concept, actually explored
// So a skill still at `x.0` has never had a deep pass.
//
// Layer 1 of code-graph: nothing here (or anything it imports) may load `node:sqlite`,
// `typescript` or `ts-morph`. `skills *` runs on any supported Node, in repos with no TypeScript.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatterMetadata } from "./frontmatter.js";
import { readSkillEntriesFromDir, skillSearchDirs } from "./fs-scan.js";

/** The `metadata:` keys. `TYPE_KEY` must equal `CONCEPT_TYPE` for a skill to count as one. */
export const TYPE_KEY = "type";
export const CONCEPT_TYPE = "concept-skill";
export const VERSION_KEY = "version";
export const LAST_UPDATE_KEY = "last-update";

/** What a create stamps on a brand-new skill and on a brand-new list. */
export const INITIAL_VERSION = "1.0";

/** A skill's referenced-file subdirectories. `agents/` is written by the single-skill flow only. */
export const SUB_CONCEPTS_DIR = "sub-concepts";
export const AGENT_NOTES_DIR = "agents";

export interface ConceptSkill {
  /** Frontmatter `name`, falling back to the directory name. */
  id: string;
  /** The skill's own directory. */
  dir: string;
  /** `<dir>/SKILL.md`. */
  skillPath: string;
  description: string;
  /** `major.minor`. `INITIAL_VERSION` when the key is missing or unparseable. */
  version: string;
  /** The commit this skill was last reconciled against; `""` when never stamped. */
  lastUpdate: string;
  /** Filenames under `sub-concepts/`, sorted. */
  subConcepts: string[];
  /** Filenames under `agents/`, sorted. */
  agentNotes: string[];
}

export type Bump = "major" | "minor" | "initial";

// ---------------------------------------------------------------------------
// Version arithmetic
// ---------------------------------------------------------------------------

/** Parse `major.minor`. Anything unparseable reads as 1.0 rather than throwing — a hand-edited or
 *  missing version must never be able to stop a scan of the whole repo. */
export function parseVersion(v: string | undefined | null): { major: number; minor: number } {
  const m = /^\s*(\d+)\.(\d+)\s*$/.exec(v ?? "");
  if (!m) return { major: 1, minor: 0 };
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function formatVersion(v: { major: number; minor: number }): string {
  return `${v.major}.${v.minor}`;
}

export function bumpMinor(v: string | undefined | null): string {
  const { major, minor } = parseVersion(v);
  return formatVersion({ major, minor: minor + 1 });
}

export function bumpMajor(v: string | undefined | null): string {
  const { major } = parseVersion(v);
  return formatVersion({ major: major + 1, minor: 0 });
}

/** The version a bump produces from `current`; null for an unknown bump name. */
export function nextVersion(current: string | null | undefined, bump: string | null | undefined): string | null {
  if (bump === "major") return bumpMajor(current);
  if (bump === "minor") return bumpMinor(current);
  if (bump === "initial") return INITIAL_VERSION;
  return null;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every concept skill under `root`, from EVERY `.claude/skills` in the tree — not just the root's.
 * In a monorepo a concept skill lives beside the code it explains, so a single-directory read would
 * miss most of them. Ordered by path, so two runs over an unchanged tree report the same list.
 */
export async function discoverConceptSkills(root: string): Promise<ConceptSkill[]> {
  const out: ConceptSkill[] = [];
  for (const skillsDir of skillSearchDirs(root)) {
    for (const entry of await readSkillEntriesFromDir(skillsDir)) {
      if (entry.metadata[TYPE_KEY] !== CONCEPT_TYPE) continue;
      out.push({
        id: entry.id,
        dir: entry.dir,
        skillPath: entry.skillPath,
        description: entry.frontmatter.description ?? "",
        version: formatVersion(parseVersion(entry.metadata[VERSION_KEY])),
        lastUpdate: entry.metadata[LAST_UPDATE_KEY] ?? "",
        subConcepts: listDir(join(entry.dir, SUB_CONCEPTS_DIR)),
        agentNotes: listDir(join(entry.dir, AGENT_NOTES_DIR)),
      });
    }
  }
  return out.sort((a, b) => a.skillPath.localeCompare(b.skillPath));
}

/** Find one concept skill by id or by directory path. Null when it isn't one (or isn't there). */
export async function findConceptSkill(root: string, idOrPath: string): Promise<ConceptSkill | null> {
  const target = resolve(root, idOrPath);
  const all = await discoverConceptSkills(root);
  return all.find((s) => s.id === idOrPath || s.dir === target || s.skillPath === target) ?? null;
}

/**
 * The `SKILL.md` of ANY skill in the tree — marked or not — by id, directory or file path.
 *
 * `findConceptSkill` only sees skills that already carry the marker, which makes it useless for the
 * create flow's commonest call: stamping a skill written thirty seconds ago that is not a concept
 * skill *yet*. Resolving the id as a relative path instead is wrong — it silently produces
 * `<root>/<id>`, a file that was never going to be there. Null when nothing matches.
 */
export async function resolveSkillPath(root: string, idOrPath: string): Promise<string | null> {
  const target = resolve(root, idOrPath);
  if (existsSync(target)) {
    const asDir = join(target, "SKILL.md");
    if (existsSync(asDir)) return asDir;
    if (statSync(target).isFile()) return target;
  }
  for (const skillsDir of skillSearchDirs(root)) {
    // Directory name first — it is what the create flow just wrote — then the frontmatter `name`,
    // which is what a user reading `list` output will type.
    const byDir = join(skillsDir, idOrPath, "SKILL.md");
    if (existsSync(byDir)) return byDir;
    const match = (await readSkillEntriesFromDir(skillsDir)).find((e) => e.id === idOrPath);
    if (match) return match.skillPath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stamping a skill
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^(---\s*\r?\n)([\s\S]*?)(\r?\n---)/;

const DEFAULT_INDENT = "  ";

/** Where the `metadata:` map is in a frontmatter line list, and how its children are indented. */
function locateMetadata(lines: string[]): { start: number; end: number; indent: string } | null {
  const start = lines.findIndex((l) => /^metadata\s*:/.test(l));
  if (start === -1) return null;
  // An inline flow map (`metadata: { ... }`) or a scalar has no block to edit line-by-line; the
  // caller rewrites the whole map instead of trying to patch one key inside a single line.
  if (lines[start].slice(lines[start].indexOf(":") + 1).trim()) return null;

  let end = start + 1;
  let indent = DEFAULT_INDENT;
  let seen = false;
  for (; end < lines.length; end++) {
    if (!lines[end].trim()) continue;
    if (!/^\s/.test(lines[end])) break;
    if (!seen) {
      indent = /^(\s+)/.exec(lines[end])![1];
      seen = true;
    }
  }
  return { start, end, indent };
}

function setIn(lines: string[], indent: string, key: string, value: string): string[] {
  const rendered = `${indent}${key}: ${value}`;
  const idx = lines.findIndex((l) => l.includes(":") && l.slice(0, l.indexOf(":")).trim() === key);
  if (idx === -1) return [...lines, rendered];
  const next = [...lines];
  next[idx] = rendered;
  return next;
}

/**
 * Rewrite a SKILL.md's `metadata:` markers IN PLACE, creating the block when it has none.
 *
 * A line rewrite, never a re-serialize: every other frontmatter line, and the entire body, come out
 * byte-identical, and a re-stamp with the same values rewrites the file to the same bytes. An
 * existing `metadata:` map keeps its own indentation and any keys that are not ours. A map written
 * inline (`metadata: { ... }`) is rewritten as a block, carrying its keys over — the one case where
 * a line is not preserved.
 *
 * Returns whether it wrote: a stamp that would produce the same bytes leaves the file untouched.
 *
 * Throws when the file has no frontmatter block — a SKILL.md without one is not a skill, and
 * silently prepending one would hide a wrong path.
 */
export function stampConceptSkill(skillPath: string, next: { version: string; lastUpdate: string }): boolean {
  const raw = readFileSync(skillPath, "utf8");
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) throw new Error(`no frontmatter block in ${skillPath}`);

  // Rebuild with the file's own line ending: a CRLF checkout must stay CRLF, and a re-stamp with
  // identical values must reproduce the input byte for byte so it is skipped below.
  const eol = match[1].endsWith("\r\n") ? "\r\n" : "\n";
  const lines = match[2].split(/\r?\n/);
  const found = locateMetadata(lines);

  let rebuiltLines: string[];
  if (found) {
    let body = lines.slice(found.start + 1, found.end);
    body = setIn(body, found.indent, TYPE_KEY, CONCEPT_TYPE);
    body = setIn(body, found.indent, VERSION_KEY, `"${next.version}"`);
    body = setIn(body, found.indent, LAST_UPDATE_KEY, next.lastUpdate);
    rebuiltLines = [...lines.slice(0, found.start + 1), ...body, ...lines.slice(found.end)];
  } else {
    // No block, or one written inline/as a scalar: drop any such line and append a fresh block,
    // carrying over whatever the inline form held so nothing the user wrote is lost.
    const carried = parseFrontmatterMetadata(raw);
    const kept = lines.filter((l) => !/^metadata\s*:/.test(l));
    const merged: Record<string, string> = {
      ...carried,
      [TYPE_KEY]: CONCEPT_TYPE,
      [VERSION_KEY]: `"${next.version}"`,
      [LAST_UPDATE_KEY]: next.lastUpdate,
    };
    rebuiltLines = [...kept, "metadata:", ...Object.entries(merged).map(([k, v]) => `${DEFAULT_INDENT}${k}: ${v}`)];
  }

  const rebuilt = `${match[1]}${rebuiltLines.join(eol)}${match[3]}`;
  const out = raw.slice(0, match.index) + rebuilt + raw.slice(match.index + match[0].length);
  if (out === raw) return false;
  writeFileSync(skillPath, out);
  return true;
}
