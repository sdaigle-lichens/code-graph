// Shared fixtures for the unattended update-concept-skills tests (update-run, update-staging,
// pending-renames). Each project is a real temp git repo with a real SQLite store, built through the
// built CLI (dist/cli.js), the same recipe as scripts/e2e-update-run.mjs. Nothing here runs `claude`:
// tests inject the claude process, the spawner, the clock and (where a test says so) the git head.
// Test-only helper: tsc compiles it into dist/ like every other src module, but nothing imports it at runtime.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PKG = path.resolve(here, "../..");
export const DIST = path.join(PKG, "dist/cli.js");

/** Env the CLI runs with: the test's own environment minus the switches each test sets itself. */
export function cleanEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of [
    "CLAUDE_PROJECT_DIR",
    "NODE_OPTIONS",
    "CODE_GRAPH_UNATTENDED",
    "CODE_GRAPH_AUTO_UPDATE",
    "CODE_GRAPH_UPDATE_INTERVAL_MINUTES",
    "CODE_GRAPH_UPDATE_MODEL",
    "CODE_GRAPH_UPDATE_PLUGIN_DIR",
  ]) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}

/** A fresh temp directory (realpath, so macOS /var links do not split the spellings). */
export function makeBase(prefix = "cg-update-"): string {
  assertDist();
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function assertDist(): void {
  if (!fs.existsSync(DIST)) throw new Error(`${DIST} is missing: run \`pnpm build\` from the repository root first`);
}

export function writeRel(root: string, rel: string, text: string): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

export function readRel(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** Runs the built CLI in `cwd` (the project); never changes the test's own directory. */
export function cg(cwd: string, args: string[], env: NodeJS.ProcessEnv = cleanEnv()) {
  const r = spawnSync(process.execPath, [DIST, ...args], { cwd, encoding: "utf8", env, input: "" });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

export const ALPHA_SRC =
  "/** Sum of the line prices. */\nexport function computeTotal(prices: number[]): number {\n" +
  "  return prices.reduce((s, p) => s + p, 0);\n}\n";
export const BETA_SRC =
  "/** Upper-cases a label. */\nexport function shout(label: string): string {\n  return label.toUpperCase();\n}\n";

export const ALPHA_SKILL =
  "---\nname: alpha\ndescription: Pricing helpers (alpha concept).\n---\n\n# alpha\n\n" +
  "`src/alpha/a.ts` exports `computeTotal(prices)`, the sum of the line prices.\n";
export const BETA_SKILL =
  "---\nname: beta\ndescription: Label helpers (beta concept).\n---\n\n# beta\n\n" +
  "`src/beta/b.ts` exports `shout(label)`, which upper-cases a label.\n";

export const CONCEPTS = {
  alpha: { globs: ["src/alpha/**"], skill: ".claude/skills/alpha/SKILL.md" },
  beta: { globs: ["src/beta/**"], skill: ".claude/skills/beta/SKILL.md" },
};

/** Writes the config, tsconfig, sources, skills and .gitignore (no git, no node_modules yet). */
export function writeProjectFiles(root: string, concepts: Record<string, unknown> = CONCEPTS): void {
  writeRel(
    root,
    ".gitignore",
    [
      "node_modules",
      "scribe-output/graph.db*",
      "scribe-output/.*",
      "scribe-output/update-*",
      "scribe-output/*.enriched.json",
      "scribe-output/ambiguous-renames.json",
      "scribe-output/deleted/",
      "",
    ].join("\n")
  );
  writeRel(
    root,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2) + "\n"
  );
  writeRel(
    root,
    "scribe.config.json",
    JSON.stringify(
      { project: "update-test", tsconfig: "tsconfig.json", skillsDir: ".claude/skills", concepts },
      null,
      2
    ) + "\n"
  );
  writeRel(root, "src/alpha/a.ts", ALPHA_SRC);
  writeRel(root, "src/beta/b.ts", BETA_SRC);
  writeRel(root, ".claude/skills/alpha/SKILL.md", ALPHA_SKILL);
  writeRel(root, ".claude/skills/beta/SKILL.md", BETA_SKILL);
  // ts-morph resolves from the project's node_modules: borrow this package's.
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(root, "node_modules"), "dir");
}

/** Initialises the git repo (identity set locally) and commits everything. */
export function gitInitCommit(root: string, message: string): void {
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

/**
 * The e2e recipe: alpha and beta stamped 1.0 and applied (store built), then one more alpha commit so
 * alpha is one commit behind its stamp. Returns the project root. Leaves a clean tree.
 */
export function buildBehindProject(base: string, concepts: Record<string, unknown> = CONCEPTS): string {
  const root = path.join(base, "repo");
  fs.mkdirSync(root, { recursive: true });
  writeProjectFiles(root, concepts);
  gitInitCommit(root, "initial: alpha and beta");
  const names = Object.keys(concepts);
  mustCg(root, ["skills", "stamp", ...names, "--bump", "initial"]);
  mustCg(root, ["skills", "stamp", "--bump", "initial"]);
  mustCg(root, ["extract", ...names]);
  mustCg(root, ["apply", ...names]);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "stamp concept skills 1.0 and graph");
  writeRel(
    root,
    "src/alpha/a.ts",
    ALPHA_SRC +
      "\n/** Total after a percentage discount. */\nexport function computeDiscountedTotal(prices: number[], percent: number): number {\n  return computeTotal(prices) * (1 - percent / 100);\n}\n"
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "alpha: add computeDiscountedTotal");
  return root;
}

/** A CLI call that must succeed (fixture setup). */
export function mustCg(root: string, args: string[]): string {
  const r = cg(root, args);
  if (r.code !== 0) throw new Error(`fixture: cg ${args.join(" ")} exited ${r.code}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Vertex `_key` for a name in `<concept>.ast.json`. */
export function astKey(root: string, concept: string, name: string): string {
  const ast = JSON.parse(readRel(root, `scribe-output/${concept}.ast.json`)) as {
    vertices: { _key: string; name: string }[];
  };
  const v = ast.vertices.find((x) => x.name === name);
  if (!v) throw new Error(`fixture: no vertex ${name} in ${concept}.ast.json`);
  return v._key;
}

/** Keys of `<concept>.enriched.json` in file order (empty when absent). */
export function enrichedKeys(root: string, concept: string): string[] {
  const p = path.join(root, "scribe-output", `${concept}.enriched.json`);
  if (!fs.existsSync(p)) return [];
  return (JSON.parse(fs.readFileSync(p, "utf8")) as { vertices: { _key: string }[] }).vertices.map((v) => v._key);
}

/** The canonical JSON text of one enriched entry (for byte-identity checks), or null when absent. */
export function enrichedEntryText(root: string, concept: string, key: string): string | null {
  const p = path.join(root, "scribe-output", `${concept}.enriched.json`);
  if (!fs.existsSync(p)) return null;
  const doc = JSON.parse(fs.readFileSync(p, "utf8")) as { vertices: { _key: string }[] };
  const e = doc.vertices.find((v) => v._key === key);
  return e ? JSON.stringify(e) : null;
}

/** Enriches the named vertices of a concept through `enrich merge` (the real write path). */
export function enrich(root: string, base: string, concept: string, purposes: Record<string, string>): void {
  const partial = {
    concept,
    vertices: Object.entries(purposes).map(([name, purpose]) => ({ _key: astKey(root, concept, name), purpose })),
    edges: [],
  };
  const file = path.join(base, `partial-${concept}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(partial));
  mustCg(root, ["enrich", "merge", concept, file]);
}

export function stateOf(root: string): Record<string, unknown> | null {
  const p = path.join(root, "scribe-output", ".update-skills.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>) : null;
}

/** The fake `claude` a PATH-level test puts first: appends one line per call to `logFile`, exits `code`. */
export function fakeClaudeOnPath(base: string, logFile: string, code = 0): NodeJS.ProcessEnv {
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, "claude");
  fs.writeFileSync(script, `#!/bin/sh\necho call >> '${logFile}'\necho fake claude\nexit ${code}\n`);
  fs.chmodSync(script, 0o755);
  return { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
}

/** The staging directory a headless session writes into, from its -p prompt (`staging: <dir>;`). */
export function stagingFromPrompt(prompt: string): string {
  const m = /staging: ([^;]+);/.exec(prompt);
  if (!m) throw new Error(`no staging: in the prompt: ${prompt}`);
  return m[1] as string;
}

export function writeManifest(staging: string, concepts: { id: string; action: string; reason?: string }[]): void {
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify({ concepts }));
}

export function stageSkill(staging: string, id: string, text: string): void {
  fs.mkdirSync(path.join(staging, id), { recursive: true });
  fs.writeFileSync(path.join(staging, id, "SKILL.md"), text);
}

/** Polls `check` until it is true or `ms` pass. */
export async function waitFor(check: () => boolean, ms = 60_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}
