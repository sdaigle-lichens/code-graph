// The repo-level concept-skill state, and where a `skills` command finds its project.
//
// Two things make up the state:
//   - `version` / `last_update`: the freshness record of the list. Present only once a list has
//     been created; a list-wide update diffs forward from `last_update` instead of re-reading
//     everything.
//   - `agents`: the agent names the single-skill flow may write `agents/<agent>.md` notes for.
//
// It lives in a `skills` block of `scribe.config.json`:
//
//   { "project": "…", "concepts": { … }, "skills": { "version": "1.2", "last_update": "<sha>", "agents": [] } }
//
// maestro's concept-skills plugin kept it in its own `.claude/concept-skills.json`. That file is
// still READ as a fallback, field by field: a key the block does not carry is taken from the legacy
// file, so a repo that was never migrated reports the same state it always did. It is never written
// or deleted here — the first write of the block seeds it from the legacy file instead, which is
// the migration.
//
// The config is read as raw JSON, not through `ConfigSchema`: a repo with concept skills and no
// graph (Terraform, say) has no `tsconfig` and maybe no `concepts`, and its state must still read.
// Committed, not ignored: `last_update` is a statement about the repo's history.
//
// Layer 1: nothing here may load `node:sqlite`, `typescript` or `ts-morph`.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export const CONFIG_FILE = "scribe.config.json";

/** The freshness record of a repo's concept-skill list. `version` is `major.minor`. */
export interface ConceptSkillsState {
  version: string;
  /** The commit the list was last reconciled against. */
  last_update: string;
}

/** Where a piece of state was read from. */
export type StateSource = "scribe.config.json" | ".claude/concept-skills.json";

/** A concept as the skills layer sees it: its globs and, when declared, its SKILL.md path. */
export interface SkillsConcept {
  globs: string[];
  skill?: string;
}

// ---------------------------------------------------------------------------
// The project
// ---------------------------------------------------------------------------

