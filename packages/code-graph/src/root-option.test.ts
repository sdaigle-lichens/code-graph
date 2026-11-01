// Config-root selection: `--root <dir>`, then $CLAUDE_PROJECT_DIR (only when a scribe.config.json is
// at or above it), then the cwd walk. Unit tests for `resolveStartDir`, plus the real CLI spawned
// from a directory that is NOT the target project (`status` echoes the project it loaded).

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStartDir } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "..");
const CLIS = [
  { name: "dist", path: path.join(PKG, "dist/cli.js") },
  { name: "bundle", path: path.resolve(PKG, "../../plugin/scripts/code-graph.cjs") },
];

let tmp: string;
let main: string;
let tree: string;
let nested: string;
let bare: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-root-")));
  const project = (dir: string, name: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "scribe.config.json"), JSON.stringify({ project: name, concepts: {} }));
  };
  main = path.join(tmp, "main");
  tree = path.join(tmp, "worktree");
  nested = path.join(tree, "src", "deep");
  bare = path.join(tmp, "bare");
  project(main, "main-project");
  project(tree, "worktree-project");
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(bare);
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("resolveStartDir", () => {
  it("--root wins over the env and the cwd", () => {
    assert.equal(resolveStartDir(tree, { CLAUDE_PROJECT_DIR: main }, main), tree);
  });

  it("resolves a relative --root against the cwd", () => {
    assert.equal(resolveStartDir("../worktree", {}, main), tree);
  });

  it("rejects a --root that is not a directory", () => {
    assert.throws(() => resolveStartDir(path.join(tmp, "nope"), {}, main), /not a directory/);
  });

  it("falls back to CLAUDE_PROJECT_DIR when a config is at or above it", () => {
    assert.equal(resolveStartDir(undefined, { CLAUDE_PROJECT_DIR: nested }, main), nested);
  });

  it("ignores a CLAUDE_PROJECT_DIR with no config above it", () => {
    assert.equal(resolveStartDir(undefined, { CLAUDE_PROJECT_DIR: bare }, main), main);
  });

  it("rejects an empty --root instead of falling back", () => {
    assert.throws(() => resolveStartDir("", { CLAUDE_PROJECT_DIR: tree }, main), /empty path/);
  });

  it("uses the cwd when neither is given", () => {
    assert.equal(resolveStartDir(undefined, {}, main), main);
  });

  // Open defect: a CLAUDE_PROJECT_DIR that no longer exists (a deleted worktree) under a configured
  // project passes the config-ancestry check, so it is returned and the preAction chdir crashes.
  it("ignores a CLAUDE_PROJECT_DIR that is missing beneath a config", () => {
    assert.equal(
      resolveStartDir(undefined, { CLAUDE_PROJECT_DIR: path.join(main, ".claude", "worktrees", "gone") }, main),
      main
    );
  });
});

