// The `code-graph skills …` command surface, spawned for real — both the committed plugin bundle
// (`plugin/scripts/code-graph.cjs`, what the plugin's skills run) and the tsc build (`dist/cli.js`,
// the global dev binary). Temp projects only; nothing is stubbed.
//
// Also pinned here, because nothing else can see them:
//   - layer 1 (`skills list/check/status`) prints nothing on stderr and loads neither node:sqlite
//     nor typescript / ts-morph — checked with a `-r` probe that records module resolution and the
//     builtin load list at exit, with positive controls proving the probe can see each one;
//   - a graph command from the bundle, in a project without typescript, exits 1 with the
//     install-dependencies message;
//   - the committed bundle is what the source builds to today, and stays well under 1 MB.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const REPO = path.resolve(PKG, "../..");
const BUNDLE = path.join(REPO, "plugin/scripts/code-graph.cjs");
const DIST = path.join(PKG, "dist/cli.js");
const MAESTRO = path.join(os.homedir(), "gits/maestro");
const MAESTRO_CLI = path.join(MAESTRO, "plugins/concept-skills/scripts/concept-skills.cjs");

const CLIS = [
  { name: "bundle", path: BUNDLE },
  { name: "dist", path: DIST },
];

// Writes the probe file and returns its path. It records every specifier that resolves to
// typescript / ts-morph (require and import alike, via module.registerHooks) and whether the
// sqlite builtin was loaded, into $PROBE_OUT at exit.
function writeProbe(dir: string): string {
  const p = path.join(dir, "probe.cjs");
  fs.writeFileSync(
    p,
    `const m = require("node:module");
const seen = new Set();
const hit = (s) => /^(typescript|ts-morph)(\\/|$)/.test(s) || /[\\\\/]node_modules[\\\\/](typescript|ts-morph|@ts-morph)[\\\\/]/.test(s);
m.registerHooks({
  resolve(spec, ctx, next) {
    if (hit(spec)) seen.add(spec);
    const r = next(spec, ctx);
    if (r && hit(r.url)) seen.add(spec);
    return r;
  },
});
process.on("exit", () => {
  const sqlite = process.moduleLoadList.filter((x) => /sqlite/i.test(x));
  const cached = Object.keys(require.cache).filter(hit);
  require("node:fs").writeFileSync(process.env.PROBE_OUT, JSON.stringify({ sqlite, deps: [...seen], cached }));
});
`
  );
  return p;
}

let tmp: string;
let probeDir: string;
let probe: string;

before(() => {
  for (const c of CLIS) {
    assert.ok(fs.existsSync(c.path), `${c.path} is missing — run \`pnpm build\` from the repository root first`);
  }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-probe-"));
  probe = writeProbe(probeDir);
});