/** The directory holding the nearest `scribe.config.json` at or above `dir`, or null. */
export function findConfigRoot(dir: string): string | null {
  let cur = resolve(dir);
  while (true) {
    if (existsSync(join(cur, CONFIG_FILE))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/**
 * The project a `skills` command acts on, resolved ONCE and passed down.
 *
 * The starting directory is `--root`, then `$CLAUDE_PROJECT_DIR` (what a hook or session sets),
 * then the cwd. When a `scribe.config.json` sits at or above it, that config's directory is the
 * project — the same ancestry walk every graph command does — otherwise the starting directory is.
 */
export function resolveProjectRoot(root?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const start = resolve(root || env.CLAUDE_PROJECT_DIR || process.cwd());
  return findConfigRoot(start) ?? start;
}

export function configPath(projectRoot: string): string {
  return join(projectRoot, CONFIG_FILE);
}

/** `<root>/.claude/concept-skills.json` — maestro's legacy state file. */
export function legacyStatePath(projectRoot: string): string {
  return join(projectRoot, ".claude", "concept-skills.json");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A JSON file as a plain object; `{}` when missing, unreadable, or not an object. */
function readJsonObject(p: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf8"));
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The raw `scribe.config.json` of the project; `{}` when there is none. */
export function readRawConfig(projectRoot: string): Record<string, unknown> {
  return readJsonObject(configPath(projectRoot));
}

/** The config's `concepts`, loosely validated: an entry without a string-array `globs` is skipped. */
export function readConcepts(projectRoot: string): Record<string, SkillsConcept> {
  const concepts = readRawConfig(projectRoot).concepts;
  if (!isObject(concepts)) return {};
  const out: Record<string, SkillsConcept> = {};
  for (const [name, value] of Object.entries(concepts)) {
    if (!isObject(value) || !Array.isArray(value.globs)) continue;
    const globs = value.globs.filter((g): g is string => typeof g === "string");
    out[name] = typeof value.skill === "string" ? { globs, skill: value.skill } : { globs };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the state
// ---------------------------------------------------------------------------

/** The `skills` block of the config, or null when the config has none. */
function readBlock(projectRoot: string): Record<string, unknown> | null {
  const block = readRawConfig(projectRoot).skills;
  return isObject(block) ? block : null;
}

/**
 * The recorded freshness state and where it came from, or null when no list has been created yet.
 *
 * The block wins when it carries both fields; otherwise the legacy file is consulted. A missing,
 * malformed or half-written source reads as "no list recorded" — the answer the create flow acts on.
 */
export function readConceptSkillsState(projectRoot: string): (ConceptSkillsState & { source: StateSource }) | null {
  const block = readBlock(projectRoot);
  if (block && typeof block.version === "string" && typeof block.last_update === "string") {
    return { version: block.version, last_update: block.last_update, source: "scribe.config.json" };
  }
  const legacy = readJsonObject(legacyStatePath(projectRoot));
  if (typeof legacy.version === "string" && typeof legacy.last_update === "string") {
    return { version: legacy.version, last_update: legacy.last_update, source: ".claude/concept-skills.json" };
  }
  return null;
}

function cleanNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The `agents` list — the block's when it has the key, else the legacy file's — or `[]`.
 * An empty answer means "write no agent notes", exactly right for a project that recorded none.
 */
export function readAgentsList(projectRoot: string): string[] {
  const block = readBlock(projectRoot);
  if (block && "agents" in block) return cleanNames(block.agents);
  return cleanNames(readJsonObject(legacyStatePath(projectRoot)).agents);
}

// ---------------------------------------------------------------------------
// Writing the block
// ---------------------------------------------------------------------------

/**
 * Merge `patch` into the config's `skills` block and write the config, only when its serialised
 * form would change. Returns whether it wrote.
 *
 * Every other key of the config is kept, in its order. A block written for the first time is
 * seeded from the legacy `.claude/concept-skills.json`, so its `agents` survive the move.
 *
 * Refuses (throws) when the config exists but is not a JSON object: overwriting a config the user
 * is mid-way through editing would lose it. A project with no config gets one holding its name and
 * the block — the graph keys are `code-graph init`'s business.
 */
function writeBlock(projectRoot: string, patch: Record<string, unknown>): boolean {
  const p = configPath(projectRoot);
  let before: string | null = null;
  let config: Record<string, unknown>;
  try {
    before = readFileSync(p, "utf8");
  } catch {
    // Missing: create it below.
  }
  if (before === null) {
    config = { project: basename(projectRoot) };
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(before);
    } catch (err) {
      throw new Error(`${p} is not valid JSON (${(err as Error).message}); refusing to overwrite it`);
    }
    if (!isObject(parsed)) throw new Error(`${p} is not a JSON object; refusing to overwrite it`);
    config = parsed;
  }

  const existing = isObject(config.skills) ? config.skills : null;
  const seed: Record<string, unknown> = {};
  if (!existing) {
    const legacy = readJsonObject(legacyStatePath(projectRoot));
    for (const key of ["version", "last_update", "agents"]) if (key in legacy) seed[key] = legacy[key];
  }
  config.skills = { ...seed, ...(existing ?? {}), ...patch };

  const text = JSON.stringify(config, null, 2) + "\n";
  if (text === before) return false;
  writeFileSync(p, text);
  return true;
}

/**
 * Write the freshness state into the block. Returns false and writes nothing only when the value
 * is already what it would write, so a re-stamp of an unchanged list shows no diff.
 */
export function writeConceptSkillsState(projectRoot: string, next: ConceptSkillsState): boolean {
  return writeBlock(projectRoot, { version: next.version, last_update: next.last_update });
}

/** Replace the block's `agents` list (de-duplicated, trimmed, first-seen order). Returns whether it wrote. */
export function writeAgentsList(projectRoot: string, agents: string[]): boolean {
  return writeBlock(projectRoot, { agents: cleanNames(agents) });
}

/**
 * The agents this project has, for seeding or re-checking the `agents` list: every
 * `.claude/agents/<name>.md` and `.claude/agents/<name>/AGENTS.md` at the root, plus the
 * `agents_available` of `.claude/maestro.json` when one exists. Sorted; read-only; never throws.
 */
export function discoverProjectAgents(projectRoot: string): string[] {
  const names = new Set<string>();
  const agentsDir = join(projectRoot, ".claude", "agents");
  try {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) names.add(entry.name.slice(0, -3));
      else if (entry.isDirectory() && existsSync(join(agentsDir, entry.name, "AGENTS.md"))) names.add(entry.name);
    }
  } catch {
    // No agents directory.
  }
  const maestro = readJsonObject(join(projectRoot, ".claude", "maestro.json"));
  for (const name of cleanNames(maestro.agents_available)) names.add(name);
  return Array.from(names).sort();
}
