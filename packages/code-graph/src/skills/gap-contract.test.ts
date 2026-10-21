// The scribe gap-file contract (`.claude/channels/scribe/<agent>.1.md`, one `{ "skill_gaps": [...] }`
// block) has no code owner, only markdown. maestro pins its parser against the shipped fixture, so
// the examples the skills show agents must keep matching it. If this fails, do not reword the skill
// to fit: the wording is a cross-repo contract (report it).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../../..");
const FIXTURE = path.join(REPO, "plugin/contracts/skill-gaps.example.json");
const SKILLS = ["scribe", "code-graph-retrieval"].map((s) => path.join(REPO, "plugin/skills", s, "SKILL.md"));

type GapFile = { skill_gaps: { skill: string; missing: string }[] };

/** Every `{ "skill_gaps": [...] }` example on a single line of the markdown (inline or fenced). */
function examples(file: string): GapFile[] {
  const out: GapFile[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/\{ "skill_gaps": \[.*\] \}/);
    if (m) out.push(JSON.parse(m[0]) as GapFile);
  }
  return out;
}

/** The shape: top-level keys, and per-entry keys. */
function shape(g: GapFile): unknown {
  return {
    top: Object.keys(g).sort(),
    entries: g.skill_gaps.map((e) => Object.keys(e).sort()),
  };
}

describe("the skill-gaps contract fixture", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as GapFile;

  it("is one valid gap file body with a string skill and missing", () => {
    assert.deepEqual(Object.keys(fixture), ["skill_gaps"]);
    assert.equal(fixture.skill_gaps.length, 1);
    assert.equal(typeof fixture.skill_gaps[0].skill, "string");
    assert.equal(typeof fixture.skill_gaps[0].missing, "string");
  });

  for (const file of SKILLS) {
    it(`${path.relative(REPO, file)} shows examples with the fixture's shape`, () => {
      const found = examples(file);
      assert.ok(found.length > 0, "no skill_gaps example found");
      for (const ex of found) assert.deepEqual(shape(ex), shape(fixture));
    });
  }

  it("the scribe skill names the channel path verbatim", () => {
    const body = fs.readFileSync(SKILLS[0], "utf8");
    assert.ok(body.includes(".claude/channels/scribe/<agent>.1.md"));
  });
});

describe("developer files stay out of plugin/", () => {
  it("has no CLAUDE.md or .claude/ under plugin/", async () => {
    const mod = (await import(path.join(REPO, "packages/code-graph/scripts/check-plugin-clean.mjs"))) as {
      findForbidden: (dir: string) => string[];
    };
    assert.deepEqual(mod.findForbidden(path.join(REPO, "plugin")), []);
  });
});
