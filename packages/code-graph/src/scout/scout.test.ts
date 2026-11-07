// The scout's pure parts: scope parsing, the split and its cap, and the parity with the bench's measured
// primer and prompt. The bench modules are imported from the repo (they are plain .mjs, no build needed).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMetricsPrimer, buildScopeBlock, crossImportEdges, findCycles, unusedExports } from "./primer.js";
import { scoutPrompt } from "./prompt.js";
import { findRepoRoot, MAX_FILES_PER_SESSION, MAX_SESSIONS, readScope, ScopeFileError, splitScope } from "./scope.js";
import { formatPlan } from "./run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const benchModule = path.resolve(here, "../../../../bench/refactor.mjs");
const names = (n: number, prefix = "f") =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}.ts`);
const chain = (files: string[]) => files.slice(1).map((f, i) => ({ from: files[i], to: f }));

describe("readScope", () => {
  let root: string;
  before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-scope-")));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "");
    fs.writeFileSync(path.join(root, "src", "b.ts"), "");
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  const scopeOf = (text: string) => {
    const file = path.join(root, "scope.txt");
    fs.writeFileSync(file, text);
    return readScope(file, root);
  };

  it("keeps existing files, sorted and deduped, across blank lines, CRLF and ./ prefixes", () => {
    const scope = scopeOf("src/b.ts\r\n\r\n  ./src/a.ts  \nsrc/a.ts\n");
    assert.deepEqual(scope, { files: ["src/a.ts", "src/b.ts"], skipped: [] });
  });

  it("names every bad line with its reason and keeps the good ones", () => {
    const scope = scopeOf(
      ["src/a.ts", "src/gone.ts", "src", "/etc/hosts", "../outside.ts", "src/../../x.ts"].join("\n")
    );
    assert.deepEqual(scope.files, ["src/a.ts"]);
    assert.deepEqual(scope.skipped, [
      { line: "src/gone.ts", reason: "no such file" },
      { line: "src", reason: "not a file" },
      { line: "/etc/hosts", reason: "absolute path" },
      { line: "../outside.ts", reason: "outside the repository" },
      { line: "src/../../x.ts", reason: "outside the repository" },
    ]);
  });

  it("treats a line with a NUL byte as a bad line, not a crash", () => {
    assert.deepEqual(scopeOf("a\0b\n").skipped, [{ line: "a\0b", reason: "no such file" }]);
  });

  it("returns an empty scope for an empty file", () => {
    assert.deepEqual(scopeOf(""), { files: [], skipped: [] });
  });

  it("throws ScopeFileError for a missing file and for a directory", () => {
    assert.throws(() => readScope(path.join(root, "absent.txt"), root), ScopeFileError);
    assert.throws(() => readScope(root, root), ScopeFileError);
  });
});

describe("readScope with the config in a subdirectory", () => {
  let repo: string;
  let config: string;
  before(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-mono-")));
    config = path.join(repo, "packages", "app");
    fs.mkdirSync(path.join(config, "src"), { recursive: true });
    fs.mkdirSync(path.join(repo, "packages", "other"));
    fs.writeFileSync(path.join(config, "src", "a.ts"), "");
    fs.writeFileSync(path.join(repo, "packages", "other", "b.ts"), "");
    fs.writeFileSync(path.join(repo, "README.md"), "");
    fs.writeFileSync(path.join(repo, "scope.txt"), "packages/app/src/a.ts\npackages/other/b.ts\nREADME.md\nsrc/a.ts\n");
  });
  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("resolves lines from the git root and names existing files outside the config root", () => {
    assert.deepEqual(readScope(path.join(repo, "scope.txt"), repo, config), {
      files: ["packages/app/src/a.ts"],
      skipped: [
        { line: "packages/other/b.ts", reason: "outside the config root packages/app" },
        { line: "README.md", reason: "outside the config root packages/app" },
        { line: "src/a.ts", reason: "no such file" },
      ],
    });
  });
});

describe("findRepoRoot", () => {
  let tmp: string;
  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-root-")));
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("finds the nearest .git, a directory or a worktree's file, and falls back to the start", () => {
    const nested = path.join(tmp, "repo", "packages", "app");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(findRepoRoot(nested), nested);
    fs.mkdirSync(path.join(tmp, "repo", ".git"));
    assert.equal(findRepoRoot(nested), path.join(tmp, "repo"));
    fs.writeFileSync(path.join(nested, ".git"), "gitdir: elsewhere\n");
    assert.equal(findRepoRoot(nested), nested);
  });
});

describe("splitScope", () => {
  const assertPartition = (input: string[], split: { sessions: string[][]; notScanned: string[] }) => {
    const all = [...split.sessions.flat(), ...split.notScanned].sort();
    assert.deepEqual(all, [...input].sort(), "every file lands exactly once");
    for (const s of split.sessions) assert.ok(s.length <= MAX_FILES_PER_SESSION, `${s.length} files in one session`);
    assert.ok(split.sessions.length <= MAX_SESSIONS);
  };

  it("cuts the smallest sessions, not the last ones opened", () => {
    // First fit opens the 6 + 5 session last, and it is the fullest: slicing in creation order would cut it.
    const groups = [7, 7, 7, 7, 7, 6, 5].map((size, i) => names(size, `g${i}-`));
    const files = groups.flat();
    const split = splitScope(files, groups.flatMap(chain));
    assertPartition(files, split);
    assert.deepEqual(
      split.sessions.map((s) => s.length),
      [11, 7, 7, 7, 7]
    );
    assert.deepEqual(split.sessions[0], [...groups[5], ...groups[6]]);
    assert.deepEqual(split.notScanned, groups[4], "of equal sessions, the one with the last first path goes");
  });

  it("states the caps the skill and the docs give", () => {
    assert.equal(MAX_FILES_PER_SESSION, 11);
    assert.equal(MAX_SESSIONS, 5);
  });

  it("keeps an empty scope empty", () => {
    assert.deepEqual(splitScope([], []), { sessions: [], notScanned: [] });
  });

  it("keeps a scope of 11 files in one session, links or not", () => {
    const files = names(11);
    assert.deepEqual(splitScope(files, []), { sessions: [files], notScanned: [] });
  });

  it("splits 12 files into sessions of at most 11", () => {
    const files = names(12);
    const split = splitScope(files, chain(files));
    assert.equal(split.sessions.length, 2);
    assertPartition(files, split);
  });

  it("keeps linked neighbourhoods together", () => {
    const a = names(8, "a");
    const b = names(8, "b");
    const split = splitScope([...a, ...b], [...chain(a), ...chain(b)]);
    assert.deepEqual(split.sessions, [a, b]);
  });

  it("follows import links in either direction", () => {
    const a = names(7, "a");
    const b = names(7, "b");
    const reversed = chain(a).map((e) => ({ from: e.to, to: e.from }));
    const split = splitScope([...a, ...b], [...reversed, ...chain(b)]);
    assert.deepEqual(split.sessions, [a, b]);
  });

  it("cuts a neighbourhood over 11 files along its links", () => {
    const hub = "hub.ts";
    const spokes = names(20);
    const split = splitScope(
      [hub, ...spokes],
      spokes.map((s) => ({ from: s, to: hub }))
    );
    assertPartition([hub, ...spokes], split);
    assert.equal(split.sessions[0].length, 11);
    assert.ok(split.sessions[0].includes(hub), "the first group grows from the best linked file");
  });

  it("packs unlinked files into shared sessions rather than one session each", () => {
    const files = names(22);
    const split = splitScope(files, []);
    assert.equal(split.sessions.length, 2);
    assertPartition(files, split);
  });

  it("ignores edges to files outside the scope and self imports", () => {
    const files = names(12);
    const split = splitScope(files, [
      { from: files[0], to: "elsewhere.ts" },
      { from: files[1], to: files[1] },
    ]);
    assertPartition(files, split);
  });

  it("names the files past the session cap instead of dropping them", () => {
    const files = names(70);
    const split = splitScope(files, []);
    assert.equal(split.sessions.length, MAX_SESSIONS);
    assert.equal(split.notScanned.length, 70 - MAX_SESSIONS * MAX_FILES_PER_SESSION);
    assertPartition(files, split);
  });

  it("is deterministic whatever the input order", () => {
    const files = names(30);
    const edges = chain(files);
    assert.deepEqual(splitScope([...files].reverse(), [...edges].reverse()), splitScope(files, edges));
  });
});

describe("primer", () => {
  it("finds cycles and self imports, and only those", () => {
    const edges = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "c" },
      { from: "d", to: "d" },
    ];
    assert.deepEqual(findCycles(edges), [["a", "b"], ["d"]]);
  });

  it("walks an import chain too deep for a recursive walk", () => {
    const deep = names(50_000);
    assert.deepEqual(findCycles(chain(deep)), []);
  });

  it("flags an export only another file does not mention, by whole word", () => {
    const sources = [
      { file: "a.ts", text: "export const used = 1; export const lonely = 2; lonely;" },
      { file: "b.ts", text: "import { used } from './a'; const lonelyish = 1; const $lonely = 2;" },
    ];
    assert.deepEqual(unusedExports([{ file: "a.ts", exports: ["used", "lonely"] }], sources), [
      { file: "a.ts", name: "lonely" },
    ]);
  });
});

describe("parity with the bench's measured text", () => {
  const entries = [
    { file: "src/b.ts", concept: "beta" },
    { file: "src/a.ts", concept: "" },
  ];
  const data = {
    files: [
      { file: "src/a.ts", concept: "alpha", fanIn: 7, fanOut: 2, exports: 3 },
      { file: "src/b.ts", concept: "", fanIn: 0, fanOut: 1, exports: 0 },
    ],
    hubs: ["src/a.ts"],
    cycles: [["src/a.ts", "src/b.ts"]],
    unused: [{ file: "src/a.ts", name: "lonely" }],
    crossEdges: [{ from: "src/a.ts", fromConcept: "alpha", to: "src/b.ts", toConcept: "beta" }],
    cross: [
      { a: "alpha", b: "beta", text: `# Cross: alpha ↔ beta\n\n${"- `alpha::f` --calls--> `beta::g`\n".repeat(20)}` },
      { a: "alpha", b: "gamma", text: "No cross-concept edges between alpha and gamma." },
    ],
  };
  const empty = { files: data.files, hubs: [], cycles: [], unused: [], crossEdges: [], cross: [] };

  it("builds the bench's primer and scope, byte for byte", async () => {
    const bench = await import(benchModule);
    assert.equal(buildMetricsPrimer(data), bench.buildMetricsPrimer(data));
    assert.equal(buildMetricsPrimer(empty), bench.buildMetricsPrimer(empty));
    assert.equal(buildScopeBlock(entries), bench.buildScope(entries));
  });

  it("finds the bench's cycles and unused exports on the same input", async () => {
    const bench = await import(benchModule);
    const edges = [
      { from: "z", to: "y" },
      { from: "y", to: "x" },
      { from: "x", to: "z" },
      { from: "x", to: "w" },
      { from: "w", to: "w" },
    ];
    assert.deepEqual(findCycles(edges), bench.findCycles(edges));
    const sources = [
      { file: "a.ts", text: "export const $one = 1, two_2 = 2, three = 3; const é = three;" },
      { file: "b.ts", text: "$one; xtwo_2; three.x" },
    ];
    const asked = [{ file: "a.ts", exports: ["$one", "two_2", "three", "absent"] }];
    assert.deepEqual(unusedExports(asked, sources), bench.unusedExports(asked, sources));
  });

  it("builds the prompt of the haiku-metrics-primer arm, naming no project", async () => {
    const bench = await import(benchModule);
    const measured = bench.refactorPrompt("haiku-metrics-primer", "2 files:\n- a.ts", "## Scope files\n- a.ts");
    assert.equal(
      scoutPrompt("2 files:\n- a.ts", "## Scope files\n- a.ts"),
      measured.replace("the maestro repository", "the repository")
    );
  });

  it("has the sections the bench's storedProblems requires of a primer", () => {
    const primer = buildMetricsPrimer(empty);
    for (const section of ["## Scope files", "## Import cycles", "## Exports of the scope files"]) {
      assert.ok(primer.includes(section), section);
    }
  });
});

