// Finding skills on disk: every `.claude/skills` in a project tree, and the skills inside one.
//
// Ported from maestro (`packages/concept-skills/src/fs-scan.ts` and `readSkillEntriesFromDir` in
// `@repo/claude-fs`) and kept deliberately identical in behaviour — same ignore list, same depth
// cap, root first then depth-first, same readdir order. Concept skills live beside the code they
// explain, and maestro's app walks the same tree for its skill pickers; a walk that skipped a
// different set of directories would make the two disagree about which skills exist.

import { readdirSync, statSync, type Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, parseFrontmatterMetadata } from "./frontmatter.js";

export const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", ".output"];
export const MAX_DEPTH = 4;

/** Every directory under `root` (excluding `root`), depth-first, in readdir order. `.claude` is skipped. */
function* walkDirs(root: string): Generator<string> {
  function* rec(dir: string, depth: number): Generator<string> {
    if (depth > MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE_DIRS.includes(entry.name) || entry.name === ".claude") continue;
      const absolute = join(dir, entry.name);
      yield absolute;
      yield* rec(absolute, depth + 1);
    }
  }
  yield* rec(root, 0);
}

/** `<dir>/.claude/skills`, or null when there is no such directory. */
function skillsDirIn(dir: string): string | null {
  const skillsDir = join(dir, ".claude", "skills");
  try {
    return statSync(skillsDir).isDirectory() ? skillsDir : null;
  } catch {
    return null;
  }
}

/** Every `.claude/skills` directory in the tree: the root's, then each walked subdirectory's. */
export function skillSearchDirs(root: string): string[] {
  return [root, ...walkDirs(root)].map(skillsDirIn).filter((d): d is string => d !== null);
}

/** A skill read with its location and its full frontmatter. */
export interface SkillEntry {
  /** The frontmatter `name`, falling back to the directory name. */
  id: string;
  /** The skill's own directory — `<dir>/<entry>`. */
  dir: string;
  /** `<dir>/<entry>/SKILL.md`. */
  skillPath: string;
  /** Every top-level scalar key of the frontmatter block. */
  frontmatter: Record<string, string>;
  /** The frontmatter's `metadata:` map, parsed properly rather than read off the flattened `frontmatter`. */
  metadata: Record<string, string>;
}

/** Read skill entries from a directory of `<id>/SKILL.md` subfolders, preserving path and frontmatter. */
export async function readSkillEntriesFromDir(dir: string): Promise<SkillEntry[]> {
  const entries = await readdir(dir).catch(() => null);
  if (entries === null) return [];
  const out: SkillEntry[] = [];
  for (const entry of entries) {
    const skillDir = join(dir, entry);
    const skillPath = join(skillDir, "SKILL.md");
    const md = await readFile(skillPath, "utf-8").catch(() => null);
    if (md === null) continue;
    const frontmatter = parseFrontmatter(md);
    const metadata = parseFrontmatterMetadata(md);
    out.push({ id: frontmatter.name || entry, dir: skillDir, skillPath, frontmatter, metadata });
  }
  return out;
}
