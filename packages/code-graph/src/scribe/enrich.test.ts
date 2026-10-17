// enrich targets / enrich merge, hash_seen staleness and the gaps count.
// The built CLI (dist/cli.js) is spawned against temp projects; nothing is stubbed.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { analyzeConceptGaps, fetchConceptCounts } from "../query/gaps.js";
import { enrichmentIsCurrent } from "./enrich.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = path.join(PKG, "dist/cli.js");

let tmp: string;

beforeEach(() => {
  assert.ok(fs.existsSync(DIST), `${DIST} is missing — run \`pnpm build\` from the repository root first`);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-enrich-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", env, cwd: tmp });
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const A_SRC = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const B_SRC = "import { alpha } from './a';\nexport function beta(x: number): number {\n  return alpha(x) * 2;\n}\n";

function project() {
  write(
    "scribe.config.json",
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/a.ts", A_SRC);
  write("src/b.ts", B_SRC);
  fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
}

const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(tmp, rel), "utf8"));
const ast = () => readJson("scribe-output/c.ast.json");
const keyOf = (name: string): string => ast().vertices.find((v: any) => v.name === name)._key;
const targets = (...extra: string[]) => JSON.parse(run(["enrich", "targets", "c", "--json", ...extra]).stdout).targets;

function storeVertex(name: string): any {
  const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT doc FROM vertices WHERE concept = 'c' AND status = 'live'").all() as {
      doc: string;
    }[];
    return rows.map((r) => JSON.parse(r.doc)).find((d) => d.name === name);
  } finally {
    db.close();
  }
}

function partial(name: string, purpose: string, edgeReason?: string) {
  const a = ast();
  const key = keyOf(name);
  const edge = a.edges.find((e: any) => e._from === `vertices/${key}`);
  return {
    concept: "c",
    vertices: [{ _key: key, purpose }],
    edges: edge && edgeReason ? [{ _key: edge._key, reason: edgeReason }] : [],
  };
}

function writePartial(p: unknown): string {
  return write("partial.json", JSON.stringify(p));
}

describe("enrichmentIsCurrent", () => {
  const now = { signature: "s", contentHash: "h" };
  it("uses hash_seen when present", () => {
    assert.equal(enrichmentIsCurrent({ hash_seen: "h", sig_seen: "other" }, now), true);
    assert.equal(enrichmentIsCurrent({ hash_seen: "old", sig_seen: "s" }, now), false);
  });
  it("falls back to the signature for legacy entries", () => {
    assert.equal(enrichmentIsCurrent({ sig_seen: "s" }, now), true);
    assert.equal(enrichmentIsCurrent({ sig_seen: "x" }, now), false);
    assert.equal(enrichmentIsCurrent({}, now), false);
    assert.equal(enrichmentIsCurrent(undefined, now), false);
  });
});

