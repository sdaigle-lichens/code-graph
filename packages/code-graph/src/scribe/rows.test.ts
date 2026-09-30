import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toDoc, toDocs, vertexId, docKey, docId, keyOf, toMatchExpr } from "./rows.js";

describe("document handles", () => {
  it("builds and splits vertex handles", () => {
    assert.equal(vertexId("abc123"), "vertices/abc123");
    assert.equal(keyOf("vertices/abc123"), "abc123");
  });

  it("keeps `::` intact in doc keys", () => {
    assert.equal(docKey("workorder-store"), "workorder-store::skill");
    assert.equal(docId("workorder-store"), "docs/workorder-store::skill");
    assert.equal(keyOf("docs/workorder-store::skill"), "workorder-store::skill");
  });

  it("returns a bare key unchanged", () => {
    assert.equal(keyOf("abc123"), "abc123");
  });
});

describe("doc column unwrapping", () => {
  it("round-trips a document", () => {
    const v = { _key: "k", name: "setIndex", tags: ["store"], document_ref: null };
    assert.deepEqual(toDoc({ doc: JSON.stringify(v) }), v);
  });

  it("returns null for a missing row", () => {
    assert.equal(toDoc(undefined), null);
  });

  it("preserves an explicit null distinctly from an absent key", () => {
    const parsed = toDoc<Record<string, unknown>>({
      doc: '{"document_ref":null}',
    })!;
    assert.equal(parsed.document_ref, null);
    assert.ok("document_ref" in parsed);
    assert.ok(!("purpose" in parsed));
  });

  it("maps a row set", () => {
    assert.deepEqual(toDocs([{ doc: '{"a":1}' }, { doc: '{"a":2}' }]), [{ a: 1 }, { a: 2 }]);
  });
});

describe("toMatchExpr", () => {
  it("ORs the surviving tokens, each quoted", () => {
    assert.equal(toMatchExpr("workorder store"), '"workorder" OR "store"');
  });

  it("strips stopwords from a natural-language query", () => {
    // The whole point: `why`, `does`, `the` would otherwise carry BM25 mass
    // and match long skill bodies far more often than short vertex names.
    assert.equal(
      toMatchExpr("why does setWorkorderIndex re-index the whole array"),
      '"setworkorderindex" OR "re" OR "index" OR "whole" OR "array"'
    );
  });

  it("quotes FTS5 operator words so they match literally", () => {
    assert.equal(toMatchExpr("near AND or"), '"near"');
  });

  it("splits on punctuation rather than treating it as syntax", () => {
    assert.equal(toMatchExpr("gantt-render: drag*"), '"gantt" OR "render" OR "drag"');
  });

  it("de-duplicates repeated tokens", () => {
    assert.equal(toMatchExpr("store store STORE"), '"store"');
  });

  it("returns null when nothing survives", () => {
    assert.equal(toMatchExpr("the a of"), null);
    assert.equal(toMatchExpr("   "), null);
    assert.equal(toMatchExpr("!!!"), null);
  });

  it("keeps short but meaningful tokens", () => {
    assert.equal(toMatchExpr("db ui"), '"db" OR "ui"');
  });
});
