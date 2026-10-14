// Ported from maestro's packages/concept-skills/test/concept-skills.test.ts ("the agents list",
// "the concept-skills state file"), adapted to where code-graph keeps the state: a `skills` block of
// `<root>/scribe.config.json`, with maestro's `.claude/concept-skills.json` read as a field-by-field
// fallback and never written.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configPath,
  discoverProjectAgents,
  findConfigRoot,
  legacyStatePath,
  readAgentsList,
  readConceptSkillsState,
  readConcepts,
  resolveProjectRoot,
  writeAgentsList,
  writeConceptSkillsState,
} from "./state.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-skills-state-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readConfig = () => JSON.parse(fs.readFileSync(configPath(tmp), "utf8"));

function writeLegacy(body: unknown): void {
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.writeFileSync(legacyStatePath(tmp), typeof body === "string" ? body : JSON.stringify(body));
}

describe("the agents list", () => {
  it("reads the agents key of the skills block", () => {
    writeAgentsList(tmp, ["backend", "test"]);
    assert.deepEqual(readAgentsList(tmp), ["backend", "test"]);
    assert.deepEqual(readConfig().skills.agents, ["backend", "test"]);
  });

  it("is empty with no config or no key — which means 'write no agent notes'", () => {
    assert.deepEqual(readAgentsList(tmp), []);
    writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc" });
    assert.deepEqual(readAgentsList(tmp), []);
  });

  it("trims and de-duplicates, and ignores non-strings", () => {
    fs.writeFileSync(configPath(tmp), JSON.stringify({ project: "p", skills: { agents: [" a ", "a", 3, "", "b"] } }));
    assert.deepEqual(readAgentsList(tmp), ["a", "b"]);
    writeAgentsList(tmp, [" c ", "c", "d"]);
    assert.deepEqual(readConfig().skills.agents, ["c", "d"]);
  });

  it("is preserved by a state write, and preserves the state on an agents write", () => {
    writeAgentsList(tmp, ["backend"]);
    writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc" });
    assert.deepEqual(readAgentsList(tmp), ["backend"]);

    writeAgentsList(tmp, ["backend", "test"]);
    assert.deepEqual(readConceptSkillsState(tmp), {
      version: "1.0",
      last_update: "abc",
      source: "scribe.config.json",
    });
  });

  it("a block holding only agents reads as 'no list recorded'", () => {
    writeAgentsList(tmp, ["backend"]);
    assert.equal(readConceptSkillsState(tmp), null);
  });

  it("writes nothing when the list is unchanged", () => {
    assert.equal(writeAgentsList(tmp, ["a"]), true);
    assert.equal(writeAgentsList(tmp, ["a"]), false);
  });

  it("falls back to the legacy file's agents when the block has no agents key", () => {
    writeLegacy({ agents: ["legacy-agent"] });
    assert.deepEqual(readAgentsList(tmp), ["legacy-agent"]);
    fs.writeFileSync(configPath(tmp), JSON.stringify({ project: "p", skills: { version: "1.0", last_update: "x" } }));
    assert.deepEqual(readAgentsList(tmp), ["legacy-agent"]);
    // An explicit (even empty) block key wins over the legacy file.
    fs.writeFileSync(configPath(tmp), JSON.stringify({ project: "p", skills: { agents: [] } }));
    assert.deepEqual(readAgentsList(tmp), []);
  });

  it("discovers .claude/agents files and maestro.json agents_available, sorted", () => {
    assert.deepEqual(discoverProjectAgents(tmp), []);
    fs.mkdirSync(path.join(tmp, ".claude", "agents", "dir-agent"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".claude", "agents", "dir-agent", "AGENTS.md"), "x");
    fs.mkdirSync(path.join(tmp, ".claude", "agents", "not-an-agent"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".claude", "agents", "zed.md"), "x");
    fs.writeFileSync(
      path.join(tmp, ".claude", "maestro.json"),
      JSON.stringify({ agents_available: ["backend", "zed"] })
    );
    assert.deepEqual(discoverProjectAgents(tmp), ["backend", "dir-agent", "zed"]);
    assert.equal(fs.existsSync(configPath(tmp)), false, "discovery is read-only");
  });
});

