// Layer 1 guard: the modules `skills status` imports statically (the unextracted-changes scan
// included) never reach typescript, ts-morph or node:sqlite. A static walk of the relative import graph
// from skills/commands.ts; lazy `await import(...)` calls (the optional store read) are not followed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = /^(typescript|ts-morph|@ts-morph\/.*|node:sqlite|sqlite)$/;

/** Specifiers of static `import ... from "x"` / `export ... from "x"` / `import "x"` (not `import(...)`, not `import type`). */
function staticImports(file: string): string[] {
  const text = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1]);
  return out;
}

function closure(entry: string): { files: Set<string>; bare: Set<string> } {
  const files = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of staticImports(f)) {
      if (spec.startsWith(".")) queue.push(path.resolve(path.dirname(f), spec.replace(/\.js$/, ".ts")));
      else bare.add(spec);
    }
  }
  return { files, bare };
}

describe("skills status import graph", () => {
  const { files, bare } = closure(path.join(SRC, "skills/commands.ts"));

  it("includes the unextracted-changes scan", () => {
    assert.ok([...files].some((f) => f.endsWith(path.join("scribe", "unextracted.ts"))));
  });

  it("reaches no typescript, ts-morph or sqlite import", () => {
    const bad = [...bare].filter((s) => FORBIDDEN.test(s));
    assert.deepEqual(bad, []);
  });

  it("never reaches the store, extractor or catalog modules", () => {
    const heavy = [...files].filter((f) => /[\\/](extract|catalog|db|bootstrap|apply|rows)\.ts$/.test(f));
    assert.deepEqual(heavy, []);
  });
});
