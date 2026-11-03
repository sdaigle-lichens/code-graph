// The uninstall skill must name every artefact the install skill adds, ask per item (default no),
// and list what it keeps on purpose.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skills = path.resolve(here, "../../../plugin/skills");
const uninstall = fs.readFileSync(path.join(skills, "code-graph-uninstall/SKILL.md"), "utf8");
const install = fs.readFileSync(path.join(skills, "code-graph-install/SKILL.md"), "utf8");

describe("code-graph-uninstall skill", () => {
  it("names each artefact install adds", () => {
    assert.match(install, /graph\.db\*/);
    assert.match(install, /allowRead/);
    assert.match(uninstall, /scribe-output\/graph\.db\*/);
    assert.match(uninstall, /sandbox\.filesystem\.allowRead/);
    assert.match(uninstall, /~\/\.cache\/code-graph\/deps/);
    assert.match(uninstall, /CLAUDE_PLUGIN_DATA/);
    assert.match(uninstall, /\.claude\/channels\/scribe\//);
    assert.match(uninstall, /other projects/);
  });

  it("asks one consent per item with default no", () => {
    assert.match(uninstall, /one question per item, default \*\*no\*\*/);
    assert.match(uninstall, /hook asks before a settings edit/);
  });

  it("lists what it keeps on purpose", () => {
    for (const kept of ["SKILL.md", "scribe.config.json", "scribe-output/", "tsconfig.code-graph.json"]) {
      assert.ok(uninstall.includes(kept), kept);
    }
  });
});
