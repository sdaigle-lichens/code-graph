// Ported from maestro's packages/concept-skills/test/concept-skills.test.ts ("parseFrontmatterMetadata").
//
// The reader that makes the whole marker scheme safe: `metadata.version` must be told apart from a
// top-level `version`, which the flattening `parseFrontmatter` cannot do.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, parseFrontmatterMetadata } from "./frontmatter.js";

const fm = (...lines: string[]) => ["---", ...lines, "---", "", "# Body"].join("\n");

describe("parseFrontmatterMetadata", () => {
  it("reads a block map", () => {
    const src = fm("name: x", "metadata:", "  type: concept-skill", '  version: "1.0"');
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill", version: "1.0" });
  });

  it("reads an inline flow map", () => {
    const src = fm("name: x", "metadata: { type: concept-skill, version: 1.0 }");
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill", version: "1.0" });
  });

  it("stops at the first dedented key rather than swallowing the rest", () => {
    const src = fm("metadata:", "  type: concept-skill", "description: not-metadata");
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill" });
  });

  it("skips blank lines inside the block", () => {
    const src = fm("metadata:", "  type: concept-skill", "", '  version: "2.1"');
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill", version: "2.1" });
  });

  it("is empty when there is no metadata, or when it isn't a map", () => {
    assert.deepEqual(parseFrontmatterMetadata(fm("name: x")), {});
    assert.deepEqual(parseFrontmatterMetadata(fm("metadata: just-a-string")), {});
    assert.deepEqual(parseFrontmatterMetadata("# no frontmatter"), {});
  });

  it("reads CRLF frontmatter", () => {
    const src = ["---", "name: x", "metadata:", "  type: concept-skill", '  version: "1.4"', "---", ""].join("\r\n");
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill", version: "1.4" });
  });

  it("differs from parseFrontmatter, which flattens the block", () => {
    const src = fm("name: x", "metadata:", "  type: concept-skill");
    assert.deepEqual(parseFrontmatter(src), { name: "x", metadata: "", type: "concept-skill" });
    assert.deepEqual(parseFrontmatterMetadata(src), { type: "concept-skill" });
  });
});

describe("parseFrontmatter", () => {
  it("strips one level of quotes and keeps everything after the first colon", () => {
    const src = fm('description: "How auth works: tokens."', "name: 'x'");
    assert.deepEqual(parseFrontmatter(src), { description: "How auth works: tokens.", name: "x" });
  });

  it("is empty without a leading frontmatter block", () => {
    assert.deepEqual(parseFrontmatter("# title\n---\nname: x\n---\n"), {});
  });
});