describe("gaps counts stale descriptions as not enriched", () => {
  it("fetchConceptCounts skips purposes flagged stale", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE vertices (key TEXT PRIMARY KEY, doc TEXT NOT NULL,
      concept TEXT GENERATED ALWAYS AS (json_extract(doc, '$.concept')) VIRTUAL,
      status TEXT GENERATED ALWAYS AS (json_extract(doc, '$.status')) VIRTUAL,
      purpose TEXT GENERATED ALWAYS AS (json_extract(doc, '$.purpose')) VIRTUAL)`);
    const ins = db.prepare("INSERT INTO vertices(key, doc) VALUES (?, ?)");
    const mk = (purpose: string | undefined, stale: boolean) =>
      JSON.stringify({
        concept: "c",
        status: "live",
        ...(purpose ? { purpose } : {}),
        agent: { authored_by: null, stale },
      });
    ins.run("1", mk("fresh", false));
    ins.run("2", mk("old", true));
    ins.run("3", mk(undefined, false));
    const counts = await fetchConceptCounts(db);
    assert.deepEqual(counts.get("c"), { live: 3, enriched: 1 });
    const report = analyzeConceptGaps([{ name: "c", enrichable: true }], counts);
    assert.equal(report.concepts[0].status, "partial");
  });
});

describe("enrich targets", () => {
  it("errors naming extract when ast.json is missing", () => {
    project();
    const r = run(["enrich", "targets", "c", "--json"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /code-graph extract c/);
  });

  it("lists new vertices with what an enricher needs, then changed, then named", () => {
    project();
    run(["extract", "c"]);
    const first = targets();
    assert.equal(first.length, 2);
    const beta = first.find((t: any) => t.name === "beta");
    assert.deepEqual(beta.reasons, ["new"]);
    assert.equal(beta.type, "function");
    assert.equal(beta.filepath, "src/b.ts");
    assert.equal(typeof beta.start_line, "number");
    assert.match(beta.signature, /beta/);
    assert.equal(beta.purpose, null);
    assert.ok(beta.edgesWithoutReason.some((e: any) => e.toName === "alpha"));

    run(["apply", "c", "--approve-drift"]);
    run([
      "enrich",
      "merge",
      "c",
      writePartial({
        concept: "c",
        vertices: ast().vertices.map((v: any) => ({ _key: v._key, purpose: `does ${v.name}` })),
        edges: [],
      }),
    ]);
    run(["apply", "c"]);
    assert.deepEqual(targets(), []);

    const named = targets("--vertex", "alpha");
    assert.deepEqual(
      named.map((t: any) => [t.name, t.reasons]),
      [["alpha", ["named"]]]
    );
    assert.equal(named[0].purpose, "does alpha");

    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 5;\n}\n");
    run(["extract", "c"]);
    const changed = targets();
    assert.deepEqual(
      changed.map((t: any) => [t.name, t.reasons]),
      [["alpha", ["changed"]]]
    );
    assert.notEqual(run(["enrich", "targets", "c", "--vertex", "nope", "--json"]).code, 0);
  });
});

describe("enrich targets --core", () => {
  const coreProject = (skillBody: string) => {
    project();
    write(
      "scribe.config.json",
      JSON.stringify({
        project: "p",
        tsconfig: "tsconfig.json",
        concepts: { c: { globs: ["src/**/*.ts"], skill: "skills/c/SKILL.md" } },
      })
    );
    write("skills/c/SKILL.md", skillBody);
    run(["extract", "c"]);
  };
  const full = (...extra: string[]) => JSON.parse(run(["enrich", "targets", "c", "--json", ...extra]).stdout);

  it("lists only core vertices as new and reports the left-out count", () => {
    coreProject("# c\n\nEntry point is `alpha`.\n");
    const out = full("--core");
    assert.deepEqual(
      out.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [["alpha", ["new"], true]]
    );
    assert.equal(out.core.size, 1);
    assert.equal(out.core.leftOut, 1);
    assert.equal(out.core.thin, false);
    const text = run(["enrich", "targets", "c", "--core"]).stdout;
    assert.match(text, /alpha .*\[new,core\]/);
    assert.match(text, /1 non-core new vertices left out/);
    assert.equal(full().targets.length, 2, "without --core everything is new");
  });

  it("reports a thin core for a big concept whose SKILL.md names almost nothing", () => {
    coreProject("# c\n\nEntry point is `alpha`.\n");
    write(
      "src/many.ts",
      Array.from({ length: 50 }, (_, i) => `export function fn${i}(): number {\n  return ${i};\n}\n`).join("")
    );
    run(["extract", "c"]);
    const out = full("--core");
    assert.equal(out.core.thin, true);
    assert.match(out.core.message, /core is thin: SKILL\.md names 1 of 52 vertices/);
    assert.match(run(["enrich", "targets", "c", "--core"]).stdout, /core is thin/);
  });

  it("still lists named vertices outside the core", () => {
    coreProject("# c\n\nEntry point is `alpha`.\n");
    const out = full("--core", "--vertex", "beta");
    assert.deepEqual(
      out.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [
        ["alpha", ["new"], true],
        ["beta", ["named"], false],
      ]
    );
    assert.equal(out.core.leftOut, 1);
  });

  it("still lists changed vertices outside the core", () => {
    coreProject("# c\n\nEntry point is `alpha`.\n");
    run(["apply", "c", "--approve-drift"]);
    run([
      "enrich",
      "merge",
      "c",
      writePartial({
        concept: "c",
        vertices: ast().vertices.map((v: any) => ({ _key: v._key, purpose: `does ${v.name}` })),
        edges: [],
      }),
    ]);
    run(["apply", "c"]);
    write("src/b.ts", B_SRC.replace("* 2", "* 3"));
    run(["extract", "c"]);
    const out = full("--core");
    assert.deepEqual(
      out.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [["beta", ["changed"], false]]
    );
    assert.equal(out.core.leftOut, 0);
  });
});

describe("enrich merge", () => {
  it("upserts by key, keeps untouched entries, is idempotent and sorted", () => {
    project();
    run(["extract", "c"]);
    const full = {
      concept: "c",
      vertices: ast().vertices.map((v: any) => ({ _key: v._key, purpose: `old ${v.name}` })),
      edges: ast().edges.map((e: any) => ({ _key: e._key, reason: `why ${e.type}` })),
    };
    assert.equal(run(["enrich", "merge", "c", writePartial(full)]).code, 0);
    const base = fs.readFileSync(path.join(tmp, "scribe-output/c.enriched.json"), "utf8");

    const p = writePartial({
      concept: "c",
      vertices: [{ _key: keyOf("beta"), purpose: "new beta", tags: ["t"] }],
      edges: [],
    });
    assert.equal(run(["enrich", "merge", "c", p]).code, 0);
    const once = fs.readFileSync(path.join(tmp, "scribe-output/c.enriched.json"), "utf8");
    assert.equal(run(["enrich", "merge", "c", p]).code, 0);
    assert.equal(
      fs.readFileSync(path.join(tmp, "scribe-output/c.enriched.json"), "utf8"),
      once,
      "second merge is a no-op"
    );

    const doc = JSON.parse(once);
    const byName = (n: string) => doc.vertices.find((v: any) => v._key === keyOf(n));
    assert.equal(byName("beta").purpose, "new beta");
    assert.deepEqual(byName("beta").tags, ["t"]);
    assert.equal(byName("alpha").purpose, "old alpha");
    assert.equal(byName("alpha").hash_seen, ast().vertices.find((v: any) => v.name === "alpha").contentHash);
    assert.equal(doc.edges.length, ast().edges.length, "edge reasons survive");
    const keys = doc.vertices.map((v: any) => v._key);
    assert.deepEqual(keys, [...keys].sort());
    // only the touched vertex differs from the first merge
    const before = JSON.parse(base);
    const changed = doc.vertices.filter(
      (v: any, i: number) => JSON.stringify(v) !== JSON.stringify(before.vertices[i])
    );
    assert.deepEqual(
      changed.map((v: any) => v._key),
      [keyOf("beta")]
    );
  });

  it("rejects unknown keys and a wrong concept, writing nothing", () => {
    project();
    run(["extract", "c"]);
    const bad = run([
      "enrich",
      "merge",
      "c",
      writePartial({ concept: "c", vertices: [{ _key: "nope", purpose: "x" }], edges: [] }),
    ]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /nope/);
    assert.equal(fs.existsSync(path.join(tmp, "scribe-output/c.enriched.json")), false);
    const wrong = run(["enrich", "merge", "c", writePartial({ concept: "d", vertices: [], edges: [] })]);
    assert.notEqual(wrong.code, 0);
  });

  it("a later apply keeps descriptions and edge reasons from earlier merges", () => {
    project();
    run(["extract", "c"]);
    run(["enrich", "merge", "c", writePartial(partial("alpha", "adds one"))]);
    run(["enrich", "merge", "c", writePartial(partial("beta", "doubles alpha", "beta calls alpha"))]);
    assert.equal(run(["apply", "c", "--approve-drift"]).code, 0);
    assert.equal(storeVertex("alpha").purpose, "adds one");
    assert.equal(storeVertex("beta").purpose, "doubles alpha");
    const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"), { readOnly: true });
    const reasons = (db.prepare("SELECT doc FROM edges").all() as { doc: string }[])
      .map((r) => JSON.parse(r.doc).reason)
      .filter(Boolean);
    db.close();
    assert.ok(reasons.includes("beta calls alpha"));
  });
});

describe("staleness from hash_seen", () => {
  it("a body-only edit goes stale and a matching hash_seen clears it", () => {
    project();
    run(["extract", "c"]);
    run(["enrich", "merge", "c", writePartial(partial("alpha", "adds one"))]);
    run(["apply", "c", "--approve-drift"]);
    assert.equal(storeVertex("alpha").agent.stale, false);

    write("src/a.ts", "export function alpha(x: number): number {\n  return x + 5;\n}\n");
    run(["extract", "c"]);
    const dry = JSON.parse(run(["drift", "c", "--json"]).stdout);
    assert.deepEqual(
      dry.stale.map((v: any) => v.name),
      ["alpha"]
    );
    run(["apply", "c", "--approve-drift"]);
    assert.equal(storeVertex("alpha").agent.stale, true, "same signature, new body: stale");
    assert.deepEqual(
      targets()
        .filter((t: any) => t.name === "alpha")
        .map((t: any) => [t.name, t.reasons]),
      [["alpha", ["stale"]]]
    );

    run(["enrich", "merge", "c", writePartial(partial("alpha", "adds five"))]);
    assert.deepEqual(JSON.parse(run(["drift", "c", "--json"]).stdout).stale, []);
    run(["apply", "c", "--approve-drift"]);
    const v = storeVertex("alpha");
    assert.equal(v.agent.stale, false);
    assert.equal(v.purpose, "adds five");
    assert.equal(v.agent.hash_seen, v.contentHash);
  });

  it("legacy entries with only sig_seen are not mass-staled by a re-apply", () => {
    project();
    run(["extract", "c"]);
    const a = ast();
    write(
      "scribe-output/c.enriched.json",
      JSON.stringify({
        concept: "c",
        vertices: a.vertices.map((v: any) => ({ _key: v._key, purpose: `p ${v.name}`, sig_seen: v.signature })),
        edges: [],
      })
    );
    run(["apply", "c", "--approve-drift"]);
    run(["extract", "c"]);
    const r = run(["apply", "c", "--approve-drift"]);
    assert.equal(r.code, 0);
    assert.equal(storeVertex("alpha").agent.stale, false);
    assert.equal(storeVertex("beta").agent.stale, false);
    assert.deepEqual(JSON.parse(run(["drift", "c", "--json"]).stdout).stale, []);
  });
});