after(() => fs.rmSync(probeDir, { recursive: true, force: true }));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-skills-cli-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cli: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string; preload?: string[] } = {}
): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  // The real session sets it; a stray value would redirect every command without --root.
  if (!opts.env || !("CLAUDE_PROJECT_DIR" in opts.env)) delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const res = spawnSync(process.execPath, [...(opts.preload ?? []), cli, ...args], {
    encoding: "utf8",
    env,
    cwd: opts.cwd ?? tmp,
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

const json = (r: Run) => JSON.parse(r.stdout);

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function marked(name: string, version = "1.0", lastUpdate = "abc123"): string {
  return `---\nname: ${name}\ndescription: "x"\nmetadata:\n  type: concept-skill\n  version: "${version}"\n  last-update: ${lastUpdate}\n---\n\n# Body\n`;
}

const unmarked = (name: string) => `---\nname: ${name}\ndescription: "x"\n---\n\n# Body\n`;

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", tmp, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
}

const readConfig = () => JSON.parse(fs.readFileSync(path.join(tmp, "scribe.config.json"), "utf8"));
const legacyPath = () => path.join(tmp, ".claude", "concept-skills.json");

for (const cli of CLIS) {
  describe(`skills CLI (${cli.name})`, () => {
    it("list --json finds nested concept skills and ignores unmarked ones", () => {
      write("apps/web/.claude/skills/auth-flow/SKILL.md", marked("auth-flow", "1.3"));
      write("apps/web/.claude/skills/auth-flow/sub-concepts/tokens.md", "x");
      write(".claude/skills/plain/SKILL.md", unmarked("plain"));
      const r = run(cli.path, ["skills", "list", "--json", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stderr, "");
      assert.deepEqual(json(r), {
        count: 1,
        skills: [
          {
            id: "auth-flow",
            path: path.join(tmp, "apps/web/.claude/skills/auth-flow/SKILL.md"),
            version: "1.3",
            lastUpdate: "abc123",
            subConcepts: 1,
            agentNotes: 0,
          },
        ],
      });
    });

    it("list (text) on an empty project", () => {
      const r = run(cli.path, ["skills", "list", "--root", tmp]);
      assert.equal(r.code, 0);
      assert.equal(r.stdout, "No concept skills found.\n");
    });

    it("state reads the legacy .claude/concept-skills.json when the config has no skills block", () => {
      write("scribe.config.json", JSON.stringify({ project: "p", concepts: {} }));
      write(".claude/concept-skills.json", JSON.stringify({ version: "1.4", last_update: "legacysha", agents: ["a"] }));
      const r = run(cli.path, ["skills", "state", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(json(r), {
        present: true,
        version: "1.4",
        last_update: "legacysha",
        source: ".claude/concept-skills.json",
      });
    });

    it("state is {present:false} with neither source", () => {
      assert.deepEqual(json(run(cli.path, ["skills", "state", "--root", tmp])), { present: false });
    });

    it("stamp (no skill) writes the skills block into scribe.config.json, bumped from the legacy state", () => {
      const original = { project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } };
      write("scribe.config.json", JSON.stringify(original, null, 2));
      const legacyBody = JSON.stringify({ version: "1.4", last_update: "legacysha", agents: ["backend"] });
      write(".claude/concept-skills.json", legacyBody);

      const r = run(cli.path, ["skills", "stamp", "--bump", "minor", "--sha", "newsha", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(json(r), {
        written: true,
        version: "1.5",
        last_update: "newsha",
        path: path.join(tmp, "scribe.config.json"),
      });
      assert.deepEqual(readConfig(), {
        ...original,
        skills: { version: "1.5", last_update: "newsha", agents: ["backend"] },
      });
      assert.equal(fs.readFileSync(legacyPath(), "utf8"), legacyBody, "the legacy file is never written");

      const state = json(run(cli.path, ["skills", "state", "--root", tmp]));
      assert.deepEqual(state, { present: true, version: "1.5", last_update: "newsha", source: "scribe.config.json" });

      // Same values twice: the second reports no write and leaves the config byte-identical.
      assert.equal(
        json(run(cli.path, ["skills", "stamp", "--bump", "initial", "--sha", "s2", "--root", tmp])).written,
        true
      );
      const before = fs.readFileSync(path.join(tmp, "scribe.config.json"));
      const same = run(cli.path, ["skills", "stamp", "--bump", "initial", "--sha", "s2", "--root", tmp]);
      assert.equal(json(same).written, false);
      assert.ok(fs.readFileSync(path.join(tmp, "scribe.config.json")).equals(before));
    });

    it("stamp (no skill) with no config creates one and defaults --sha to HEAD", () => {
      git("init", "-q");
      write("a.txt", "a");
      git("add", "-A");
      git("commit", "-q", "-m", "one");
      const head = git("rev-parse", "HEAD");
      const r = run(cli.path, ["skills", "stamp", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(readConfig(), { project: path.basename(tmp), skills: { version: "1.0", last_update: head } });
    });

    it("stamp refuses a malformed scribe.config.json: exit 1, file untouched", () => {
      const bad = '{ "project": "half-ed';
      write("scribe.config.json", bad);
      const r = run(cli.path, ["skills", "stamp", "--bump", "minor", "--sha", "x", "--root", tmp]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /refusing to overwrite/);
      assert.equal(fs.readFileSync(path.join(tmp, "scribe.config.json"), "utf8"), bad);
    });

    it("stamp <skill>: an unmarked skill gets the initial 1.0, a marked one needs --bump", () => {
      const p = write("apps/api/.claude/skills/job-queue/SKILL.md", unmarked("job-queue"));
      const first = run(cli.path, ["skills", "stamp", "job-queue", "--sha", "s1", "--root", tmp]);
      assert.equal(first.code, 0, first.stderr);
      assert.deepEqual(json(first), { stamped: p, version: "1.0", lastUpdate: "s1", written: true });

      const noBump = run(cli.path, ["skills", "stamp", "job-queue", "--sha", "s2", "--root", tmp]);
      assert.equal(noBump.code, 1);
      assert.match(noBump.stderr, /--bump/);

      const major = run(cli.path, ["skills", "stamp", "job-queue", "--bump", "major", "--sha", "s2", "--root", tmp]);
      assert.equal(json(major).version, "2.0");
      const list = json(run(cli.path, ["skills", "list", "--json", "--root", tmp]));
      assert.equal(list.skills[0].version, "2.0");
      assert.equal(list.skills[0].lastUpdate, "s2");

      // The same values twice, addressed by directory path: the second must not touch the file.
      const dir = "apps/api/.claude/skills/job-queue";
      assert.equal(
        json(run(cli.path, ["skills", "stamp", dir, "--bump", "initial", "--sha", "s3", "--root", tmp])).written,
        true
      );
      const bytes = fs.readFileSync(p);
      const again = run(cli.path, ["skills", "stamp", dir, "--bump", "initial", "--sha", "s3", "--root", tmp]);
      assert.equal(json(again).written, false);
      assert.ok(fs.readFileSync(p).equals(bytes));
    });

    it("stamp <skill> of something that does not exist exits 1", () => {
      const r = run(cli.path, ["skills", "stamp", "nope", "--root", tmp]);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /no skill "nope"/);
    });

    it("check --json reports missing/mismatch/unmarked/docs-only, and --strict exits 1 only when not ok", () => {
      write(
        "scribe.config.json",
        JSON.stringify({
          project: "p",
          concepts: {
            ghost: { globs: ["src/ghost/**"] },
            auth: { globs: ["src/auth/**"], skill: "docs/auth/SKILL.md" },
            plain: { globs: ["src/plain/**"], skill: ".claude/skills/plain/SKILL.md" },
          },
        })
      );
      write(".claude/skills/auth/SKILL.md", marked("auth"));
      write(".claude/skills/plain/SKILL.md", unmarked("plain"));
      write("infra/.claude/skills/tf/SKILL.md", marked("tf"));

      const r = run(cli.path, ["skills", "check", "--json", "--root", tmp]);
      assert.equal(r.code, 0);
      assert.deepEqual(json(r), {
        ok: false,
        missing: [{ concept: "ghost", declared: null }],
        mismatches: [{ concept: "auth", declared: "docs/auth/SKILL.md", found: ".claude/skills/auth/SKILL.md" }],
        unmarked: [{ concept: "plain", path: ".claude/skills/plain/SKILL.md" }],
        docsOnly: [{ id: "tf", path: "infra/.claude/skills/tf/SKILL.md" }],
      });
      assert.equal(run(cli.path, ["skills", "check", "--strict", "--root", tmp]).code, 1);

      // Docs-only skills alone are fine, even under --strict.
      write("scribe.config.json", JSON.stringify({ project: "p", concepts: {} }));
      const ok = run(cli.path, ["skills", "check", "--strict", "--root", tmp]);
      assert.equal(ok.code, 0);
      assert.match(ok.stdout, /^concept skills: ok\n/);
      assert.match(ok.stdout, /docs-only tf/);
    });

    it("status --json counts commits over the concept's globs", () => {
      git("init", "-q");
      write("scribe.config.json", JSON.stringify({ project: "p", concepts: { auth: { globs: ["src/auth/**"] } } }));
      write("src/auth/a.ts", "1");
      write("src/other.ts", "1");
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");
      write(".claude/skills/auth/SKILL.md", marked("auth", "1.2", base));
      write("src/auth/a.ts", "2");
      write("src/other.ts", "2");
      git("add", "-A");
      git("commit", "-q", "-m", "change");

      const r = run(cli.path, ["skills", "status", "--json", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stderr, "");
      const report = json(r);
      assert.equal(report.head, git("rev-parse", "HEAD"));
      assert.equal(report.list, null);
      assert.equal(report.concepts.length, 1);
      assert.equal(report.concepts[0].concept, "auth");
      assert.equal(report.concepts[0].version, "1.2");
      assert.equal(report.concepts[0].commitsSince, 1);
      assert.deepEqual(report.concepts[0].filesChanged, ["src/auth/a.ts"]);

      const text = run(cli.path, ["skills", "status", "--root", tmp]);
      assert.equal(text.code, 0);
      assert.match(text.stdout, /list: not created yet/);
      assert.match(text.stdout, /auth {2}v1\.2 {2}1 commit\(s\), 1 file\(s\)/);
    });

    it("status --summary on a 16-concept project is one short JSON line, well under 8 KB", () => {
      git("init", "-q");
      const concepts: Record<string, { globs: string[] }> = {};
      for (let i = 0; i < 16; i++) {
        const id = `feature-area-${String(i).padStart(2, "0")}`;
        concepts[id] = { globs: [`src/${id}/**`, `src/shared-${id}/**/*.ts`] };
        write(`src/${id}/a.ts`, "1");
      }
      write("scribe.config.json", JSON.stringify({ project: "p", concepts }));
      git("add", "-A");
      git("commit", "-q", "-m", "base");
      const base = git("rev-parse", "HEAD");
      for (const id of Object.keys(concepts)) write(`.claude/skills/${id}/SKILL.md`, marked(id, "1.2", base));
      for (let i = 0; i < 16; i++) write(`src/feature-area-${String(i).padStart(2, "0")}/a.ts`, "2");
      git("add", "-A");
      git("commit", "-q", "-m", "change");
      // Each concept's last extract saw a.ts with the old content, so one file is unextracted.
      const oldHash = "sha256:" + createHash("sha256").update("1").digest("hex");
      for (const id of Object.keys(concepts)) {
        write(`scribe-output/${id}.ast.json`, JSON.stringify({ meta: { files: { [`src/${id}/a.ts`]: oldHash } } }));
      }

      const r = run(cli.path, ["skills", "status", "--summary", "--root", tmp]);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stderr, "");
      assert.ok(r.stdout.length <= 8 * 1024, `summary is ${r.stdout.length} bytes`);
      assert.equal(r.stdout.trim().split("\n").length, 1, "one line");
      const s = json(r);
      assert.deepEqual(Object.keys(s).sort(), ["concepts", "head", "list"]);
      assert.equal(s.head, git("rev-parse", "HEAD").slice(0, 8));
      assert.equal(s.list, null);
      assert.equal(s.concepts.length, 16);
      assert.deepEqual(s.concepts[0], {
        id: "feature-area-00",
        v: "1.2",
        at: base.slice(0, 8),
        commits: 1,
        files: 1,
        unextracted: { changed: 1, new: 0, removed: 0 },
      });
      const full = run(cli.path, ["skills", "status", "--json", "--root", tmp]);
      assert.ok(r.stdout.length < full.stdout.length / 2, "summary is much smaller than --json");
    });

    it("agents-set / agents / agents-discover", () => {
      assert.deepEqual(json(run(cli.path, ["skills", "agents", "--root", tmp])), []);
      const set = run(cli.path, ["skills", "agents-set", "backend", "test", "--root", tmp]);
      assert.equal(set.code, 0, set.stderr);
      assert.deepEqual(json(set), { written: true, agents: ["backend", "test"] });
      assert.deepEqual(json(run(cli.path, ["skills", "agents", "--root", tmp])), ["backend", "test"]);
      assert.deepEqual(readConfig().skills.agents, ["backend", "test"]);
      assert.deepEqual(json(run(cli.path, ["skills", "agents-set", "--root", tmp, "backend", "test"])), {
        written: false,
        agents: ["backend", "test"],
      });
      assert.deepEqual(json(run(cli.path, ["skills", "agents-set", "--root", tmp])), { written: true, agents: [] });

      write(".claude/agents/zed.md", "x");
      write(".claude/maestro.json", JSON.stringify({ agents_available: ["backend"] }));
      assert.deepEqual(json(run(cli.path, ["skills", "agents-discover", "--root", tmp])), ["backend", "zed"]);
    });

    it("without --root: CLAUDE_PROJECT_DIR, then cwd's nearest scribe.config.json", () => {
      run(cli.path, ["skills", "agents-set", "viaEnv"], { env: { CLAUDE_PROJECT_DIR: tmp }, cwd: os.tmpdir() });
      assert.deepEqual(json(run(cli.path, ["skills", "agents"], { cwd: tmp })), ["viaEnv"]);

      const deep = path.join(tmp, "apps", "web");
      fs.mkdirSync(deep, { recursive: true });
      assert.deepEqual(json(run(cli.path, ["skills", "agents"], { cwd: deep })), ["viaEnv"]);
    });

    // Layer 1 must not load the store or the compiler. cwd is the code-graph package, so typescript
    // and ts-morph ARE resolvable there — a lazy-import regression would load them, not just fail.
    for (const args of [
      ["skills", "list"],
      ["skills", "list", "--json"],
      ["skills", "check"],
      ["skills", "check", "--json"],
      ["skills", "status"],
      ["skills", "status", "--json"],
    ]) {
      it(`${args.join(" ")}: empty stderr, no node:sqlite, no typescript/ts-morph`, () => {
        git("init", "-q");
        write("scribe.config.json", JSON.stringify({ project: "p", concepts: { auth: { globs: ["src/**"] } } }));
        write(".claude/skills/auth/SKILL.md", marked("auth", "1.0", "deadbeef"));
        const out = path.join(tmp, "probe.json");
        const r = run(cli.path, [...args, "--root", tmp], {
          cwd: PKG,
          env: { PROBE_OUT: out },
          preload: ["-r", probe],
        });
        assert.equal(r.code, 0, r.stderr);
        assert.equal(r.stderr, "");
        const seen = JSON.parse(fs.readFileSync(out, "utf8"));
        assert.deepEqual(seen, { sqlite: [], deps: [], cached: [] });
      });
    }
  });
}

// The probe must be able to see what the layer-1 tests assert is absent, or they prove nothing.
describe("the module-load probe (positive controls)", () => {
  for (const cli of CLIS) {
    it(`sees node:sqlite when a store command runs (${cli.name}), whose warning is still suppressed`, () => {
      write("scribe.config.json", JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: {} }));
      const out = path.join(tmp, "probe.json");
      const r = run(cli.path, ["bootstrap"], { env: { PROBE_OUT: out }, preload: ["-r", probe] });
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /ExperimentalWarning/);
      const seen = JSON.parse(fs.readFileSync(out, "utf8"));
      assert.ok(seen.sqlite.length > 0, JSON.stringify(seen));
    });
  }

  it("sees ts-morph/typescript when extract runs from dist", () => {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } })
    );
    write("tsconfig.json", "{}");
    const out = path.join(tmp, "probe.json");
    run(DIST, ["extract", "a"], { env: { PROBE_OUT: out }, preload: ["-r", probe] });
    const seen = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.ok(seen.deps.includes("ts-morph") || seen.cached.length > 0, JSON.stringify(seen));
  });

  it("sees ts-morph when extract runs from the bundle in a project that has it installed", () => {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } })
    );
    write("tsconfig.json", "{}");
    fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
    const out = path.join(tmp, "probe.json");
    const r = run(BUNDLE, ["extract", "a"], {
      env: { PROBE_OUT: out, XDG_CACHE_HOME: path.join(tmp, "empty-cache"), CLAUDE_PLUGIN_DATA: "" },
      preload: ["-r", probe],
    });
    assert.doesNotMatch(r.stderr, /could not be found/);
    const seen = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.ok(
      seen.cached.some((p: string) => p.includes("ts-morph")),
      JSON.stringify(seen)
    );
  });
});

