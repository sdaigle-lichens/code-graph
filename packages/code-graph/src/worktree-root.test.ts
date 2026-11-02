// `--root <dir>` and the $CLAUDE_PROJECT_DIR fallback against a real linked git worktree. A temp main
// checkout is committed with a scribe.config.json; `git worktree add` makes a second checkout on its own
// branch whose config declares one more concept. The built CLI (dist/cli.js) is spawned from the MAIN
// checkout's cwd and pointed at the worktree, so the cwd-based default would read the wrong config.
// Git and the CLI are spawned as child processes, the way the other CLI tests do. Nothing is stubbed.
// The worktree is removed and `git worktree list` is checked in the after hook.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const CLI = path.join(PKG, "dist/cli.js");
const WT_BRANCH = "task-063-worktree-root";

const ALPHA = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const BETA = "export function beta(x: number): number {\n  return x * 2;\n}\n";
const SKILL_UNMARKED = '---\nname: c\ndescription: "x"\n---\n\n# c\n';

let base: string;
let main: string;
let wt: string;
let sha: string;

function write(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** The CLI spawned from `cwd`, with CLAUDE_PROJECT_DIR taken from `env` only (never inherited). */
function cli(cwd: string, args: string[], env: Record<string, string> = {}) {
  const e: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete e.NODE_OPTIONS;
  if (!("CLAUDE_PROJECT_DIR" in env)) delete e.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: e, cwd });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** Every file under `dir` (except .git) mapped to its sha256; the snapshot diff is what a command wrote. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        files.set(path.relative(dir, p), createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
      }
    }
  };
  walk(dir);
  return files;
}

/** Relative paths that were added, removed or changed between two snapshots. */
function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((n) => before.get(n) !== after.get(n)).sort();
}

const conceptIds = (json: string): string[] =>
  (JSON.parse(json).concepts as { concept?: string }[]).map((c) => c.concept ?? "").sort();

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-worktree-root-")));
  main = path.join(base, "main");
  wt = path.join(base, "wt");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  write(
    main,
    "scribe.config.json",
    JSON.stringify({ project: "main", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/main/**/*.ts"] } } })
  );
  write(
    main,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write(main, "src/main/a.ts", ALPHA);
  write(main, ".claude/skills/c/SKILL.md", SKILL_UNMARKED);
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "main base");

  git(main, "worktree", "add", "-q", "-b", WT_BRANCH, wt);
  // The worktree's own branch: its config adds a concept the main checkout does not have.
  write(
    wt,
    "scribe.config.json",
    JSON.stringify({
      project: "wt",
      tsconfig: "tsconfig.json",
      concepts: { c: { globs: ["src/main/**/*.ts"] }, "wt-only": { globs: ["src/wt/**/*.ts"] } },
    })
  );
  write(wt, "src/wt/w.ts", BETA);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "worktree config");
  sha = git(wt, "rev-parse", "HEAD");
});

