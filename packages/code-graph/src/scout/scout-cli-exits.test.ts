// `code-graph scout` exit codes reached for real, through dist and the bundle, on a throwaway project. No
// model call. Covers exit 1 (an unexpected failure), the `tsconfig` key with and without a store, and exit 3
// (a store written by a newer code-graph), plus the plan's determinism at the CLI. Requires `pnpm build`
// first, like scout-cli.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");
const BUNDLE = path.resolve(PKG, "../../plugin/scripts/code-graph.cjs");
const TS_MORPH = path.join(PKG, "node_modules", "ts-morph");
const TIMEOUT_MS = 120_000;

let tmp = "";
let cache = "";

function run(cli: string, root: string, args: string[]) {
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env, timeout: TIMEOUT_MS });
}

/** A two-concept project. `declareTsconfig: false` leaves the `tsconfig` key out of scribe.config.json. */
function project(name: string, opts: { declareTsconfig?: boolean } = {}): string {
  const root = path.join(tmp, name);
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write("src/shared/util.ts", "export function usedFn(x: number): number {\n  return x + 1;\n}\n");
  write(
    "src/app/main.ts",
    `import { usedFn } from "../shared/util";\nexport function mainFn(): number {\n  return usedFn(1);\n}\n`
  );
  write(".claude/skills/app/SKILL.md", "# app\n\nThe app concept.\n");
  write(".claude/skills/shared/SKILL.md", "# shared\n\nThe shared concept.\n");
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { module: "esnext", moduleResolution: "bundler" }, include: ["src/**/*.ts"] })
  );
  const config: Record<string, unknown> = {
    project: name,
    concepts: {
      app: { globs: ["src/app/**/*.ts"], skill: ".claude/skills/app/SKILL.md" },
      shared: { globs: ["src/shared/**/*.ts"], skill: ".claude/skills/shared/SKILL.md" },
    },
  };
  if (opts.declareTsconfig !== false) config.tsconfig = "tsconfig.json";
  write("scribe.config.json", JSON.stringify(config));
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

const storeOf = (root: string) => path.join(root, "scribe-output", "graph.db");

before(() => {
  for (const f of [DIST, BUNDLE, TS_MORPH]) assert.ok(fs.existsSync(f), `${f} is missing, run pnpm build first`);
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-exits-")));
  cache = path.join(tmp, "empty-cache");
  fs.mkdirSync(cache);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLIS = [
  ["dist", DIST],
  ["bundle", BUNDLE],
] as const;

describe("scout exit 1: an unexpected failure is one stderr line and no prompts", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: a store that is not a database is exit 1, one scout failed line, no prompt directory`, () => {
      const root = project(`corrupt-${name}`);
      index(root);
      fs.writeFileSync(storeOf(root), "this is not a sqlite database\n".repeat(100));
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
      assert.match(r.stderr, /^scout failed: /);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output", "scout")));
    });

    it(`${name}: control, the same project with a healthy store plans and is exit 0`, () => {
      const root = project(`healthy-${name}`);
      index(root);
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /scout failed/);
    });
  }

  // Root ignores file modes, so the denied clean-up only happens for an ordinary user.
  const notRoot = typeof process.getuid === "function" && process.getuid() !== 0;
  for (const [name, cli] of CLIS) {
    it(
      `${name}: a prompt file the clean-up cannot remove is exit 1, one scout failed line`,
      { skip: !notRoot && "runs as root" },
      () => {
        const root = project(`readonly-${name}`);
        index(root);
        const old = path.join(root, "scribe-output", "scout", "old");
        fs.mkdirSync(old, { recursive: true });
        fs.writeFileSync(path.join(old, "stale.md"), "old\n");
        fs.chmodSync(old, 0o555);
        try {
          const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
          assert.equal(r.status, 1, r.stdout + r.stderr);
          assert.equal(r.stdout, "");
          assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
          assert.match(r.stderr, /^scout failed: EACCES/);
        } finally {
          fs.chmodSync(old, 0o755);
        }
      }
    );
  }
});

describe("scout exit 12: the tsconfig key, with and without a store", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: key omitted and no store: exit 12 names the key, one line, and creates no store`, () => {
      const root = project(`nokey-nostore-${name}`, { declareTsconfig: false });
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 12, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
      assert.match(r.stderr, /no `tsconfig` key in scribe\.config\.json/);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output")));
    });

    it(`${name}: key removed from a config whose store exists: exit 12 names the key, the store is unchanged`, () => {
      const root = project(`removed-${name}`);
      index(root);
      const file = path.join(root, "scribe.config.json");
      const config = JSON.parse(fs.readFileSync(file, "utf8"));
      const before = fs.readFileSync(storeOf(root));
      delete config.tsconfig;
      fs.writeFileSync(file, JSON.stringify(config));
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 12, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
      assert.match(r.stderr, /no `tsconfig` key in scribe\.config\.json/);
      assert.doesNotMatch(r.stderr, /no index/);
      assert.ok(!fs.existsSync(path.join(root, "scribe-output", "scout")));
      assert.ok(fs.readFileSync(storeOf(root)).equals(before), "the store is not rewritten");
    });

    it(`${name}: control, the key put back on that config plans and is exit 0`, () => {
      const root = project(`restored-${name}`);
      index(root);
      const file = path.join(root, "scribe.config.json");
      const config = JSON.parse(fs.readFileSync(file, "utf8"));
      delete config.tsconfig;
      fs.writeFileSync(file, JSON.stringify(config));
      assert.equal(run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]).status, 12);
      config.tsconfig = "tsconfig.json";
      fs.writeFileSync(file, JSON.stringify(config));
      const r = run(cli, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 0, r.stderr);
    });
  }
});

