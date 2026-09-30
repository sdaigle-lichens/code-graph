// The full palette: nine vertex types and eleven edge types, each with a token in BOTH themes.
// This repo's own store only produces a few of them, so the rest are covered here, not by eye.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_TYPES, VERTEX_TYPES, SKILL_DOC_TYPE, edgeStyle, nodeStyle } from "../src/renderer/src/lib/graph-palette";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, rel), "utf8");
const scss = read("../../../packages/styles/scss/abstracts/_graph.scss");
const schema = read("../../../packages/code-graph/src/schema.ts");

function tokens(selector: string): Record<string, string> {
  const m = scss.match(new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\n\\}`));
  expect(m, `${selector} block`).toBeTruthy();
  return Object.fromEntries([...m![1]!.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((x) => [x[1]!, x[2]!]));
}
const enumOf = (name: string) =>
  [...schema.match(new RegExp(`${name} = z\\.enum\\(\\[([\\s\\S]*?)\\]\\)`))![1]!.matchAll(/"([^"]+)"/g)].map(
    (m) => m[1]
  );

const themes = { light: tokens(":root"), dark: tokens(".dark") };

describe("palette coverage", () => {
  it("lists exactly the schema's vertex and edge types", () => {
    expect([...VERTEX_TYPES]).toEqual(enumOf("VertexTypeEnum"));
    expect([...EDGE_TYPES]).toEqual(enumOf("EdgeTypeEnum"));
    expect(VERTEX_TYPES).toHaveLength(9);
    expect(EDGE_TYPES).toHaveLength(11);
  });

  for (const [theme, t] of Object.entries(themes)) {
    describe(theme, () => {
      it.each([...VERTEX_TYPES, SKILL_DOC_TYPE])("defines a colour for vertex type %s", (type) => {
        expect(t[`--vt-${type}`]).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
      it.each(EDGE_TYPES)("defines a colour for edge type %s", (type) => {
        expect(t[`--et-${type}`]).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
      it("gives every vertex type its own colour", () => {
        const used = VERTEX_TYPES.map((v) => t[`--vt-${v}`]);
        expect(new Set(used).size).toBe(used.length);
      });
      it("gives every edge type its own colour or dash pattern", () => {
        const used = EDGE_TYPES.map((e) => `${t[`--et-${e}`]}|${edgeStyle(e).dash}`);
        expect(new Set(used).size).toBe(used.length);
      });
    });
  }

  it("styles are token references only, never literal colours", () => {
    for (const v of [...VERTEX_TYPES, SKILL_DOC_TYPE, "unknown"]) {
      const s = nodeStyle(v);
      expect(s.stroke).toMatch(/^var\(--vt-[\w-]+\)$/);
      expect(s.fill).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
    for (const e of [...EDGE_TYPES, "unknown"]) expect(edgeStyle(e).stroke).toMatch(/^var\(--et-[\w-]+\)$/);
  });

  it("falls back to a defined token for a type the palette does not know", () => {
    expect(themes.light[nodeStyle("mystery").stroke.slice(4, -1)]).toBeDefined();
    expect(themes.light[edgeStyle("mystery").stroke.slice(4, -1)]).toBeDefined();
  });

  it("the tokens are imported by the shared stylesheet", () => {
    expect(read("../../../packages/styles/shared-styles.css")).toContain("abstracts/_graph.scss");
  });
});