// An empty plugin deps dir that the real ~/.cache and CLAUDE_PLUGIN_DATA cannot mask.
function isolatedDeps(): Record<string, string> {
  return { XDG_CACHE_HOME: path.join(tmp, "empty-cache"), CLAUDE_PLUGIN_DATA: "" };
}

describe("no concepts configured: graph commands skip", () => {
  for (const cli of CLIS) {
    for (const args of [
      ["extract", "a"],
      ["apply", "a"],
      ["drift", "a"],
    ]) {
      it(`${cli.name} ${args[0]} exits 0 with a skip message and loads no graph stack`, () => {
        write("scribe.config.json", JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: {} }));
        const out = path.join(tmp, "probe.json");
        const r = run(cli.path, args, { env: { PROBE_OUT: out, ...isolatedDeps() }, preload: ["-r", probe] });
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /no concepts configured in scribe\.config\.json, skipped/);
        assert.equal(r.stderr, "");
        const seen = JSON.parse(fs.readFileSync(out, "utf8"));
        assert.deepEqual(seen, { sqlite: [], deps: [], cached: [] });
      });
    }
  }

  it("a missing scribe.config.json still exits 5", () => {
    assert.equal(run(BUNDLE, ["extract", "a"]).code, 5);
  });
});

describe("dependency resolution order (bundle)", () => {
  // A fake ts-morph that announces where it came from; extract then exits, which is fine.
  function fakeDeps(root: string, marker: string): void {
    const dir = path.join(root, "node_modules", "ts-morph");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"ts-morph","version":"0.0.0","main":"index.js"}');
    fs.writeFileSync(path.join(dir, "index.js"), `console.error("LOADED:${marker}"); process.exit(77);`);
  }
  const conceptCfg = () => {
    write(
      "scribe.config.json",
      JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } })
    );
    write("tsconfig.json", "{}");
  };
  const DEPS_KEY = "ts-morph@28.0.0";

  it("CLAUDE_PLUGIN_DATA/deps wins over the cache dir and the project", () => {
    conceptCfg();
    fakeDeps(path.join(tmp, "data", "deps", DEPS_KEY), "data");
    fakeDeps(path.join(tmp, "xdg", "code-graph", "deps", DEPS_KEY), "cache");
    fakeDeps(tmp, "project");
    const r = run(BUNDLE, ["extract", "a"], {
      env: { CLAUDE_PLUGIN_DATA: path.join(tmp, "data"), XDG_CACHE_HOME: path.join(tmp, "xdg") },
    });
    assert.match(r.stderr, /LOADED:data/);
  });

  it("the cache dir wins over the project", () => {
    conceptCfg();
    fakeDeps(path.join(tmp, "xdg", "code-graph", "deps", DEPS_KEY), "cache");
    fakeDeps(tmp, "project");
    const r = run(BUNDLE, ["extract", "a"], { env: { CLAUDE_PLUGIN_DATA: "", XDG_CACHE_HOME: path.join(tmp, "xdg") } });
    assert.match(r.stderr, /LOADED:cache/);
  });

  it("does not search an old deps/<version> folder", () => {
    conceptCfg();
    fakeDeps(path.join(tmp, "xdg", "code-graph", "deps", "0.3.7"), "old");
    fakeDeps(tmp, "project");
    const r = run(BUNDLE, ["extract", "a"], { env: { CLAUDE_PLUGIN_DATA: "", XDG_CACHE_HOME: path.join(tmp, "xdg") } });
    assert.match(r.stderr, /LOADED:project/);
  });

  it("falls back to the project when the plugin dirs are empty", () => {
    conceptCfg();
    fakeDeps(tmp, "project");
    const r = run(BUNDLE, ["extract", "a"], { env: isolatedDeps() });
    assert.match(r.stderr, /LOADED:project/);
  });

  it("deps status runs without network and exits 0", () => {
    const r = run(BUNDLE, ["deps", "status"], { env: isolatedDeps() });
    assert.equal(r.code, 0, r.stderr);
  });
});