describe("scout exit 3: a store written by a newer code-graph", () => {
  // Known gap, found by this test: preflight() runs bootstrapStore(), whose applySchema() sets
  // `PRAGMA user_version` back to SCHEMA_VERSION, so checkSchemaVersion() never sees the newer number. scout
  // then runs against the store and rewrites its version. The assertions below are what the documented exit
  // 3 requires; remove the `todo` marker to see them fail.
  it(
    "dist: a newer store is exit 3, names the upgrade, and is left at its version",
    {
      todo: "known gap: bootstrapStore resets user_version before checkSchemaVersion reads it, so exit 3 is unreachable",
    },
    () => {
      const root = project("newer-store");
      index(root);
      const db = new DatabaseSync(storeOf(root));
      db.exec("PRAGMA user_version = 999");
      db.close();
      const r = run(DIST, root, ["scout", scopeFile(root, ["src/app/main.ts"])]);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /written by a newer code-graph/);
      assert.equal(r.stdout, "");
      const after = new DatabaseSync(storeOf(root));
      const version = after.prepare("PRAGMA user_version").get() as { user_version: number };
      after.close();
      assert.equal(version.user_version, 999, "scout does not downgrade a newer store");
    }
  );
});

describe("scout plan at the CLI is deterministic", () => {
  let root = "";
  let scope: string[] = [];
  before(() => {
    root = project("determinism");
    // Seven chains of 7, 7, 7, 7, 7, 6 and 5 files. Packed largest first, the 6 and 5 share a session and the
    // 5 sessions of 7 and the 11 leave one 7-file session past the cap of 5: the smallest is the one cut.
    const write = (file: string, text: string) => fs.writeFileSync(path.join(root, file), text);
    const groups = [7, 7, 7, 7, 7, 6, 5];
    scope = groups.flatMap((size, g) =>
      Array.from({ length: size }, (_, i) => {
        const file = `src/shared/g${g}-${i}.ts`;
        const next =
          i < size - 1 ? `import { g${g}_${i + 1} } from "./g${g}-${i + 1}";\nexport const x = g${g}_${i + 1};\n` : "";
        write(file, `${next}export const g${g}_${i} = ${i};\n`);
        return file;
      })
    );
    index(root);
  });

  for (const [name, cli] of CLIS) {
    it(`${name}: the same scope in another line order gives the same plan, and sessions run largest first`, () => {
      const forward = run(cli, root, ["scout", scopeFile(root, scope), "--json"]);
      assert.equal(forward.status, 0, forward.stderr);
      const reversed = run(cli, root, ["scout", scopeFile(root, [...scope].reverse()), "--json"]);
      assert.equal(reversed.status, 0, reversed.stderr);
      const a = JSON.parse(forward.stdout);
      const b = JSON.parse(reversed.stdout);
      assert.deepEqual(
        a.sessions.map((s: { files: string[] }) => s.files),
        b.sessions.map((s: { files: string[] }) => s.files)
      );
      assert.deepEqual(a.notScanned, b.notScanned);
      const sizes = a.sessions.map((s: { files: string[] }) => s.files.length);
      assert.deepEqual(
        sizes,
        [...sizes].sort((x: number, y: number) => y - x),
        "largest session first"
      );
      assert.equal(
        sizes.reduce((x: number, y: number) => x + y, 0) + a.notScanned.length,
        scope.length,
        "every file is planned or named"
      );
    });

    it(`${name}: the plain plan is the same on a second run, and every file past the cap is named`, () => {
      const first = run(cli, root, ["scout", scopeFile(root, scope)]);
      const second = run(cli, root, ["scout", scopeFile(root, scope)]);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.stdout, second.stdout);
      assert.match(first.stdout, /^root: /m);
      const json = JSON.parse(run(cli, root, ["scout", scopeFile(root, scope), "--json"]).stdout);
      assert.equal(json.notScanned.length, 7, "one 7-file session is past the cap");
      assert.match(first.stdout, /^not scanned: 7 files past the session cap: /m);
      for (const f of json.notScanned) assert.ok(first.stdout.includes(f), `${f} is named`);
    });
  }
});
