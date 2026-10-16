// The parts of `extract` that need no TypeScript compiler: resolving a concept's SKILL.md, deciding
// whether a concept is docs-only, and writing `<concept>.ast.json`. Kept apart from extract.ts so a
// docs-only extract never imports ts-morph (a repo with no TypeScript has none to load).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScribeConfig } from "../config.js";
import { resolveConceptSkillPath } from "../skills/concept-skills.js";
import { packageVersion } from "../version.js";
import type { Edge, Vertex } from "../schema.js";

export type SkillField = { path: string; body: string; contentHash: string };

/** A glob that ends in an explicit non-code extension (`docs/**\/*.md`). `src/**` is NOT one. */
const NON_CODE_GLOB = /\.(?:md|mdx|markdown|txt|rst|json|ya?ml|toml|html?|css)$/i;

/** A concept with no tsconfig, or whose every glob ends in an explicit non-code extension. */
export function isDocsOnly(config: ScribeConfig, conceptName: string): boolean {
  const concept = config.concepts[conceptName];
  if (!concept) return false;
  return !config.tsconfig || (concept.globs.length > 0 && concept.globs.every((g) => NON_CODE_GLOB.test(g)));
}

export function sha256hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Read the concept's SKILL.md (explicit `skill`, marker-discovered, then `skillsDir`). */
export async function readConceptSkill(config: ScribeConfig, conceptName: string): Promise<SkillField | undefined> {
  const concept = config.concepts[conceptName];
  const path = await resolveConceptSkillPath(config.configRoot, conceptName, concept?.skill, config.skillsDir);
  if (!path) return undefined;
  const body = readFileSync(join(config.configRoot, path), "utf-8");
  return { path, body, contentHash: "sha256:" + sha256hex(body) };
}

function readPrevious(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function writeAstOutput(
  config: ScribeConfig,
  conceptName: string,
  vertices: Vertex[],
  edges: Edge[],
  skill: SkillField | undefined
): void {
  const outputDir = join(config.configRoot, "scribe-output");
  mkdirSync(outputDir, { recursive: true });
  const output = {
    concept: conceptName,
    vertices,
    edges,
    ...(skill && { skill }),
    meta: { extractor_version: `code-graph@${packageVersion()}`, extracted_at: new Date().toISOString() },
  };
  const path = join(outputDir, `${conceptName}.ast.json`);
  // meta describes the last real change to the content (vertices, edges, skill), not the last run: when
  // the content is unchanged the previous meta is kept whole, extractor_version included, so a plugin
  // upgrade alone leaves the file byte-identical and safe to commit.
  const previous = readPrevious(path);
  if (
    previous &&
    typeof previous.meta?.extracted_at === "string" &&
    typeof previous.meta?.extractor_version === "string" &&
    JSON.stringify({ vertices: previous.vertices, edges: previous.edges, skill: previous.skill }) ===
      JSON.stringify({ vertices: output.vertices, edges: output.edges, skill: output.skill })
  ) {
    output.meta = { extractor_version: previous.meta.extractor_version, extracted_at: previous.meta.extracted_at };
  }
  writeFileSync(path, JSON.stringify(output, null, 2), "utf-8");
}

/** Extract a docs-only concept: zero vertices, the skill block only. */
export async function extractDocsOnly(config: ScribeConfig, conceptName: string): Promise<void> {
  const skill = await readConceptSkill(config, conceptName);
  if (!skill) {
    console.error(
      `error: docs-only concept "${conceptName}" has no SKILL.md (set concepts.${conceptName}.skill, mark a ` +
        `concept skill named "${conceptName}", or add <skillsDir>/${conceptName}/SKILL.md)`
    );
    process.exit(1);
  }
  writeAstOutput(config, conceptName, [], [], skill);
  process.stderr.write(`0 vertices, 0 edges, skill body ${skill.body.length} chars (docs-only)\n`);
}