describe("crossImportEdges", () => {
  it("keeps edges inside the scope between two named concepts, once, sorted", () => {
    const concepts: Record<string, string> = { "b.ts": "beta", "a.ts": "alpha", "c.ts": "alpha", "n.ts": "" };
    const edges = [
      { from: "b.ts", to: "a.ts" },
      { from: "a.ts", to: "b.ts" },
      { from: "a.ts", to: "b.ts" },
      { from: "a.ts", to: "c.ts" },
      { from: "a.ts", to: "n.ts" },
      { from: "a.ts", to: "out.ts" },
    ];
    const scope = new Set(["a.ts", "b.ts", "c.ts", "n.ts"]);
    assert.deepEqual(
      crossImportEdges(edges, scope, (f) => concepts[f]),
      [
        { from: "a.ts", fromConcept: "alpha", to: "b.ts", toConcept: "beta" },
        { from: "b.ts", fromConcept: "beta", to: "a.ts", toConcept: "alpha" },
      ]
    );
  });
});

describe("formatPlan", () => {
  const plan = {
    root: "/repo",
    scope: 0,
    sessions: [],
    notScanned: [],
    ignored: 0,
    skippedLines: [],
    nothingScanned: null,
    answers: null,
  };

  it("with no session states in one line that nothing was scanned, and never reads as a result", () => {
    const out = formatPlan({ ...plan, nothingScanned: "the scope file lists no files" });
    assert.match(out, /\nnothing scanned: the scope file lists no files; this is not a clean result[^\n]*$/);
    assert.doesNotMatch(out, /PROPOSALS/);
    assert.doesNotMatch(out, /^answers:/m, "no session, no answers file");
  });

  it("prints the answers file right after the root, before the sessions", () => {
    const out = formatPlan({
      ...plan,
      scope: 1,
      sessions: [{ prompt: "/p/session-1.md", files: ["a.ts"] }],
      answers: "/p/answers.md",
    });
    assert.match(out, /\nroot: \/repo\nanswers: \/p\/answers\.md\nsession 1: /);
  });

  it("says one file and one session", () => {
    const out = formatPlan({
      ...plan,
      scope: 1,
      ignored: 1,
      sessions: [{ prompt: "/p/session-1.md", files: ["a.ts"] }],
      notScanned: ["x.ts"],
    });
    assert.match(out, /^scout: 1 file in scope, 1 session \(/);
    assert.match(out, /^ignored: 1 file outside the code index$/m);
    assert.match(out, /^not scanned: 1 file past the session cap: x\.ts$/m);
  });

  it("names the root the paths are relative to", () => {
    assert.match(formatPlan(plan), /^root: \/repo$/m);
  });

  it("has one session line per session and no result of its own when there is one", () => {
    const out = formatPlan({
      ...plan,
      scope: 2,
      sessions: [{ prompt: "/p/session-1.md", files: ["a.ts", "b.ts"] }],
    });
    assert.match(out, /^session 1: \/p\/session-1\.md: a\.ts, b\.ts$/m);
    assert.doesNotMatch(out, /PROPOSALS|nothing scanned/);
  });

  it("names what was left out", () => {
    const out = formatPlan({
      ...plan,
      ignored: 3,
      notScanned: ["x.ts"],
      skippedLines: [{ line: "gone.ts", reason: "no such file" }],
    });
    assert.match(out, /^ignored: 3 files outside the code index$/m);
    assert.match(out, /^not scanned: 1 file past the session cap: x\.ts$/m);
    assert.match(out, /^skipped lines: 1: gone\.ts \(no such file\)$/m);
  });
});