for (const cli of CLIS) {
  describe(`${cli.name}: root selection from a cwd that is another project`, () => {
    before(() => assert.ok(fs.existsSync(cli.path), `${cli.path} is missing, run pnpm build first`));

    const status = (args: string[], env: Record<string, string> = {}) => {
      const e: NodeJS.ProcessEnv = { ...process.env, ...env };
      if (!("CLAUDE_PROJECT_DIR" in env)) delete e.CLAUDE_PROJECT_DIR;
      delete e.NODE_OPTIONS;
      const r = spawnSync(process.execPath, [cli.path, ...args], { encoding: "utf8", env: e, cwd: main });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };

    it("without --root or env, the cwd walk loads the cwd project", () => {
      assert.match(status(["status"]).out, /project: main-project/);
    });

    it("--root loads that dir's config (also from a nested dir)", () => {
      assert.match(status(["status", "--root", tree]).out, /project: worktree-project/);
      assert.match(status(["--root", nested, "status"]).out, /project: worktree-project/);
    });

    it("CLAUDE_PROJECT_DIR is the fallback when no --root is given", () => {
      assert.match(status(["status"], { CLAUDE_PROJECT_DIR: tree }).out, /project: worktree-project/);
    });

    it("--root beats CLAUDE_PROJECT_DIR", () => {
      const r = status(["status", "--root", main], { CLAUDE_PROJECT_DIR: tree });
      assert.match(r.out, /project: main-project/);
    });

    it("a CLAUDE_PROJECT_DIR without a config is ignored", () => {
      assert.match(status(["status"], { CLAUDE_PROJECT_DIR: bare }).out, /project: main-project/);
    });

    it("cwd and CLAUDE_PROJECT_DIR point at different configured projects: the env wins", () => {
      const r = status(["status"], { CLAUDE_PROJECT_DIR: tree });
      assert.match(r.out, /project: worktree-project/);
      assert.doesNotMatch(r.out, /main-project/);
    });

    it("relative path arguments resolve against the chosen root, not the caller's cwd (--root and env)", () => {
      // t.json exists only in the worktree; the process cwd is the main project, which has none.
      fs.writeFileSync(path.join(tree, "t.json"), "[]");
      assert.notEqual(status(["eval", "--tasks", "t.json"]).code, 0, "cwd has no t.json");
      const viaRoot = status(["eval", "--tasks", "t.json", "--root", tree]);
      assert.equal(viaRoot.code, 0, viaRoot.err);
      assert.match(viaRoot.out, /running eval from t\.json/);
      const viaEnv = status(["eval", "--tasks", "t.json"], { CLAUDE_PROJECT_DIR: tree });
      assert.equal(viaEnv.code, 0, viaEnv.err);
    });

    it("a bad --root exits 1 naming the option", () => {
      const r = status(["status", "--root", path.join(tmp, "nope")]);
      assert.equal(r.code, 1);
      assert.match(r.err, /--root .*not a directory/);
    });

    it("skills commands follow --root too", () => {
      const r = status(["skills", "list", "--json", "--root", tree], { CLAUDE_PROJECT_DIR: main });
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(r.out).count, 0);
    });

    it("skills ignores a CLAUDE_PROJECT_DIR with no config above it, as the graph commands do", () => {
      // main carries one marked concept skill; the cwd walk finds it. The env dir has no config.
      fs.mkdirSync(path.join(main, ".claude/skills/notes"), { recursive: true });
      fs.writeFileSync(
        path.join(main, ".claude/skills/notes/SKILL.md"),
        "---\nname: notes\ndescription: notes\nmetadata:\n  type: concept-skill\n  version: 1.0\n  last-update: 0000000\n---\n\n# Notes\n"
      );
      const r = status(["skills", "list", "--json"], { CLAUDE_PROJECT_DIR: bare });
      assert.equal(r.code, 0, r.err);
      assert.equal(JSON.parse(r.out).count, 1);
    });

    it("an empty --root exits 1 for graph commands and skills alike", () => {
      for (const args of [
        ["status", "--root", ""],
        ["skills", "list", "--root", ""],
      ]) {
        const r = status(args, { CLAUDE_PROJECT_DIR: tree });
        assert.equal(r.code, 1, args.join(" "));
        assert.match(r.err, /--root: empty path/);
      }
    });

    it("a CLAUDE_PROJECT_DIR missing beneath a config is ignored, not a chdir crash", () => {
      const r = status(["status"], { CLAUDE_PROJECT_DIR: path.join(main, ".claude", "worktrees", "gone") });
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /project: main-project/);
    });

    it("extract, apply, drift, enrich, search and query read and write the --root store, not the cwd's", () => {
      // A docs-only concept (no tsconfig, no TypeScript globs): no ts-morph needed, the real store path runs.
      const concept = { notes: { globs: ["docs/**/*.md"], skill: ".claude/skills/notes/SKILL.md" } };
      fs.writeFileSync(
        path.join(tree, "scribe.config.json"),
        JSON.stringify({ project: "worktree-project", concepts: concept })
      );
      fs.mkdirSync(path.join(tree, ".claude/skills/notes"), { recursive: true });
      fs.writeFileSync(path.join(tree, ".claude/skills/notes/SKILL.md"), "# Notes\n\nDocs about wtonlytoken.\n");
      fs.mkdirSync(path.join(tree, "docs"), { recursive: true });
      fs.writeFileSync(path.join(tree, "docs/a.md"), "# a\n");

      const extract = status(["extract", "notes", "--root", tree]);
      assert.equal(extract.code, 0, extract.err);
      assert.equal(status(["apply", "notes", "--root", tree]).code, 0);
      assert.equal(status(["drift", "notes", "--json", "--root", tree]).code, 0);
      assert.equal(status(["enrich", "targets", "notes", "--summary", "--json", "--root", tree]).code, 0);
      const query = status(["query", "concept", "notes", "--root", tree]);
      assert.equal(query.code, 0, query.err);
      assert.match(query.out, /Concept: notes/);
      const search = status(["search", "wtonlytoken", "--root", tree]);
      assert.equal(search.code, 0, search.err);
      assert.match(search.out, /wtonlytoken/);

      // The store went to the worktree, and the cwd project's store was never read or written.
      assert.ok(fs.existsSync(path.join(tree, "scribe-output", "graph.db")));
      assert.ok(fs.existsSync(path.join(tree, "scribe-output", "notes.ast.json")));
      assert.equal(fs.existsSync(path.join(main, "scribe-output", "notes.ast.json")), false);
      assert.equal(status(["search", "wtonlytoken"]).code, 6, "cwd project has no such skill body");
    });
  });
}
