// `code-graph scout` against the real CLI on a throwaway project, no model call. Requires a built dist and
// bundle (`pnpm build`), like the other CLI tests. ts-morph resolves as in ensure-store-cli.test.ts: the
// plugin deps dirs are pointed at nothing and the repo's copy is symlinked into the project. The bundle
// runs the stops that load no ts-morph, and one full plan, so a stale bundle fails here.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const BUNDLE = path.resolve(PKG, "../../plugin/scripts/code-graph.cjs");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const SKILL = path.resolve(PKG, "../../plugin/skills/refactor-scout/SKILL.md");
const AGENT = path.resolve(PKG, "../../plugin/agents/refactor-scout.md");
const TIMEOUT_MS = 120_000;

let tmp = "";
let cache = "";

function run(cli: string, root: string, args: string[]) {
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env, timeout: TIMEOUT_MS });
}

/** A two-concept project: `shared` is imported by `app`, `app` and `loop` import each other, `gen.cjs` is outside the tsconfig. */
function project(name: string, opts: { tsconfig?: boolean } = {}): string {
  const root = path.join(tmp, name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write(
    "src/shared/util.ts",
    "export function usedFn(x: number): number {\n  return x + 1;\n}\nexport const lonelyExport = 1;\n"
  );
  write(
    "src/app/main.ts",
    `import { usedFn } from "../shared/util";\nimport { loopFn } from "./loop";\nexport function mainFn(): number {\n  return usedFn(loopFn());\n}\n`
  );
  write(
    "src/app/loop.ts",
    `import { mainFn } from "./main";\nexport function loopFn(): number {\n  return typeof mainFn === "function" ? 1 : 0;\n}\n`
  );
  write("scripts/gen.cjs", "module.exports = {};\n");
  write(".claude/skills/app/SKILL.md", "# app\n\nThe app concept.\n");
  write(".claude/skills/shared/SKILL.md", "# shared\n\nThe shared concept.\n");
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" }, include: ["src/**/*.ts"] })
  );
  write(
    "scribe.config.json",
    JSON.stringify({
      project: name,
      tsconfig: "tsconfig.json",
      concepts: {
        app: { globs: ["src/app/**/*.ts"], skill: ".claude/skills/app/SKILL.md" },
        shared: { globs: ["src/shared/**/*.ts"], skill: ".claude/skills/shared/SKILL.md" },
      },
    })
  );
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(TS_MORPH, path.join(root, "node_modules", "ts-morph"), "dir");
  return root;
}

function index(root: string) {
  const built = run(DIST, root, ["extract", "--all"]);
  assert.equal(built.status, 0, built.stderr);
  const applied = run(DIST, root, ["apply", "--all", "--approve-drift"]);
  assert.equal(applied.status, 0, applied.stderr);
}