afterEach(() => {
  try {
    if (fs.existsSync(wt)) git(main, "worktree", "remove", "--force", wt);
    const worktrees = git(main, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree "));
    assert.deepEqual(worktrees, [`worktree ${main}`], "only the main checkout is left");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

describe("--root <worktree> from the main checkout (read command)", () => {
  it("skills status and drift read the worktree's config and write only under its scribe-output", () => {
    const ext = cli(main, ["--root", wt, "extract", "--all"]);
    assert.equal(ext.code, 0, ext.stdout + ext.stderr);
    const ap = cli(main, ["--root", wt, "apply", "--all"]);
    assert.equal(ap.code, 0, ap.stdout + ap.stderr);

    const mainBefore = snapshot(main);
    const wtBefore = snapshot(wt);

    const status = cli(main, ["--root", wt, "skills", "status", "--json"]);
    assert.equal(status.code, 0, status.stderr);
    assert.deepEqual(conceptIds(status.stdout), ["c", "wt-only"], "the worktree's config is the one read");

    const drift = cli(main, ["--root", wt, "drift", "wt-only", "--json"]);
    assert.equal(drift.code, 0, drift.stdout + drift.stderr);
    assert.equal(JSON.parse(drift.stdout.trim()).concept, "wt-only");

    // Control: the same command from the main checkout with no --root reads main's config.
    const control = cli(main, ["skills", "status", "--json"]);
    assert.deepEqual(conceptIds(control.stdout), ["c"]);

    assert.deepEqual(snapshot(main), mainBefore, "the main checkout is untouched");
    for (const p of changedPaths(wtBefore, snapshot(wt))) {
      assert.ok(p.startsWith("scribe-output/"), `a read wrote ${p} outside scribe-output`);
    }
  });
});

describe("--root <worktree> from the main checkout (create-mode writes)", () => {
  it("extract and skills stamp write into the worktree and never into the main checkout", () => {
    const mainBefore = snapshot(main);
    const wtBefore = snapshot(wt);

    const ext = cli(main, ["--root", wt, "extract", "wt-only"]);
    assert.equal(ext.code, 0, ext.stdout + ext.stderr);
    assert.ok(fs.existsSync(path.join(wt, "scribe-output/wt-only.ast.json")), "extract wrote the worktree's ast");

    const stamp = cli(main, ["--root", wt, "skills", "stamp", "c", "--sha", sha]);
    assert.equal(stamp.code, 0, stamp.stdout + stamp.stderr);
    assert.match(fs.readFileSync(path.join(wt, ".claude/skills/c/SKILL.md"), "utf8"), /type: concept-skill/);

    assert.deepEqual(snapshot(main), mainBefore, "nothing landed in the main checkout");
    assert.equal(fs.existsSync(path.join(main, "scribe-output")), false);
    const wtChanged = changedPaths(wtBefore, snapshot(wt));
    assert.ok(wtChanged.includes(".claude/skills/c/SKILL.md"));
    assert.ok(
      wtChanged.every((p) => p.startsWith("scribe-output/") || p === ".claude/skills/c/SKILL.md"),
      wtChanged.join(", ")
    );
  });
});

describe("$CLAUDE_PROJECT_DIR fallback (no --root)", () => {
  it("read mode uses the env dir when a config sits there, and ignores an env dir without one", () => {
    const status = cli(main, ["skills", "status", "--json"], { CLAUDE_PROJECT_DIR: wt });
    assert.equal(status.code, 0, status.stderr);
    assert.deepEqual(conceptIds(status.stdout), ["c", "wt-only"]);

    const plain = path.join(base, "plain");
    fs.mkdirSync(plain);
    const ignored = cli(main, ["skills", "status", "--json"], { CLAUDE_PROJECT_DIR: plain });
    assert.deepEqual(conceptIds(ignored.stdout), ["c"], "a dir with no scribe.config.json is not a project root");
  });

  it("a graph command writes into the env dir's scribe-output, not the cwd's", () => {
    const mainBefore = snapshot(main);
    const ext = cli(main, ["extract", "wt-only"], { CLAUDE_PROJECT_DIR: wt });
    assert.equal(ext.code, 0, ext.stdout + ext.stderr);
    assert.ok(fs.existsSync(path.join(wt, "scribe-output/wt-only.ast.json")));
    assert.deepEqual(snapshot(main), mainBefore);
  });

  it("create mode (skills stamp) lands in the env dir", () => {
    const mainBefore = snapshot(main);
    const stamp = cli(main, ["skills", "stamp", "c", "--sha", sha], { CLAUDE_PROJECT_DIR: wt });
    assert.equal(stamp.code, 0, stamp.stdout + stamp.stderr);
    assert.match(fs.readFileSync(path.join(wt, ".claude/skills/c/SKILL.md"), "utf8"), /type: concept-skill/);
    assert.deepEqual(snapshot(main), mainBefore);
  });
});
