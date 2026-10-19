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
    // Lazy by default: no SKILL.md (empty core), never applied, so nothing is a target yet.
    const lazy = JSON.parse(run(["enrich", "targets", "c", "--json"]).stdout);
    assert.deepEqual(lazy.targets, []);
    assert.equal(lazy.core.leftOut, 2);
    const first = targets("--all");
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
    assert.deepEqual(full(), out, "--core is a no-op: core-first is the default");
    assert.equal(run(["enrich", "targets", "c"]).stdout, text, "same text with and without --core");
    const all = full("--all");
    assert.equal(all.targets.length, 2, "--all lists every never-enriched vertex");
    assert.equal(all.core.leftOut, 0);
    assert.deepEqual(full("--all", "--core"), all, "--all wins over --core");
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
    assert.match(out.core.message, /core is thin: 1 of 52 vertices are core/);
    assert.match(run(["enrich", "targets", "c", "--core"]).stdout, /core is thin/);
  });

  it("--vertex narrows to the named vertices, even outside the core, and does not count them as left out", () => {
    coreProject("# c\n\nEntry point is `alpha`.\n");
    const out = full("--core", "--vertex", "beta");
    assert.deepEqual(
      out.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [["beta", ["named"], false]]
    );
    assert.equal(out.core.leftOut, 0);
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

describe("enrich targets — lazy after the first touch", () => {
  const C_SRC = "export function gamma(): number {\n  return 3;\n}\n";
  const D_SRC = "export function delta(): number {\n  return 4;\n}\n";

  /** alpha is core (named in SKILL.md); beta, gamma, delta are non-core. Core enriched and applied. */
  function coreEnriched() {
    project();
    write(
      "scribe.config.json",
      JSON.stringify({
        project: "p",
        tsconfig: "tsconfig.json",
        concepts: { c: { globs: ["src/**/*.ts"], skill: "skills/c/SKILL.md" } },
      })
    );
    write("skills/c/SKILL.md", "# c\n\nEntry point is `alpha`.\n");
    write("src/c.ts", C_SRC);
    write("src/d.ts", D_SRC);
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(run(["apply", "c", "--approve-drift"]).code, 0);
    // first touch: core only
    assert.deepEqual(
      targets().map((t: any) => [t.name, t.reasons, t.core]),
      [["alpha", ["new"], true]]
    );
    assert.equal(run(["enrich", "merge", "c", writePartial(partial("alpha", "adds one"))]).code, 0);
    assert.equal(run(["apply", "c"]).code, 0);
  }
  const out = (...extra: string[]) => JSON.parse(run(["enrich", "targets", "c", "--json", ...extra]).stdout);

  it("lists no untouched never-enriched non-core vertex once the core is enriched, and counts them as leftOut", () => {
    coreEnriched();
    const o = out();
    assert.deepEqual(o.targets, []);
    assert.equal(o.core.size, 1);
    assert.equal(o.core.leftOut, 3);
    const text = run(["enrich", "targets", "c"]).stdout;
    assert.match(text, /0 vertices to enrich/);
    assert.match(text, /core: 1 vertices; 3 non-core new vertices left out/);
    assert.match(text, /--all lists them/);
    // the concept's first apply stamped nothing
    for (const n of ["beta", "gamma", "delta"]) assert.equal(storeVertex(n).agent.touched_at, undefined, n);
  });

  it("extract -> apply -> enrich targets lists a task-edited and a task-added non-core vertex as new", () => {
    coreEnriched();
    write("src/c.ts", C_SRC.replace("return 3", "return 33"));
    write("src/e.ts", "export function epsilon(): number {\n  return 5;\n}\n");
    assert.equal(run(["extract", "c"]).code, 0);
    // extract without apply already sees them (not in store / body differs)
    assert.deepEqual(
      out()
        .targets.map((t: any) => t.name)
        .sort(),
      ["epsilon", "gamma"]
    );
    assert.equal(run(["apply", "c"]).code, 0);
    assert.ok(storeVertex("gamma").agent.touched_at, "apply stamped the edited vertex");
    assert.ok(storeVertex("epsilon").agent.touched_at, "apply stamped the added vertex");
    assert.equal(storeVertex("beta").agent.touched_at, undefined, "untouched vertex not stamped");
    const expected = [
      ["gamma", ["new"], false],
      ["epsilon", ["new"], false],
    ];
    const o = out();
    assert.deepEqual(
      o.targets.map((t: any) => [t.name, t.reasons, t.core]),
      expected
    );
    assert.equal(o.core.leftOut, 2, "beta and delta stay left out");

    // a second plain apply (nothing changed) keeps them listed
    assert.equal(run(["extract", "c"]).code, 0);
    assert.equal(run(["apply", "c"]).code, 0);
    assert.deepEqual(
      out().targets.map((t: any) => [t.name, t.reasons, t.core]),
      expected
    );

    // enriching them clears them
    run(["enrich", "merge", "c", writePartial(partial("gamma", "returns 33"))]);
    run(["enrich", "merge", "c", writePartial(partial("epsilon", "returns 5"))]);
    run(["apply", "c"]);
    assert.deepEqual(out().targets, []);
  });

  it("treats a never-enriched vertex flagged stale by an older apply as touched (upgrade path)", () => {
    coreEnriched();
    const db = new DatabaseSync(path.join(tmp, "scribe-output/graph.db"));
    const key = keyOf("delta");
    const doc = JSON.parse((db.prepare("SELECT doc FROM vertices WHERE key = ?").get(key) as { doc: string }).doc);
    doc.agent = { ...doc.agent, stale: true };
    delete doc.agent.touched_at;
    db.prepare("UPDATE vertices SET doc = ? WHERE key = ?").run(JSON.stringify(doc), key);
    db.close();
    const o = out();
    assert.deepEqual(
      o.targets.map((t: any) => [t.name, t.reasons]),
      [["delta", ["new"]]]
    );
    assert.equal(o.core.leftOut, 2);
  });

  it("--all restores the every-never-enriched listing; --core is accepted and equals the default", () => {
    coreEnriched();
    const all = out("--all");
    assert.deepEqual(
      all.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [
        ["beta", ["new"], false],
        ["gamma", ["new"], false],
        ["delta", ["new"], false],
      ]
    );
    assert.equal(all.core.leftOut, 0);
    const def = run(["enrich", "targets", "c", "--json"]);
    const core = run(["enrich", "targets", "c", "--json", "--core"]);
    assert.equal(core.code, 0);
    assert.equal(core.stdout, def.stdout);
    assert.equal(run(["enrich", "targets", "c", "--core"]).stdout, run(["enrich", "targets", "c"]).stdout);
  });

  it("plain text shows each target's count of edges without a reason", () => {
    coreEnriched();
    const text = run(["enrich", "targets", "c", "--all"]).stdout;
    assert.match(text, /beta \(function\) src\/b\.ts:\d+-\d+ \[new,non-core\] — 1 edge without a reason/);
    assert.match(text, /gamma \(function\) src\/c\.ts:\d+-\d+ \[new,non-core\] — 0 edges without a reason/);
  });
});

describe("enrich targets --summary and --vertex on a 200+ vertex concept", () => {
  const N = 220;
  const CORE = 20;
  function bigProject() {
    write(
      "scribe.config.json",
      JSON.stringify({
        project: "p",
        tsconfig: "tsconfig.json",
        concepts: { c: { globs: ["src/**/*.ts"], skill: "skills/c/SKILL.md" } },
      })
    );
    write(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
    );
    // a call chain: every fn has one outbound calls edge (no hubs), the last calls nothing
    write(
      "src/many.ts",
      Array.from({ length: N }, (_, i) =>
        i < N - 1
          ? `export function fn${i}(): number {\n  return fn${i + 1}() + ${i};\n}\n`
          : `export function fn${i}(): number {\n  return ${i};\n}\n`
      ).join("")
    );
    const named = Array.from({ length: CORE }, (_, i) => `\`fn${i}\``).join(", ");
    write("skills/c/SKILL.md", `# c\n\nThe chain starts with ${named}.\n`);
    fs.symlinkSync(path.join(PKG, "node_modules"), path.join(tmp, "node_modules"), "dir");
    assert.equal(run(["extract", "c"]).code, 0);
  }
  const SUMMARY_KEYS = ["concept", "core", "counts", "edgesWithoutReason", "targets", "total"];
  const LINE_KEYS = ["core", "edgesWithoutReason", "key", "loc", "name", "reasons", "type"];

  it("--summary --json: per-reason counts, core block, edge total, one short line per target, a few KB", () => {
    bigProject();
    const r = run(["enrich", "targets", "c", "--summary", "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split("\n").length, 1, "single-line compact JSON");
    const bytes = Buffer.byteLength(r.stdout);
    assert.ok(bytes < 5000, `summary is ${bytes} bytes`);
    const s = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(s).sort(), SUMMARY_KEYS);
    assert.equal(s.concept, "c");
    assert.equal(s.total, CORE);
    assert.deepEqual(s.counts, { new: CORE, changed: 0, stale: 0, named: 0 });
    assert.deepEqual(s.core, { size: CORE, leftOut: N - CORE, thin: false });
    assert.equal(s.targets.length, CORE);
    for (const t of s.targets) {
      assert.deepEqual(Object.keys(t).sort(), LINE_KEYS);
      assert.match(t.loc, /^src\/many\.ts:\d+-\d+$/);
      assert.deepEqual(t.reasons, ["new"]);
      assert.equal(t.core, true);
      assert.equal(t.edgesWithoutReason, 1);
    }
    assert.equal(s.edgesWithoutReason, CORE);
    assert.doesNotMatch(r.stdout, /signature|purpose|"to"|toName/, "no signatures, purposes or edge arrays");

    // the full listing is much bigger than the summary
    const fullBytes = Buffer.byteLength(run(["enrich", "targets", "c", "--json"]).stdout);
    assert.ok(fullBytes > bytes * 2, `full ${fullBytes} vs summary ${bytes}`);

    // --all --summary: every vertex, still no edge arrays
    const all = JSON.parse(run(["enrich", "targets", "c", "--all", "--summary", "--json"]).stdout);
    assert.equal(all.total, N);
    assert.equal(all.targets.length, N);
    assert.equal(all.core.leftOut, 0);
    assert.equal(all.counts.new, N);
    assert.equal(all.edgesWithoutReason, N - 1);
    assert.ok(all.targets.every((t: any) => typeof t.edgesWithoutReason === "number"));
  });

  it("--summary text: header counts, core line, edge total and one line per target", () => {
    bigProject();
    const text = run(["enrich", "targets", "c", "--summary"]).stdout;
    const lines = text.trimEnd().split("\n");
    assert.match(
      lines[0],
      new RegExp(`^Concept: c — ${CORE} vertices to enrich \\(new ${CORE}, changed 0, stale 0, named 0\\)$`)
    );
    assert.match(text, new RegExp(`core: ${CORE} vertices; ${N - CORE} non-core new vertices left out`));
    assert.match(text, new RegExp(`edges without a reason: ${CORE}\\b`));
    const targetLines = lines.filter((l) => /^ {2}[0-9a-f]{8,} fn\d+ \(function\) /.test(l));
    assert.equal(targetLines.length, CORE);
    for (const l of targetLines) {
      assert.match(l, /fn\d+ \(function\) src\/many\.ts:\d+-\d+ \[new,core\] — 1 edge without a reason$/);
    }
    assert.ok(Buffer.byteLength(text) < 5000, `text summary is ${Buffer.byteLength(text)} bytes`);
  });

  it("--json --vertex returns full details for just those vertices", () => {
    bigProject();
    const k150 = keyOf("fn150");
    const o = JSON.parse(run(["enrich", "targets", "c", "--json", "--vertex", "fn5", k150]).stdout);
    assert.deepEqual(
      o.targets.map((t: any) => [t.name, t.reasons, t.core]),
      [
        ["fn5", ["new", "named"], true],
        ["fn150", ["named"], false],
      ]
    );
    for (const t of o.targets) {
      assert.match(t.signature, new RegExp(t.name));
      assert.equal(t.purpose, null);
      assert.equal(typeof t.start_line, "number");
      assert.ok(Array.isArray(t.edgesWithoutReason));
      assert.equal(t.edgesWithoutReason.length, 1);
    }
    assert.equal(o.targets[1].edgesWithoutReason[0].toName, "fn151");
    assert.equal(o.core.leftOut, N - CORE - 1, "a named vertex is not left out");

    // --vertex with --summary summarises just the named ones
    const s = JSON.parse(run(["enrich", "targets", "c", "--summary", "--json", "--vertex", "fn150"]).stdout);
    assert.equal(s.total, 1);
    assert.deepEqual(s.counts, { new: 0, changed: 0, stale: 0, named: 1 });
    assert.equal(s.targets[0].name, "fn150");

    const bad = run(["enrich", "targets", "c", "--json", "--vertex", "noSuchFn"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /noSuchFn/);
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
