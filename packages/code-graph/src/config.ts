import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { chooseStartDir } from "./skills/state.js";

const ConceptSchema = z.object({
  globs: z.array(z.string()),
  skill: z.string().optional(),
});

const ConfigSchema = z.object({
  project: z.string(),
  /** Optional: a config with only docs-only concepts (no TypeScript) has none. */
  tsconfig: z.string().optional(),
  skillsDir: z.string().optional(),
  /** Graph store location, relative to configRoot. Defaults to scribe-output/graph.db. */
  dbPath: z.string().optional(),
  concepts: z.record(z.string(), ConceptSchema).optional().default({}),
  /**
   * The concept-skill list's repo-level state (`version`, `last_update`, `agents`). Owned and
   * validated by `skills/state.ts`, which reads it as raw JSON; kept loose here so a hand-edited
   * block can never stop a graph command from loading the config.
   */
  skills: z.record(z.string(), z.unknown()).optional(),
});

export type ScribeConfig = z.infer<typeof ConfigSchema> & {
  configRoot: string;
};

export function loadConfig(cwd: string = process.cwd()): ScribeConfig {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, "scribe.config.json");
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = ConfigSchema.parse(JSON.parse(raw));
      return { ...parsed, configRoot: dir };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
        continue;
      }
      throw err;
    }
  }
  console.error("error: no scribe.config.json found in CWD ancestry");
  process.exit(5);
}

/**
 * The directory every graph command starts its config walk from, chosen once before the action runs.
 * One rule shared with `skills` (`chooseStartDir`, skills/state.ts): `--root <dir>` (empty or not an
 * existing directory throws), then an existing `$CLAUDE_PROJECT_DIR` with a scribe.config.json at or
 * above it (a stale, deleted or foreign value is ignored), then `cwd`.
 */
export function resolveStartDir(
  root: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string {
  return chooseStartDir(root, env, cwd);
}

export function tryLoadConfig(cwd: string = process.cwd()): ScribeConfig | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, "scribe.config.json");
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = ConfigSchema.parse(JSON.parse(raw));
      return { ...parsed, configRoot: dir };
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
        continue;
      }
      return null;
    }
  }
}