describe("code-graph-install skill", () => {
  it("instructs a .gitignore entry for the store database files", () => {
    const text = fs.readFileSync(path.join(REPO, "plugin/skills/code-graph-install/SKILL.md"), "utf8");
    assert.match(text, /\.gitignore/);
    assert.match(text, /graph\.db/);
  });
});

describe("bundle graph commands in a project without typescript", () => {
  for (const args of [
    ["extract", "a"],
    ["catalog", "--json"],
  ]) {
    it(`${args.join(" ")} exits 1 with a message naming 'deps install'`, () => {
      write(
        "scribe.config.json",
        JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { a: { globs: ["src/**"] } } })
      );
      write("tsconfig.json", "{}");
      const r = run(BUNDLE, args, { env: isolatedDeps() });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /"(ts-morph|typescript)" could not be found/);
      assert.match(r.stderr, /code-graph deps install/);
      assert.ok(r.stderr.includes(tmp), "names the project it looked in");
      assert.doesNotMatch(r.stderr, /\n\s+at /, "a message, not a stack trace");
    });
  }

  it("skills commands still work there", () => {
    write("scribe.config.json", JSON.stringify({ project: "p", concepts: {} }));
    const r = run(BUNDLE, ["skills", "list", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(json(r), { count: 0, skills: [] });
  });
});

