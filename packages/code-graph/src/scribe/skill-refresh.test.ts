// `apply --defer-renames` and `refresh-skills` (the plugin's Stop / SubagentStop hook), end to end:
// the built CLI (dist/cli.js) is spawned against temp projects with a real SQLite store, and the
// detection / message helpers are called in-process on the same stores. Nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { tryLoadConfig } from "../config.js";
import { closeStores, resolveDbPath } from "./db.js";
import {
  EXIT_RENAMES_DEFERRED,
  HOOK_TIMEOUT_SECONDS,
  changedSkillConcepts,
  hookCwd,
  hookMessage,
  refreshSkipReason,
  type RefreshReport,
} from "./skill-refresh.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;
let elsewhere: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-refresh-"));
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "cg-refresh-cwd-"));
});
afterEach(() => {
  closeStores();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

function run(args: string[], opts: { input?: string; cwd?: string } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [DIST, ...args], {
    encoding: "utf8",
    env,
    cwd: opts.cwd ?? tmp,
    input: opts.input ?? "",
  });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** `refresh-skills --hook` as Claude Code runs it: payload on stdin, process cwd somewhere else. */
const hook = (cwd = tmp) => run(["refresh-skills", "--hook"], { input: JSON.stringify({ cwd }), cwd: elsewhere });
const refreshJson = () => {
  const r = run(["refresh-skills", "--json"]);
  return { ...r, report: JSON.parse(r.stdout) as RefreshReport };
};

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const DB = () => path.join(tmp, "scribe-output/graph.db");
const sha = (rel: string) =>
  "sha256:" +
  createHash("sha256")
    .update(fs.readFileSync(path.join(tmp, rel)))
    .digest("hex");

function dbRows(sql: string, dbFile = DB()): any[] {
  const db = new DatabaseSync(dbFile);
  try {
    return db.prepare(sql).all() as any[];
  } finally {
    db.close();
  }
}
const bodyHash = (concept: string, dbFile = DB()): string | undefined =>
  dbRows(`SELECT doc FROM docs WHERE key = '${concept}::skill'`, dbFile).map((r) => JSON.parse(r.doc).body_hash)[0];
const conceptVertices = (concept: string): string =>
  JSON.stringify(dbRows(`SELECT key, doc FROM vertices WHERE concept = '${concept}' ORDER BY key`));
const archived = (): any[] =>
  dbRows("SELECT doc FROM vertices")
    .map((r) => JSON.parse(r.doc))
    .filter((v) => v.status === "archived");
const live = (concept: string): string[] =>
  dbRows(`SELECT doc FROM vertices WHERE concept = '${concept}'`)
    .map((r) => JSON.parse(r.doc))
    .filter((v) => v.status !== "archived")
    .map((v) => v.name)
    .sort();

const CODE_SKILL = ".claude/skills/code/SKILL.md";
const GUIDE_SKILL = "docs/SKILL.md";
const skillBody = (name: string, extra = "") =>
  `---\nname: ${name}\ndescription: "x"\n---\n\n# ${name}\n\nBody.${extra}\n`;

const SRC =
  "export function computeTotalAmount(price: number, qty: number): number {\n  return price * qty;\n}\n" +
  'export function formatLabel(s: string): string {\n  return "[" + s + "]";\n}\n';
// computeTotalAmount -> computeTotalAmounts: same file, same type, similarity well above 0.8.
const RENAMED = SRC.replace("computeTotalAmount(", "computeTotalAmounts(");
const BODY_EDIT = SRC.replace("price * qty", "price * qty + 0");

type ProjectOpts = { tsconfig?: "declared" | "missing" | "none"; concepts?: Record<string, unknown>; extra?: object };

/** A code concept (`code`) and a docs-only concept (`guide`), each with a declared SKILL.md. */
function project(o: ProjectOpts = {}): void {
  const tsconfig = o.tsconfig ?? "declared";
  write(
    "scribe.config.json",
    JSON.stringify({
      project: "p",
      ...(tsconfig !== "none" && { tsconfig: "tsconfig.json" }),
      concepts: o.concepts ?? {
        code: { globs: ["src/**/*.ts"], skill: CODE_SKILL },
        guide: { globs: ["docs/**/*.md"], skill: GUIDE_SKILL },
      },
      ...o.extra,
    })
  );
  if (tsconfig === "declared") {
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
    );
  }
  write("src/a.ts", SRC);
  write(CODE_SKILL, skillBody("code"));
  write(GUIDE_SKILL, skillBody("guide"));
  write("docs/a.md", "x");
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

/** project() plus a first extract + apply of every listed concept. */
function applied(concepts = ["code", "guide"], o: ProjectOpts = {}): void {
  project(o);
  for (const c of concepts) assert.equal(run(["extract", c]).code, 0, `extract ${c}`);
  assert.equal(run(["bootstrap"]).code, 0);
  for (const c of concepts) {
    const ap = run(["apply", c]);
    assert.equal(ap.code, 0, ap.stdout + ap.stderr);
  }
}

describe("apply --defer-renames", () => {
  it("with a rename candidate: prints the drift, writes nothing and exits 10", () => {
    applied(["code"]);
    write("src/a.ts", RENAMED);
    write(CODE_SKILL, skillBody("code", " Edited."));
    assert.equal(run(["extract", "code"]).code, 0);
    const vBefore = conceptVertices("code");
    const hBefore = bodyHash("code");

    const r = run(["apply", "code", "--defer-renames"]);
    assert.equal(r.code, EXIT_RENAMES_DEFERRED, r.stdout + r.stderr);
    assert.equal(EXIT_RENAMES_DEFERRED, 10);
    assert.match(r.stdout, /Rename candidates:/);
    assert.match(r.stdout, /Deferred: 1 rename candidate\(s\) need a decision; nothing was written\./);
    assert.match(r.stdout, /run: code-graph apply code/);
    assert.doesNotMatch(r.stdout, /Approve rename/, "never prompts");

    assert.equal(conceptVertices("code"), vBefore, "vertices untouched");
    assert.equal(bodyHash("code"), hBefore, "doc row untouched");
    assert.deepEqual(archived(), [], "no insert + archive recorded");
    assert.deepEqual(live("code"), ["computeTotalAmount", "formatLabel"]);

    const d = JSON.parse(run(["drift", "code", "--json"]).stdout.trim());
    assert.equal(d.renameCandidates.length, 1, "the same drift is left for the person who applies");
    assert.equal(d.doc.bodyHashChanged, true);
  });

  it("with no rename candidate: applies normally and exits 0", () => {
    applied(["code"]);
    write("src/a.ts", BODY_EDIT);
    write(CODE_SKILL, skillBody("code", " Edited."));
    assert.equal(run(["extract", "code"]).code, 0);

    const r = run(["apply", "code", "--defer-renames"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Deferred/);
    assert.equal(bodyHash("code"), sha(CODE_SKILL));
    assert.deepEqual(JSON.parse(run(["drift", "code", "--json"]).stdout.trim()).changed, []);
  });

  it("is rejected with --approve-drift (exit 1, nothing written)", () => {
    applied(["code"]);
    write("src/a.ts", RENAMED);
    assert.equal(run(["extract", "code"]).code, 0);
    const vBefore = conceptVertices("code");

    const r = run(["apply", "code", "--defer-renames", "--approve-drift"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /--defer-renames and --approve-drift are mutually exclusive/);
    assert.equal(conceptVertices("code"), vBefore);
  });

  it("without the flag, apply still prompts for the rename and records the answer", () => {
    applied(["code"]);
    write("src/a.ts", RENAMED);
    assert.equal(run(["extract", "code"]).code, 0);

    const r = run(["apply", "code"], { input: "y\n" });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      /Approve rename: computeTotalAmount → computeTotalAmounts \(score: [\d.]+\)\? \[y\/n\/skip-all\]/
    );
    assert.doesNotMatch(r.stdout, /Deferred/);
    assert.deepEqual(live("code"), ["computeTotalAmounts", "formatLabel"]);
  });

  it("without the flag, --approve-drift still approves without prompting", () => {
    applied(["code"]);
    write("src/a.ts", RENAMED);
    assert.equal(run(["extract", "code"]).code, 0);
    const r = run(["apply", "code", "--approve-drift"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Approve rename:|Deferred/);
    assert.deepEqual(live("code"), ["computeTotalAmounts", "formatLabel"]);
  });
});

describe("refresh-skills: clean case", () => {
  it("extracts and applies every concept whose SKILL.md changed; a second run does nothing", () => {
    applied();
    write(CODE_SKILL, skillBody("code", " Edited."));
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    assert.notEqual(bodyHash("code"), sha(CODE_SKILL));

    const { code, report } = refreshJson();
    assert.equal(code, 0);
    assert.equal(report.skipped, undefined);
    assert.deepEqual([...report.changed].sort(), ["code", "guide"]);
    assert.deepEqual(report.results.map((r) => [r.concept, r.status]).sort(), [
      ["code", "refreshed"],
      ["guide", "refreshed"],
    ]);
    assert.equal(typeof report.ms, "number");
    assert.equal(bodyHash("code"), sha(CODE_SKILL));
    assert.equal(bodyHash("guide"), sha(GUIDE_SKILL));
    assert.equal(fs.existsSync(path.join(tmp, "scribe-output/.refresh-skills.lock")), false, "lock removed");

    const again = refreshJson();
    assert.equal(again.code, 0);
    assert.deepEqual(again.report.changed, []);
    assert.deepEqual(again.report.results, []);
    assert.equal(again.report.skipped, undefined);
  });

  it("--hook reads the payload cwd, prints one systemMessage line naming the refreshed concept, exits 0", () => {
    applied();
    write(GUIDE_SKILL, skillBody("guide", " Edited."));

    const r = hook();
    assert.equal(r.code, 0, r.stderr);
    const lines = r.stdout.split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 1, r.stdout);
    const msg = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(msg), ["systemMessage"]);
    assert.equal(msg.systemMessage, "code-graph: SKILL.md changed, graph refreshed for guide.");
    assert.equal(bodyHash("guide"), sha(GUIDE_SKILL));

    const silent = hook();
    assert.equal(silent.code, 0);
    assert.equal(silent.stdout, "", "a stop with nothing changed prints nothing");
  });

  it("text mode: reports the refresh and exits 0; says nothing changed on the next run", () => {
    applied();
    write(CODE_SKILL, skillBody("code", " Edited."));
    const r = run(["refresh-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /graph refreshed for code\./);
    const r2 = run(["refresh-skills"]);
    assert.equal(r2.code, 0);
    assert.match(r2.stdout, /no SKILL\.md changed since the last apply/);
  });
});

describe("refresh-skills: deferred rename", () => {
  it("leaves a concept with a rename candidate unapplied and names it; other concepts still refresh", () => {
    applied();
    write("src/a.ts", RENAMED);
    write(CODE_SKILL, skillBody("code", " Edited."));
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    const vBefore = conceptVertices("code");
    const hBefore = bodyHash("code");

    const r = hook();
    assert.equal(r.code, 0, "a hook never fails the stop");
    const lines = r.stdout.split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 1);
    const msg: string = JSON.parse(lines[0]).systemMessage;
    assert.match(msg, /graph refreshed for guide\./);
    assert.match(msg, /code-graph: code NOT applied, 1 rename candidate\(s\) need a decision\./);
    assert.match(msg, /Run `code-graph apply code` in a terminal/);
    assert.match(msg, /do not use --approve-drift/);
    assert.doesNotMatch(msg, /refreshed for [^\n]*code/);

    assert.equal(conceptVertices("code"), vBefore, "deferred concept untouched");
    assert.equal(bodyHash("code"), hBefore);
    assert.deepEqual(archived(), [], "no rename recorded as insert + archive");
    assert.equal(bodyHash("guide"), sha(GUIDE_SKILL));

    // Re-reported at the next stop until someone decides; the CLI exits 10.
    const { code, report } = refreshJson();
    assert.equal(code, EXIT_RENAMES_DEFERRED);
    assert.deepEqual(report.changed, ["code"]);
    assert.deepEqual(report.results, [{ concept: "code", status: "deferred", detail: "1 rename candidate(s)" }]);
    assert.deepEqual(archived(), []);

    // Deciding by hand clears it.
    assert.equal(run(["apply", "code"], { input: "y\n" }).code, 0);
    assert.equal(bodyHash("code"), sha(CODE_SKILL));
    assert.deepEqual(refreshJson().report.changed, []);
  });
});

describe("refresh-skills: failure", () => {
  it("reports the failing step; --hook still exits 0, text mode exits 1", () => {
    applied();
    write(CODE_SKILL, skillBody("code", " Edited."));
    write("tsconfig.json", "{ not json");

    const h = hook();
    assert.equal(h.code, 0, h.stderr);
    const msg: string = JSON.parse(h.stdout.trim()).systemMessage;
    assert.match(msg, /code-graph: refresh of code failed at extract: /);
    assert.match(msg, /Run `code-graph extract code && code-graph apply code` to see the full error\./);

    const t = run(["refresh-skills"]);
    assert.equal(t.code, 1, t.stdout + t.stderr);
    assert.match(t.stdout, /refresh of code failed at extract/);
  });
});

describe("refresh-skills: no-op cases", () => {
  function assertNoop(reason: string) {
    const h = hook();
    assert.equal(h.code, 0, h.stderr);
    assert.equal(h.stdout, "", `hook is silent (${reason})`);
    const { code, report } = refreshJson();
    assert.equal(code, 0);
    assert.deepEqual(report, { skipped: reason, changed: [], results: [], ms: report.ms });
  }

  it("no scribe.config.json", () => {
    write(CODE_SKILL, skillBody("code"));
    assertNoop("no scribe.config.json");
  });

  it("no concepts configured", () => {
    project({ concepts: {} });
    assertNoop("no concepts configured");
  });

  it("no tsconfig declared (even with docs-only concepts)", () => {
    project({ tsconfig: "none", concepts: { guide: { globs: ["docs/**/*.md"], skill: GUIDE_SKILL } } });
    assert.equal(run(["extract", "guide"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "guide"]).code, 0);
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    const before = bodyHash("guide");
    assertNoop("no tsconfig");
    assert.equal(bodyHash("guide"), before, "nothing applied");
  });

  it("tsconfig declared but the file is missing", () => {
    project({ tsconfig: "missing" });
    assertNoop("no tsconfig");
  });

  it("no graph store: skipped, and the store is not created", () => {
    project();
    assertNoop("no graph store");
    assert.equal(fs.existsSync(DB()), false);
    assert.equal(fs.existsSync(path.join(tmp, "scribe-output")), false);
  });

  it("no SKILL.md changed: no extract and no apply runs", async () => {
    applied();
    const ast = path.join(tmp, "scribe-output/code.ast.json");
    const astGuide = path.join(tmp, "scribe-output/guide.ast.json");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(ast, old, old);
    fs.utimesSync(astGuide, old, old);
    const m1 = fs.statSync(ast).mtimeMs;
    const m2 = fs.statSync(astGuide).mtimeMs;
    const meta = JSON.stringify(dbRows("SELECT doc FROM docs ORDER BY key"));
    // A code edit without a SKILL.md edit is not this hook's business.
    write("src/a.ts", BODY_EDIT);

    const h = hook();
    assert.equal(h.code, 0);
    assert.equal(h.stdout, "");
    const { report } = refreshJson();
    assert.deepEqual([report.changed, report.results, report.skipped], [[], [], undefined]);
    assert.equal(fs.statSync(ast).mtimeMs, m1, "code not re-extracted");
    assert.equal(fs.statSync(astGuide).mtimeMs, m2, "guide not re-extracted");
    assert.equal(JSON.stringify(dbRows("SELECT doc FROM docs ORDER BY key")), meta, "nothing applied");
    assert.deepEqual(JSON.parse(run(["drift", "code", "--json"]).stdout.trim()).changed, []);
  });
});

describe("refresh-skills: lock", () => {
  it("a fresh lock skips the run; a lock older than the hook timeout is taken over and removed", () => {
    applied();
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    const lock = write("scribe-output/.refresh-skills.lock", "99999");
    const before = bodyHash("guide");

    const held = refreshJson();
    assert.equal(held.code, 0);
    assert.equal(held.report.skipped, "another refresh-skills run holds the lock");
    assert.deepEqual(held.report.changed, ["guide"]);
    assert.deepEqual(held.report.results, []);
    assert.equal(bodyHash("guide"), before, "nothing applied under a live lock");
    assert.ok(fs.existsSync(lock), "a lock it does not own is left in place");
    assert.equal(hook().stdout, "", "the hook stays silent while another run holds the lock");

    const stale = new Date(Date.now() - (HOOK_TIMEOUT_SECONDS + 30) * 1000);
    fs.utimesSync(lock, stale, stale);
    const taken = refreshJson();
    assert.equal(taken.code, 0);
    assert.equal(taken.report.skipped, undefined);
    assert.deepEqual(taken.report.results, [{ concept: "guide", status: "refreshed" }]);
    assert.equal(bodyHash("guide"), sha(GUIDE_SKILL));
    assert.equal(fs.existsSync(lock), false, "lock removed after the run");
  });

  it("with a dbPath override the lock lives next to the db file", () => {
    applied(["guide"], { extra: { dbPath: "data/g.db" } });
    const db = path.join(tmp, "data/g.db");
    assert.ok(fs.existsSync(db));
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    write("scribe-output/.refresh-skills.lock", "1"); // wrong place: ignored
    const lock = write("data/.refresh-skills.lock", "1");

    assert.equal(refreshJson().report.skipped, "another refresh-skills run holds the lock");
    fs.rmSync(lock);
    const { report } = refreshJson();
    assert.deepEqual(report.results, [{ concept: "guide", status: "refreshed" }]);
    assert.equal(bodyHash("guide", db), sha(GUIDE_SKILL));
  });
});

describe("changedSkillConcepts", () => {
  it("skips a never-applied concept and a declared skill path that does not exist", async () => {
    project({
      concepts: {
        code: { globs: ["src/**/*.ts"], skill: CODE_SKILL },
        guide: { globs: ["docs/**/*.md"], skill: GUIDE_SKILL },
        ghost: { globs: ["docs/**/*.md"], skill: "nope/SKILL.md" },
      },
    });
    assert.equal(run(["extract", "code"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "code"]).code, 0);
    write(CODE_SKILL, skillBody("code", " Edited."));
    write(GUIDE_SKILL, skillBody("guide", " Edited."));

    const config = tryLoadConfig(tmp)!;
    const changed = await changedSkillConcepts(config, resolveDbPath(config));
    closeStores();
    assert.deepEqual(changed, [{ concept: "code", skillPath: CODE_SKILL }]);
  });

  it("reports an applied concept whose skill was added after its first apply (no doc row)", async () => {
    project({ concepts: { code: { globs: ["src/**/*.ts"] } }, extra: { skillsDir: "skills" } });
    fs.rmSync(path.join(tmp, ".claude"), { recursive: true, force: true });
    assert.equal(run(["extract", "code"]).code, 0);
    run(["bootstrap"]);
    assert.equal(run(["apply", "code"]).code, 0);
    assert.equal(bodyHash("code"), undefined, "no doc row yet");
    write("skills/code/SKILL.md", skillBody("code"));

    const config = tryLoadConfig(tmp)!;
    assert.deepEqual(await changedSkillConcepts(config, resolveDbPath(config)), [
      { concept: "code", skillPath: "skills/code/SKILL.md" },
    ]);
    closeStores();

    const { report } = refreshJson();
    assert.deepEqual(report.results, [{ concept: "code", status: "refreshed" }]);
    assert.equal(bodyHash("code"), sha("skills/code/SKILL.md"));
  });
});

describe("refreshSkipReason / hookMessage / hookCwd", () => {
  it("refreshSkipReason names each no-op reason", () => {
    const base = { project: "p", configRoot: tmp, concepts: { a: { globs: ["x"] } } } as any;
    assert.equal(refreshSkipReason(null), "no scribe.config.json");
    assert.equal(refreshSkipReason({ ...base, concepts: {} }), "no concepts configured");
    assert.equal(refreshSkipReason(base), "no tsconfig");
    assert.equal(refreshSkipReason({ ...base, tsconfig: "t.json" }), "no tsconfig");
    write("t.json", "{}");
    assert.equal(refreshSkipReason({ ...base, tsconfig: "t.json" }), null);
  });

  it("hookMessage is null when skipped or nothing changed, one line per outcome otherwise", () => {
    assert.equal(hookMessage({ skipped: "no tsconfig", changed: [], results: [], ms: 1 }), null);
    assert.equal(hookMessage({ changed: [], results: [], ms: 1 }), null);
    assert.equal(
      hookMessage({ skipped: "another refresh-skills run holds the lock", changed: ["a"], results: [], ms: 1 }),
      null
    );
    const msg = hookMessage({
      changed: ["a", "b", "c", "d"],
      results: [
        { concept: "a", status: "refreshed" },
        { concept: "b", status: "refreshed" },
        { concept: "c", status: "deferred", detail: "2 rename candidate(s)" },
        { concept: "d", status: "failed", step: "apply", detail: "boom." },
      ],
      ms: 1,
    })!;
    const lines = msg.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], "code-graph: SKILL.md changed, graph refreshed for a, b.");
    assert.match(
      lines[1],
      /^code-graph: c NOT applied, 2 rename candidate\(s\) need a decision\. Run `code-graph apply c`/
    );
    assert.match(lines[2], /^code-graph: refresh of d failed at apply: boom\. Run /);
    const empty = hookMessage({
      changed: ["e"],
      results: [{ concept: "e", status: "failed", step: "extract", detail: "" }],
      ms: 1,
    })!;
    assert.match(empty, /failed at extract: no output\./);
  });

  it("hookCwd: payload cwd, else CLAUDE_PROJECT_DIR, else process.cwd(); bad JSON falls through", () => {
    assert.equal(hookCwd(JSON.stringify({ cwd: "/a" }), { CLAUDE_PROJECT_DIR: "/b" }), "/a");
    assert.equal(hookCwd(JSON.stringify({ cwd: "" }), { CLAUDE_PROJECT_DIR: "/b" }), "/b");
    assert.equal(hookCwd(JSON.stringify({ cwd: 3 }), { CLAUDE_PROJECT_DIR: "/b" }), "/b");
    assert.equal(hookCwd("{not json", { CLAUDE_PROJECT_DIR: "/b" }), "/b");
    assert.equal(hookCwd("", {}), process.cwd());
  });

  it("plugin/hooks/hooks.json runs the bundled refresh-skills --hook on Stop and SubagentStop with HOOK_TIMEOUT_SECONDS", () => {
    const repo = path.resolve(PKG, "../..");
    const hooks = JSON.parse(fs.readFileSync(path.join(repo, "plugin/hooks/hooks.json"), "utf8")).hooks;
    for (const event of ["Stop", "SubagentStop"]) {
      const h = hooks[event][0].hooks[0];
      assert.equal(h.type, "command");
      assert.match(h.command, /scripts\/code-graph\.cjs" refresh-skills --hook$/);
      assert.equal(h.timeout, HOOK_TIMEOUT_SECONDS);
    }

    // The committed bundle refreshes a changed SKILL.md end to end.
    applied(["guide"]);
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.NODE_OPTIONS;
    const r = spawnSync(
      process.execPath,
      [path.join(repo, "plugin/scripts/code-graph.cjs"), "refresh-skills", "--hook"],
      {
        encoding: "utf8",
        env,
        cwd: elsewhere,
        input: JSON.stringify({ cwd: tmp }),
      }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout.trim()).systemMessage, "code-graph: SKILL.md changed, graph refreshed for guide.");
    assert.equal(bodyHash("guide"), sha(GUIDE_SKILL));
  });

  it("--hook with no payload cwd falls back to CLAUDE_PROJECT_DIR", () => {
    applied(["guide"]);
    write(GUIDE_SKILL, skillBody("guide", " Edited."));
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: tmp };
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, [DIST, "refresh-skills", "--hook"], {
      encoding: "utf8",
      env,
      cwd: elsewhere,
      input: "{}",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(JSON.parse(r.stdout.trim()).systemMessage, /graph refreshed for guide/);
  });
});
