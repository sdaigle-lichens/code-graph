// Pure edits of a scribe.config.json object, plus the input validation for them. No library import
// and no filesystem: the one module that owns those is `graph.ts`.

import path from "node:path";

export type RawConfig = Record<string, unknown>;

/** Concept names become docs keys (`<name>::skill`) and CLI arguments, so keep them boring. */
const CONCEPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateConceptName(name: unknown): string {
  if (typeof name !== "string" || !CONCEPT_NAME.test(name.trim())) {
    throw new Error("Concept name must start with a letter or digit and use only letters, digits, '.', '_' or '-'.");
  }
  return name.trim();
}

export function validateGlobs(globs: unknown): string[] {
  if (!Array.isArray(globs)) throw new Error("Globs must be a list.");
  const out = globs.map((g) => (typeof g === "string" ? g.trim() : "")).filter(Boolean);
  if (out.length === 0) throw new Error("At least one glob is required.");
  return [...new Set(out)];
}

/** A skill path is stored relative to the config root; absolute paths and `..` escapes are refused. */
export function validateSkillPath(skill: unknown): string | undefined {
  if (skill === undefined || skill === null || skill === "") return undefined;
  if (typeof skill !== "string") throw new Error("Skill path must be a string.");
  const trimmed = skill.trim();
  if (path.isAbsolute(trimmed) || trimmed.split(/[\\/]/).includes("..")) {
    throw new Error("Skill path must be relative to the project and stay inside it.");
  }
  return trimmed || undefined;
}

export function addConcept(
  raw: RawConfig,
  concept: { name: string; globs: string[]; skill?: string | undefined }
): RawConfig {
  const concepts = (raw.concepts as Record<string, unknown> | undefined) ?? {};
  if (concept.name in concepts) throw new Error(`Concept "${concept.name}" already exists in scribe.config.json.`);
  const entry: Record<string, unknown> = { globs: concept.globs };
  if (concept.skill) entry.skill = concept.skill;
  return { ...raw, concepts: { ...concepts, [concept.name]: entry } };
}

export function initialConfig(project: string, tsconfig: string): RawConfig {
  return { project, tsconfig, concepts: {} };
}

export function serializeConfig(raw: RawConfig): string {
  return JSON.stringify(raw, null, 2) + "\n";
}

/** POSIX-quote only when needed, so the common case stays copy-and-readable. */
const shellQuote = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** The exact command that populates a concept: extract, then apply, from the config root. */
export function extractCommand(configRoot: string, concept: string): string {
  const c = shellQuote(concept);
  return `cd ${shellQuote(configRoot)} && code-graph extract ${c} && code-graph apply ${c}`;
}