describe("the scribe skill's default load", () => {
  const dir = path.join(REPO, "plugin/skills/scribe");

  it("SKILL.md stays at or under 9 KB, with the enrichment procedure in enrichment.md", () => {
    const size = fs.statSync(path.join(dir, "SKILL.md")).size;
    assert.ok(size <= 9 * 1024, `scribe SKILL.md is ${size} bytes (limit 9216)`);
    assert.ok(fs.existsSync(path.join(dir, "enrichment.md")), "enrichment.md is missing");
  });

  it("SKILL.md keeps the gap-channel contract and points at enrichment.md", () => {
    const body = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    assert.match(body, /\.claude\/channels\/scribe\//);
    assert.match(body, /skill_gaps/);
    assert.match(body, /enrichment\.md/);
  });
});

describe("the committed bundle", () => {
  it("carries the generated header and stays well under 1 MB", () => {
    const text = fs.readFileSync(BUNDLE, "utf8");
    assert.match(text.split("\n")[0], /^(#!.*|\/\/ GENERATED .*DO NOT EDIT\.)$/);
    assert.ok(text.slice(0, 400).includes("DO NOT EDIT"));
    const size = fs.statSync(BUNDLE).size;
    assert.ok(size < 700 * 1024, `bundle is ${(size / 1024).toFixed(0)} KiB`);
  });

  // build-plugin.mjs "fails quietly": a stale committed bundle keeps working while src/ edits stop
  // reaching the plugin. Rebuild into a temp file and require the same bytes.
  it("is exactly what the source builds to today", async () => {
    // @ts-expect-error — a plain .mjs build script with no type declarations.
    const { buildPlugin } = await import("../../scripts/build-plugin.mjs");
    const outfile = path.join(tmp, "code-graph.cjs");
    await buildPlugin(outfile);
    assert.ok(
      fs.readFileSync(outfile).equals(fs.readFileSync(BUNDLE)),
      "plugin/scripts/code-graph.cjs is stale — run `pnpm bundle` from the repository root"
    );
  });

  it("reports the package version", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    const r = run(BUNDLE, ["--version"]);
    assert.equal(r.stdout.trim(), pkg.version);
  });
});

// Acceptance: the port reads maestro's real stamped skills exactly as maestro's own CLI does.
// Both CLIs only read, so maestro's checkout is not modified. Skipped where it is not present.
describe(
  "parity with maestro's concept-skills.cjs",
  { skip: !fs.existsSync(MAESTRO_CLI) && "~/gits/maestro not present" },
  () => {
    it("skills list --json matches `concept-skills.cjs list --json` id for id and version for version", () => {
      const ours = run(BUNDLE, ["skills", "list", "--json", "--root", MAESTRO], { cwd: MAESTRO });
      const theirs = run(MAESTRO_CLI, ["list", "--json", "--root", MAESTRO], { cwd: MAESTRO });
      assert.equal(ours.code, 0, ours.stderr);
      assert.equal(theirs.code, 0, theirs.stderr);
      const a = json(ours);
      const b = json(theirs);
      assert.ok(a.count > 0);
      assert.deepEqual(
        a.skills.map((s: { id: string; version: string }) => [s.id, s.version]),
        b.skills.map((s: { id: string; version: string }) => [s.id, s.version])
      );
      assert.deepEqual(a, b);
    });
  }
);