function scopeFile(root: string, lines: string[]): string {
  const file = path.join(root, "scope.txt");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

before(() => {
  for (const f of [DIST, BUNDLE, TS_MORPH]) assert.ok(fs.existsSync(f), `${f} is missing, run pnpm build first`);
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-cli-")));
  cache = path.join(tmp, "empty-cache");
  fs.mkdirSync(cache);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("scout stops", () => {
  for (const [name, cli] of [
    ["dist", DIST],
    ["bundle", BUNDLE],
  ] as const) {
    it(`${name}: no store means one stderr line, exit 12, no prompts, and no store created`, () => {
      const root = project(`no-store-${name}`);
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 12, r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1);
      assert.match(r.stderr, /no index/);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output")));
    });

    it(`${name}: a missing scope file is exit 11 and names the path`, () => {
      const root = project(`no-scope-${name}`);
      const r = run(cli, root, ["scout", "absent.txt"]);
      assert.equal(r.status, 11);
      assert.match(r.stderr, /cannot read scope file absent\.txt/);
      assert.equal(r.stderr.trim().split("\n").length, 1);
    });
  }

  it("a scope path that is a directory is exit 11", () => {
    const root = project("dir-scope");
    assert.equal(run(DIST, root, ["scout", "src"]).status, 11);
  });

  it("a store with no live vertex is no index", () => {
    const root = project("empty-store");
    assert.equal(run(DIST, root, ["bootstrap"]).status, 0);
    const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12);
    assert.match(r.stderr, /no index/);
  });

  it("no config is exit 5", () => {
    const root = path.join(tmp, "bare");
    fs.mkdirSync(root);
    assert.equal(run(DIST, root, ["scout", "scope.txt"]).status, 5);
  });

  it("no tsconfig means one stderr line, exit 12, no prompts", () => {
    const root = project("no-tsconfig");
    index(root);
    fs.rmSync(path.join(root, "tsconfig.json"));
    const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(r.status, 12, r.stderr);
    assert.match(r.stderr, /no tsconfig/);
    assert.equal(r.stderr.trim().split("\n").length, 1);
    assert.equal(r.stdout, "");
    assert.ok(!fs.existsSync(path.join(root, "scribe-output", "scout")));
  });
});

describe("scout plan", () => {
  let root = "";
  before(() => {
    root = project("planned");
    index(root);
  });

  it("writes a measured-shape prompt from the store and the catalog", () => {
    const scope = scopeFile(root, ["src/app/main.ts", "src/app/loop.ts", "src/shared/util.ts"]);
    const r = run(DIST, root, ["scout", scope, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.sessions.length, 1);
    assert.equal(plan.ignored, 0);
    const prompt = fs.readFileSync(plan.sessions[0].prompt, "utf8");
    assert.match(prompt, /<neighbourhood>\n3 files:\n- src\/app\/loop\.ts \(concept app\)/);
    assert.match(prompt, /- src\/shared\/util\.ts \(concept shared\): fan-in 1, fan-out 0, 2 exports/);
    assert.match(prompt, /src\/app\/loop\.ts <-> src\/app\/main\.ts/);
    assert.match(prompt, /`lonelyExport` in src\/shared\/util\.ts/);
    assert.doesNotMatch(prompt, /`usedFn` in/);
    assert.match(prompt, /src\/app\/main\.ts \(app\) imports src\/shared\/util\.ts \(shared\)/);
    assert.match(prompt, /### app <-> shared/);
    assert.match(prompt, /PROPOSALS: none/);
    assert.ok(prompt.indexOf("<neighbourhood>") < prompt.indexOf("<metrics-primer>"), "scope, then primer");
    assert.doesNotMatch(prompt, /maestro|decided-against/i);
  });

  it("the bundle writes the same prompt", () => {
    const scope = scopeFile(root, ["src/app/main.ts", "src/app/loop.ts", "src/shared/util.ts"]);
    const fromDist = JSON.parse(run(DIST, root, ["scout", scope, "--json"]).stdout);
    const expected = fs.readFileSync(fromDist.sessions[0].prompt, "utf8");
    const r = run(BUNDLE, root, ["scout", scope, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(JSON.parse(r.stdout).sessions[0].prompt, "utf8"), expected);
  });

  it("ignores and counts files outside the index, and names bad lines", () => {
    const scope = scopeFile(root, ["src/app/main.ts", "scripts/gen.cjs", "tsconfig.json", "src/gone.ts", "/abs.ts"]);
    const r = run(DIST, root, ["scout", scope]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^ignored: 2 files outside the code index$/m);
    assert.match(r.stdout, /^skipped lines: 2: src\/gone\.ts \(no such file\), \/abs\.ts \(absolute path\)$/m);
    assert.match(r.stdout, /^session 1: .*session-1\.md: src\/app\/main\.ts$/m);
    assert.doesNotMatch(r.stdout, /gen\.cjs/);
  });

  it("with nothing to scan clears the previous run's prompts", () => {
    const stale = path.join(root, "scribe-output", "scout", "session-1.md");
    assert.equal(run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]).status, 0);
    assert.ok(fs.existsSync(stale));
    assert.equal(run(DIST, root, ["scout", scopeFile(root, ["scripts/gen.cjs"])]).status, 0);
    assert.ok(!fs.existsSync(stale));
  });

  for (const [name, cli] of [
    ["dist", DIST],
    ["bundle", BUNDLE],
  ] as const) {
    for (const [what, lines, why] of [
      ["an empty scope", [], "the scope file lists no files"],
      ["a scope of bad lines", ["src/gone.ts", "/abs.ts"], "no scope line is a usable file (2 skipped)"],
      ["a scope outside the index", ["scripts/gen.cjs"], "no file in scope is in the code index (1 ignored)"],
    ] as const) {
      it(`${name}: ${what} is exit 0, says why nothing was scanned and is no PROPOSALS result`, () => {
        const scope = scopeFile(root, [...lines]);
        const text = run(cli, root, ["scout", scope]);
        assert.equal(text.status, 0, text.stderr);
        assert.equal(text.stdout.match(/^nothing scanned: .*$/gm)?.length, 1);
        assert.ok(text.stdout.includes(`nothing scanned: ${why}; this is not a clean result`), text.stdout);
        assert.doesNotMatch(text.stdout, /PROPOSALS/);

        const json = run(cli, root, ["scout", scope, "--json"]);
        assert.equal(json.status, 0, json.stderr);
        assert.doesNotMatch(json.stdout, /PROPOSALS/);
        const plan = JSON.parse(json.stdout);
        assert.equal(plan.nothingScanned, why);
        assert.deepEqual(plan.sessions, []);
      });
    }
  }

  it("a plan with a session says nothing of the kind", () => {
    const scope = scopeFile(root, ["src/app/main.ts"]);
    assert.doesNotMatch(run(DIST, root, ["scout", scope]).stdout, /nothing scanned/);
    assert.equal(JSON.parse(run(DIST, root, ["scout", scope, "--json"]).stdout).nothingScanned, null);
  });

  it("keeps its prompts out of git and changes no source", () => {
    const before = fs.readFileSync(path.join(root, "src/app/main.ts"), "utf8");
    run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
    assert.equal(fs.readFileSync(path.join(root, "scribe-output/scout/.gitignore"), "utf8"), "*\n");
    assert.equal(fs.readFileSync(path.join(root, "src/app/main.ts"), "utf8"), before);
  });
});

describe("scout with the config in a subdirectory of the git root", () => {
  let repo = "";
  let root = "";
  before(() => {
    repo = path.join(tmp, "mono");
    root = project("mono/packages/app");
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, "README.md"), "# mono\n");
    index(root);
  });

  for (const [name, cli] of [
    ["dist", DIST],
    ["bundle", BUNDLE],
  ] as const) {
    it(`${name}: reads lines from the git root and keeps those paths through plan and prompt`, () => {
      const file = scopeFile(root, [
        "packages/app/src/app/main.ts",
        "packages/app/src/app/loop.ts",
        "packages/app/src/shared/util.ts",
        "README.md",
        "src/app/main.ts",
      ]);
      const r = run(cli, root, ["scout", file, "--json"]);
      assert.equal(r.status, 0, r.stderr);
      const plan = JSON.parse(r.stdout);
      assert.equal(plan.root, repo);
      assert.deepEqual(plan.sessions[0].files, [
        "packages/app/src/app/loop.ts",
        "packages/app/src/app/main.ts",
        "packages/app/src/shared/util.ts",
      ]);
      assert.deepEqual(plan.skippedLines, [
        { line: "README.md", reason: "outside the config root packages/app" },
        { line: "src/app/main.ts", reason: "no such file" },
      ]);
      const prompt = fs.readFileSync(plan.sessions[0].prompt, "utf8");
      assert.ok(plan.sessions[0].prompt.startsWith(path.join(root, "scribe-output", "scout")));
      assert.match(prompt, /- packages\/app\/src\/app\/loop\.ts \(concept app\)/);
      assert.match(prompt, /- packages\/app\/src\/shared\/util\.ts \(concept shared\): fan-in 1, fan-out 0, 2 exports/);
      assert.match(prompt, /packages\/app\/src\/app\/loop\.ts <-> packages\/app\/src\/app\/main\.ts/);
      assert.match(prompt, /`lonelyExport` in packages\/app\/src\/shared\/util\.ts/);
      assert.doesNotMatch(prompt, /`usedFn` in/);
      assert.match(
        prompt,
        /packages\/app\/src\/app\/main\.ts \(app\) imports packages\/app\/src\/shared\/util\.ts \(shared\)/
      );
    });
  }

  it("a scope wholly outside the config root says so and is not a clean result", () => {
    const r = run(DIST, root, ["scout", scopeFile(root, ["README.md"])]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^skipped lines: 1: README\.md \(outside the config root packages\/app\)$/m);
    assert.match(
      r.stdout,
      /^nothing scanned: no scope line is a usable file \(1 skipped\); this is not a clean result/m
    );
    assert.doesNotMatch(r.stdout, /PROPOSALS/);
  });
});

