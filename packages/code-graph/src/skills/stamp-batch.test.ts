// `skills stamp a b c`: several skills in one call. Spawns the built CLI (dist) and the committed
// bundle against temp git repos; a blocked write is a real read-only SKILL.md (chmod 0444 -> EACCES).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const REPO = path.resolve(PKG, "../..");
const CLIS = [
  { name: "dist", path: path.join(PKG, "dist/cli.js") },
  { name: "bundle", path: path.join(REPO, "plugin/scripts/code-graph.cjs") },
];

let tmp: string;
let sha: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-stamp-batch-"));
});
afterEach(() => {
  // Restore write bits so the temp tree can be removed.
  for (const n of ["a", "b", "c"]) {
    const p = skillPath(n);
    if (fs.existsSync(p)) fs.chmodSync(p, 0o644);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cli: string, args: string[]): Run {
  assert.ok(fs.existsSync(cli), `${cli} is missing — run \`pnpm build\` from the repository root first`);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", tmp, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
}

const skillPath = (n: string) => path.join(tmp, ".claude/skills", n, "SKILL.md");
const read = (n: string) => fs.readFileSync(skillPath(n), "utf8");
const unmarked = (n: string) => `---\nname: ${n}\ndescription: "x"\n---\n\n# ${n}\n`;
const marked = (n: string, v: string, at: string) =>
  `---\nname: ${n}\ndescription: "x"\nmetadata:\n  type: concept-skill\n  version: "${v}"\n  last-update: ${at}\n---\n\n# ${n}\n`;

/** A git repo with three skills a, b, c (unmarked by default) and their concepts. */
function setup(content: (n: string) => string = unmarked) {
  git("init", "-q");
  write(
    "scribe.config.json",
    JSON.stringify({
      project: "p",
      concepts: { a: { globs: ["src/a/**"] }, b: { globs: ["src/b/**"] }, c: { globs: ["src/c/**"] } },
    })
  );
  for (const n of ["a", "b", "c"]) write(`src/${n}/x.ts`, "1");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  sha = git("rev-parse", "HEAD");
  for (const n of ["a", "b", "c"]) write(`.claude/skills/${n}/SKILL.md`, content(n));
}

const initialLines = () => ["metadata:", "  type: concept-skill", `  version: "1.0"`, `  last-update: ${sha}`];
const stampArgs = (...extra: string[]) => ["skills", "stamp", ...extra, "--sha", sha, "--root", tmp];

for (const cli of CLIS) {
  describe(`skills stamp batch (${cli.name})`, () => {
    it("stamps every skill in one call (text and --json), exit 0", () => {
      setup();
      const r = run(cli.path, stampArgs("a", "b", "c"));
      assert.equal(r.code, 0, r.stderr);
      for (const n of ["a", "b", "c"]) {
        assert.match(read(n), new RegExp(`version: "1\\.0"\\n  last-update: ${sha}`), n);
        assert.ok(r.stdout.includes(`stamped ${skillPath(n)}  v1.0  written`), r.stdout);
      }

      // Same values again, as --json: nothing to write, every skill listed as unchanged.
      const again = run(cli.path, stampArgs("a", "b", "c", "--bump", "initial", "--json"));
      assert.equal(again.code, 0, again.stderr);
      const body = JSON.parse(again.stdout);
      assert.deepEqual(body.blocked, []);
      assert.deepEqual(body.failed, []);
      assert.deepEqual(
        body.stamped.map((s: any) => [s.path, s.version, s.lastUpdate, s.written]),
        ["a", "b", "c"].map((n) => [skillPath(n), "1.0", sha, false])
      );
    });

    it("--bump applies to every marked skill from its own version", () => {
      setup((n) => marked(n, n === "b" ? "2.3" : "1.0", "0000000"));
      const r = run(cli.path, stampArgs("a", "b", "--bump", "minor", "--reviewed", "--json"));
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(
        JSON.parse(r.stdout).stamped.map((s: any) => s.version),
        ["1.1", "2.4"]
      );
      assert.match(read("b"), /version: "2\.4"/);
      assert.match(read("c"), /version: "1\.0"/, "c not named, untouched");
    });

    it("the same skill named twice (id and directory) is stamped once", () => {
      setup();
      const r = run(cli.path, stampArgs("a", ".claude/skills/a", "b", "--json"));
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(
        JSON.parse(r.stdout).stamped.map((s: any) => s.path),
        [skillPath("a"), skillPath("b")]
      );
    });

    describe("blocked writes", { skip: process.getuid?.() === 0 }, () => {
      it("one blocked skill does not stop the others; exit 9 with its lines (text)", () => {
        setup();
        const original = read("b");
        fs.chmodSync(skillPath("b"), 0o444);
        const r = run(cli.path, stampArgs("a", "b", "c"));
        assert.equal(r.code, 9, r.stdout + r.stderr);
        assert.equal(read("b"), original, "b untouched");
        for (const n of ["a", "c"]) assert.match(read(n), /type: concept-skill/, `${n} written past the block`);
        assert.ok(r.stdout.includes(`stamped ${skillPath("a")}  v1.0  written`));
        assert.ok(r.stdout.includes(`stamped ${skillPath("c")}  v1.0  written`));
        assert.match(r.stdout, /1 stamp\(s\) computed, not written; apply these lines by hand with Edit:/);
        assert.ok(r.stdout.includes(`not written: ${skillPath("b")}\n`));
        assert.ok(r.stdout.endsWith(initialLines().join("\n") + "\n"), r.stdout);
      });

      it("several blocked skills come back together in one --json result, exit 9", () => {
        setup();
        fs.chmodSync(skillPath("a"), 0o444);
        fs.chmodSync(skillPath("c"), 0o444);
        const r = run(cli.path, stampArgs("a", "b", "c", "--json"));
        assert.equal(r.code, 9, r.stdout + r.stderr);
        assert.equal(r.stdout.trim().split("\n").length, 1, "one JSON result");
        const body = JSON.parse(r.stdout);
        assert.deepEqual(Object.keys(body).sort(), ["blocked", "failed", "stamped"]);
        assert.deepEqual(
          body.stamped.map((s: any) => [s.path, s.written]),
          [[skillPath("b"), true]]
        );
        assert.deepEqual(body.failed, []);
        assert.deepEqual(
          body.blocked.map((b: any) => b.path),
          [skillPath("a"), skillPath("c")]
        );
        for (const b of body.blocked) {
          assert.equal(b.version, "1.0");
          assert.equal(b.lastUpdate, sha);
          assert.match(b.reason, /EACCES|EPERM|EROFS|permission/i);
          assert.match(b.heading, /metadata block/);
          assert.deepEqual(b.lines, initialLines());
        }
        assert.match(read("b"), /type: concept-skill/);

        // b is marked now, so the re-run needs an explicit --bump.
        const text = run(cli.path, stampArgs("a", "b", "c", "--bump", "initial"));
        assert.equal(text.code, 9, text.stdout + text.stderr);
        assert.match(text.stdout, /2 stamp\(s\) computed, not written/);
        assert.equal((text.stdout.match(/^not written: /gm) ?? []).length, 2);
      });

      it("the lines of a blocked marked skill are its bump, the same as a writable stamp would write", () => {
        setup((n) => marked(n, "1.2", "0000000"));
        fs.chmodSync(skillPath("a"), 0o444);
        const r = run(cli.path, stampArgs("a", "b", "--bump", "minor", "--reviewed", "--json"));
        assert.equal(r.code, 9, r.stderr);
        const body = JSON.parse(r.stdout);
        assert.deepEqual(body.blocked[0].lines, [`  version: "1.3"`, `  last-update: ${sha}`]);
        assert.match(body.blocked[0].heading, /set exactly these lines/);
        assert.match(read("b"), /version: "1\.3"\n  last-update: /);
      });
    });

    it("a target that fails to resolve stops the batch before any write: exit 1, nothing written", () => {
      setup();
      const before = ["a", "c"].map(read);
      const r = run(cli.path, stampArgs("a", "ghost", "c"));
      assert.equal(r.code, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /nothing stamped, 1 of 3 skill\(s\) failed/);
      assert.match(r.stderr, /ghost: no skill "ghost" found/);
      assert.deepEqual(["a", "c"].map(read), before, "a and c untouched");
    });

    it("a marked skill without --bump fails the whole batch: exit 1, nothing written", () => {
      setup((n) => (n === "b" ? marked(n, "1.0", "0000000") : unmarked(n)));
      const before = ["a", "b", "c"].map(read);
      const r = run(cli.path, stampArgs("a", "b", "c"));
      assert.equal(r.code, 1);
      assert.match(r.stderr, /b: stamp needs --bump/);
      assert.deepEqual(["a", "b", "c"].map(read), before);
    });

    it("--print computes every skill's lines, writes nothing, exits 0 (text and --json)", () => {
      setup();
      const before = ["a", "b", "c"].map(read);
      const text = run(cli.path, stampArgs("a", "b", "c", "--print"));
      assert.equal(text.code, 0, text.stderr);
      assert.match(text.stdout, /3 stamp\(s\) computed, not written/);
      assert.equal((text.stdout.match(/^reason: --print: write skipped$/gm) ?? []).length, 3);

      const j = run(cli.path, stampArgs("a", "b", "c", "--print", "--json"));
      assert.equal(j.code, 0, j.stderr);
      const body = JSON.parse(j.stdout);
      assert.deepEqual(body.stamped, []);
      assert.deepEqual(body.failed, []);
      assert.equal(body.blocked.length, 3);
      for (const b of body.blocked) assert.deepEqual(b.lines, initialLines());
      assert.deepEqual(["a", "b", "c"].map(read), before, "--print wrote nothing");
    });

    it("a single skill keeps the original output: one JSON object with stamped as a path", () => {
      setup();
      const r = run(cli.path, stampArgs("a"));
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), {
        stamped: skillPath("a"),
        version: "1.0",
        lastUpdate: sha,
        written: true,
      });
    });
  });
}