describe("the skills block of scribe.config.json", () => {
  it("creates a config holding the project name and the block when there is none", () => {
    assert.equal(readConceptSkillsState(tmp), null);
    assert.equal(writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" }), true);
    assert.deepEqual(readConfig(), {
      project: path.basename(tmp),
      skills: { version: "1.0", last_update: "abc123" },
    });
    assert.equal(fs.existsSync(path.join(tmp, ".claude")), false, "no .claude/ is created");
    assert.deepEqual(readConceptSkillsState(tmp), {
      version: "1.0",
      last_update: "abc123",
      source: "scribe.config.json",
    });
  });

  it("keeps every other key of an existing config, in order", () => {
    const original = {
      project: "my-app",
      tsconfig: "tsconfig.json",
      concepts: { auth: { globs: ["src/auth/**"], skill: ".claude/skills/auth/SKILL.md" } },
      dbPath: "x.db",
    };
    fs.writeFileSync(configPath(tmp), JSON.stringify(original, null, 2) + "\n");
    writeConceptSkillsState(tmp, { version: "1.2", last_update: "beef" });
    const after = readConfig();
    assert.deepEqual(Object.keys(after), ["project", "tsconfig", "concepts", "dbPath", "skills"]);
    assert.deepEqual({ ...after, skills: undefined }, { ...original, skills: undefined });
    assert.deepEqual(after.skills, { version: "1.2", last_update: "beef" });
  });

  it("leaves maestro.json and the legacy file untouched", () => {
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    const mj = path.join(tmp, ".claude", "maestro.json");
    fs.writeFileSync(mj, '{"version":3}');
    writeLegacy('{"version":"1.0","last_update":"old","agents":["a"]}');

    writeConceptSkillsState(tmp, { version: "1.1", last_update: "new" });

    assert.equal(fs.readFileSync(mj, "utf8"), '{"version":3}');
    assert.equal(fs.readFileSync(legacyStatePath(tmp), "utf8"), '{"version":"1.0","last_update":"old","agents":["a"]}');
  });

  it("writes nothing when the value is already what it would write — byte-identical config", () => {
    writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" });
    const before = fs.readFileSync(configPath(tmp));
    assert.equal(writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" }), false);
    assert.ok(fs.readFileSync(configPath(tmp)).equals(before));
  });

  it("reads a malformed or half-written block as 'no list recorded'", () => {
    fs.writeFileSync(configPath(tmp), "{ not json");
    assert.equal(readConceptSkillsState(tmp), null);
    fs.writeFileSync(configPath(tmp), JSON.stringify({ skills: { version: "1.0" } }));
    assert.equal(readConceptSkillsState(tmp), null);
    fs.writeFileSync(configPath(tmp), JSON.stringify({ skills: ["not", "an", "object"] }));
    assert.equal(readConceptSkillsState(tmp), null);
  });

  it("refuses to overwrite a config that is not valid JSON, leaving it as it was", () => {
    fs.writeFileSync(configPath(tmp), '{ "project": "half-ed');
    assert.throws(() => writeConceptSkillsState(tmp, { version: "1.0", last_update: "x" }), /not valid JSON/);
    assert.throws(() => writeAgentsList(tmp, ["a"]), /refusing to overwrite/);
    assert.equal(fs.readFileSync(configPath(tmp), "utf8"), '{ "project": "half-ed');
  });

  it("refuses a config that is JSON but not an object", () => {
    fs.writeFileSync(configPath(tmp), "[1,2]");
    assert.throws(() => writeConceptSkillsState(tmp, { version: "1.0", last_update: "x" }), /not a JSON object/);
    assert.equal(fs.readFileSync(configPath(tmp), "utf8"), "[1,2]");
  });
});

describe("the legacy .claude/concept-skills.json fallback", () => {
  it("is read when the config has no skills block, and says so", () => {
    fs.writeFileSync(configPath(tmp), JSON.stringify({ project: "p" }));
    writeLegacy({ version: "2.3", last_update: "legacysha", agents: ["backend"] });
    assert.deepEqual(readConceptSkillsState(tmp), {
      version: "2.3",
      last_update: "legacysha",
      source: ".claude/concept-skills.json",
    });
    assert.deepEqual(readAgentsList(tmp), ["backend"]);
  });

  it("is read when there is no config at all", () => {
    writeLegacy({ version: "1.4", last_update: "x" });
    assert.equal(readConceptSkillsState(tmp)?.source, ".claude/concept-skills.json");
  });

  it("loses to a complete block", () => {
    writeLegacy({ version: "2.3", last_update: "legacysha" });
    fs.writeFileSync(configPath(tmp), JSON.stringify({ skills: { version: "3.0", last_update: "new" } }));
    assert.deepEqual(readConceptSkillsState(tmp), { version: "3.0", last_update: "new", source: "scribe.config.json" });
  });

  it("a malformed legacy file reads as 'no list recorded'", () => {
    writeLegacy("{ not json");
    assert.equal(readConceptSkillsState(tmp), null);
    writeLegacy({ version: "1.0" });
    assert.equal(readConceptSkillsState(tmp), null);
  });

  // The migration: the first write of the block carries the legacy agents over, so a repo moving
  // from maestro's plugin does not silently lose its agent-notes list.
  it("seeds the block's agents on the first write, and the block wins from then on", () => {
    fs.writeFileSync(configPath(tmp), JSON.stringify({ project: "p" }));
    writeLegacy({ version: "2.3", last_update: "legacysha", agents: ["backend", "test"] });

    assert.equal(writeConceptSkillsState(tmp, { version: "2.4", last_update: "newsha" }), true);
    assert.deepEqual(readConfig().skills, { version: "2.4", last_update: "newsha", agents: ["backend", "test"] });
    assert.equal(readConceptSkillsState(tmp)?.source, "scribe.config.json");

    // A later legacy edit no longer matters.
    writeLegacy({ version: "9.9", last_update: "ignored", agents: ["ignored"] });
    assert.equal(readConceptSkillsState(tmp)?.version, "2.4");
    assert.deepEqual(readAgentsList(tmp), ["backend", "test"]);
  });

  it("an agents write as the first write seeds the legacy version/last_update into the block", () => {
    writeLegacy({ version: "2.3", last_update: "legacysha", agents: ["old"] });
    writeAgentsList(tmp, ["new"]);
    assert.deepEqual(readConfig().skills, { version: "2.3", last_update: "legacysha", agents: ["new"] });
  });
});

describe("readConcepts", () => {
  it("loosely validates: skips entries without string-array globs", () => {
    fs.writeFileSync(
      configPath(tmp),
      JSON.stringify({
        concepts: {
          good: { globs: ["a/**", 3], skill: "s/SKILL.md" },
          noSkill: { globs: [] },
          bad: { globs: "a/**" },
          worse: null,
        },
      })
    );
    assert.deepEqual(readConcepts(tmp), {
      good: { globs: ["a/**"], skill: "s/SKILL.md" },
      noSkill: { globs: [] },
    });
  });

  it("is empty without a config or concepts", () => {
    assert.deepEqual(readConcepts(tmp), {});
  });
});

describe("resolveProjectRoot", () => {
  it("prefers --root, then CLAUDE_PROJECT_DIR, then cwd", () => {
    const a = fs.mkdtempSync(path.join(tmp, "a-"));
    const b = fs.mkdtempSync(path.join(tmp, "b-"));
    assert.equal(resolveProjectRoot(a, { CLAUDE_PROJECT_DIR: b }), a);
    assert.equal(resolveProjectRoot(undefined, { CLAUDE_PROJECT_DIR: b }), b);
    assert.equal(resolveProjectRoot(null, {}), findConfigRoot(process.cwd()) ?? process.cwd());
  });

  it("walks up to the nearest scribe.config.json ancestor", () => {
    fs.writeFileSync(configPath(tmp), "{}");
    const deep = path.join(tmp, "apps", "web", "src");
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(resolveProjectRoot(deep, {}), tmp);
    assert.equal(findConfigRoot(deep), tmp);

    // A nearer config wins over a farther one.
    fs.writeFileSync(path.join(tmp, "apps", "web", "scribe.config.json"), "{}");
    assert.equal(resolveProjectRoot(deep, {}), path.join(tmp, "apps", "web"));
  });

  it("is the starting directory itself when no config is above it", () => {
    // os.tmpdir() has no scribe.config.json above it on a sane machine.
    assert.equal(findConfigRoot(tmp), null);
    assert.equal(resolveProjectRoot(tmp, {}), tmp);
  });
});