describe("scout scope over the session limit", () => {
  it("splits by import links and names the files past the cap", () => {
    const root = project("large");
    // Two import chains of 8 files, then 50 unlinked ones: more than 5 sessions of 11 can hold.
    const write = (file: string, text: string) => fs.writeFileSync(path.join(root, "src/shared", file), text);
    const chainOf = (prefix: string) =>
      Array.from({ length: 8 }, (_, i) => {
        const next = i < 7 ? `import { ${prefix}${i + 1} } from "./${prefix}${i + 1}";\n${prefix}${i + 1};\n` : "";
        write(`${prefix}${i}.ts`, `${next}export const ${prefix}${i} = ${i};\n`);
        return `src/shared/${prefix}${i}.ts`;
      });
    const linked = [...chainOf("a"), ...chainOf("b")];
    const loose = Array.from({ length: 50 }, (_, i) => {
      write(`z${i}.ts`, `export const z${i} = ${i};\n`);
      return `src/shared/z${i}.ts`;
    });
    index(root);

    const r = run(DIST, root, ["scout", scopeFile(root, [...linked, ...loose]), "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.sessions.length, 5);
    for (const s of plan.sessions) assert.ok(s.files.length <= 11);
    assert.equal(plan.notScanned.length, linked.length + loose.length - 5 * 11);
    const inOneSession = (files: string[]) =>
      plan.sessions.some((s: { files: string[] }) => files.every((f) => s.files.includes(f)));
    assert.ok(inOneSession(linked.slice(0, 8)), "a chain stays together");
    assert.ok(inOneSession(linked.slice(8)), "a chain stays together");
    for (const s of plan.sessions) {
      const prompt = fs.readFileSync(s.prompt, "utf8");
      assert.ok(prompt.includes(`<neighbourhood>\n${s.files.length} files:`), "each session gets its own scope");
    }
    const text = run(DIST, root, ["scout", scopeFile(root, [...linked, ...loose])]).stdout;
    for (const f of plan.notScanned) assert.ok(text.includes(f), `${f} is named as not scanned`);
  });
});

describe("the refactor-scout skill", () => {
  const skill = fs.readFileSync(SKILL, "utf8");

  it("calls only the bundled CLI and spawns the plugin's read-only agent on Haiku", () => {
    assert.match(skill, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/code-graph\.cjs" scout "\$ARGUMENTS"/);
    assert.match(skill, /subagent_type: "code-graph:refactor-scout"/);
    assert.doesNotMatch(skill, /Explore/);
    assert.match(skill, /model: "haiku"/);
    assert.doesNotMatch(skill.split("---")[1], /\b(Edit|Write)\b/);
  });

  it("ships an agent that is read-only by its tool list, on Haiku, with a minimal system prompt", () => {
    const [, frontmatter, body] = fs.readFileSync(AGENT, "utf8").split("---\n");
    assert.match(frontmatter, /^name: refactor-scout$/m);
    assert.match(frontmatter, /^model: haiku$/m);
    assert.match(frontmatter, /^tools: Read, Grep, Glob$/m);
    assert.equal(body.trim().split("\n").length, 1);
    assert.ok(body.length < 120, "the bench's sessions had no role prompt: keep it small");
  });

  it("tells a scan that found nothing from a run that scanned nothing", () => {
    assert.match(skill, /\*\*Output with a `nothing scanned:` line:\*\* no agent will run/);
    assert.match(skill, /no `PROPOSALS:` line/);
    assert.match(skill, /`PROPOSALS: none` means a scan ran and proposed nothing/);
    assert.match(skill, /`nothing scanned: every session failed; this is not a clean result/);
  });

  it("gives the agents the root their paths are relative to", () => {
    assert.match(skill, /`root: <git root>`/);
    assert.match(skill, /Every path in it is relative to `<root>`/);
  });

  it("states what a config in a git subdirectory needs", () => {
    assert.match(
      skill,
      /A config in a git subdirectory needs an absolute scope file path, and the session started in that\s+subdirectory or `--root`/
    );
  });

  it("states the stop, the output and the limits of the evidence", () => {
    assert.match(skill, /PROPOSALS: none/);
    assert.match(skill, /no index or no tsconfig/);
    assert.match(skill, /Accurate is not valuable/);
    assert.match(skill, /\*\*Not measured:\*\* split scopes/);
    assert.match(skill, /epic-start or epic-end use/);
    assert.match(skill, /an arbitrary scope with no added neighbours/);
    assert.match(skill, /`Bash` and `Skill` beside/);
  });

  it("takes no decided-against input and hands nothing back", () => {
    assert.doesNotMatch(skill, /decided-against (input|argument|file)/i);
    assert.match(skill, /Do not edit code, create tasks, or hand a\s+proposal to any agent or worker/);
  });
});
