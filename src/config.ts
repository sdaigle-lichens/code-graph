import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const ConceptSchema = z.object({
  globs: z.array(z.string()),
  skill: z.string().optional(),
});

const ConfigSchema = z.object({
  project: z.string(),
  tsconfig: z.string(),
  skillsDir: z.string().optional(),
  concepts: z.record(z.string(), ConceptSchema).optional().default({}),
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
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
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

export function tryLoadConfig(cwd: string = process.cwd()): ScribeConfig | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, "scribe.config.json");
    try {
      const raw = readFileSync(candidate, "utf-8");
      const parsed = ConfigSchema.parse(JSON.parse(raw));
      return { ...parsed, configRoot: dir };
    } catch (err) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        const parent = dirname(dir);
        if (parent === dir) return null;
        dir = parent;
        continue;
      }
      return null;
    }
  }
}
