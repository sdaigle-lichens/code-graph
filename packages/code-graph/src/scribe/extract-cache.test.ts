// `extract.ts` keeps one ts-morph Project per tsconfig for the life of the process, so a second
// extract in the same process reads the sources as they were when the Project was first built.
// `clearProjectCache()` is the documented way to drop that. Runs in-process against a one-file temp
// project (extract reads its config from process.cwd(), so the test changes into the project and back).
// ts-morph is not installed in the temp project: `extract.ts` imports it from this package's own
// node_modules, the same resolution the CLI uses. Nothing is installed and nothing is fetched.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearProjectCache, extract } from "./extract.js";

let tmp: string;
let prevCwd: string;
let prevEnv: string | undefined;

const ALPHA = "export function alpha(x: number): number {\n  return x + 1;\n}\n";
const GAMMA = "export function gamma(x: number): number {\n  return x * 3;\n}\n";

function write(rel: string, content: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** The vertex names extract wrote for concept `c`, sorted. */
function extractedNames(): string[] {
  const ast = JSON.parse(fs.readFileSync(path.join(tmp, "scribe-output/c.ast.json"), "utf8"));
  return ast.vertices.map((v: { name: string }) => v.name).sort();
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-extract-cache-")));
  write(
    "scribe.config.json",
    JSON.stringify({ project: "p", tsconfig: "tsconfig.json", concepts: { c: { globs: ["src/**/*.ts"] } } })
  );
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", strict: true }, include: ["src"] })
  );
  write("src/a.ts", ALPHA);
  prevCwd = process.cwd();
  prevEnv = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(prevCwd);
  if (prevEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = prevEnv;
  clearProjectCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("extract's per-process ts-morph Project cache", () => {
  it("a second extract in the same process sees an edited source only after clearProjectCache()", async () => {
    await extract("c");
    assert.deepEqual(extractedNames(), ["alpha"]);

    // Add gamma to the same file on disk, then extract again in the same process.
    write("src/a.ts", ALPHA + GAMMA);
    await extract("c");
    assert.deepEqual(extractedNames(), ["alpha"], "the cached Project still holds the file as first read");

    clearProjectCache();
    await extract("c");
    assert.deepEqual(extractedNames(), ["alpha", "gamma"], "after clearProjectCache() the edit is extracted");
  });
});
