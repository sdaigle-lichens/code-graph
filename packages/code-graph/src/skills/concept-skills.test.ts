// Ported from maestro's packages/concept-skills/test/concept-skills.test.ts.
//
// Two properties carry the whole feature and neither is visible from a passing type-check:
//
//   1. DISCOVERY REACHES THE WHOLE TREE. A concept skill lives beside the code it explains, so in a
//      monorepo most of them are under `apps/*/.claude/skills`, not the root's. A fixture with a
//      nested skill is the only thing that can tell a tree walk from a one-directory read.
//
//   2. STAMPING IS A LINE REWRITE. The body of a concept skill is the point of the file. If a stamp
//      ever round-trips it through a YAML emitter the damage is silent and cumulative, so the
//      assertions are byte equality of everything else — and a re-stamp with the same values must
//      not touch the file at all.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bumpMajor,
  bumpMinor,
  discoverConceptSkills,
  findConceptSkill,
  nextVersion,
  parseVersion,
  resolveSkillPath,
  stampConceptSkill,
} from "./concept-skills.js";
import { MAX_DEPTH, skillSearchDirs } from "./fs-scan.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-concepts-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSkill(relDir: string, frontmatter: string, body = "# Body\n\nProse.\n"): string {
  const dir = path.join(tmp, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "SKILL.md");
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n\n${body}`);
  return p;
}

const CONCEPT = [
  "name: auth-flow",
  'description: "How auth works."',
  "metadata:",
  "  type: concept-skill",
  '  version: "1.3"',
  "  last-update: abc123",
].join("\n");

describe("version arithmetic", () => {
  it("bumps minor and major independently", () => {
    assert.equal(bumpMinor("1.3"), "1.4");
    assert.equal(bumpMajor("1.3"), "2.0");
    assert.equal(bumpMajor("2.9"), "3.0");
    assert.equal(bumpMinor("1.9"), "1.10");
  });

  // A hand-edited or missing version must never stop a scan of the whole repo.
  it("reads a malformed or missing version as 1.0", () => {
    assert.deepEqual(parseVersion(undefined), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion(null), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion(""), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion("v2"), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 0 });
    assert.deepEqual(parseVersion(" 4.7 "), { major: 4, minor: 7 });
    assert.equal(bumpMinor("nonsense"), "1.1");
    assert.equal(bumpMajor(undefined), "2.0");
  });

  it("nextVersion maps a bump name, and null for an unknown one", () => {
    assert.equal(nextVersion("1.3", "minor"), "1.4");
    assert.equal(nextVersion("1.3", "major"), "2.0");
    assert.equal(nextVersion("7.2", "initial"), "1.0");
    assert.equal(nextVersion(null, "minor"), "1.1");
    assert.equal(nextVersion("1.3", "patch"), null);
    assert.equal(nextVersion("1.3", null), null);
  });
});

describe("discoverConceptSkills", () => {
  it("finds a skill in a NESTED .claude, not just the root's", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const found = await discoverConceptSkills(tmp);
    assert.deepEqual(
      found.map((s) => s.id),
      ["auth-flow"]
    );
    assert.equal(found[0].version, "1.3");
    assert.equal(found[0].lastUpdate, "abc123");
    assert.equal(found[0].description, "How auth works.");
    assert.equal(found[0].skillPath, path.join(tmp, "apps/web/.claude/skills/auth-flow/SKILL.md"));
  });

  it("finds root and several nested skills together, sorted by path", async () => {
    writeSkill("packages/z/.claude/skills/zeta", CONCEPT.replace("auth-flow", "zeta"));
    writeSkill(".claude/skills/root-one", CONCEPT.replace("auth-flow", "root-one"));
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const found = await discoverConceptSkills(tmp);
    const paths = found.map((s) => s.skillPath);
    assert.deepEqual(
      paths,
      [...paths].sort((a, b) => a.localeCompare(b))
    );
    assert.deepEqual(found.map((s) => s.id).sort(), ["auth-flow", "root-one", "zeta"]);
  });

  it("skips node_modules / dist and other ignored directories", async () => {
    writeSkill("node_modules/pkg/.claude/skills/vendored", CONCEPT.replace("auth-flow", "vendored"));
    writeSkill("dist/.claude/skills/built", CONCEPT.replace("auth-flow", "built"));
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    assert.deepEqual(
      (await discoverConceptSkills(tmp)).map((s) => s.id),
      ["auth-flow"]
    );
  });

  it("stops descending past MAX_DEPTH", () => {
    // depth 0 = a direct child of root; MAX_DEPTH + 1 nested dirs is one past the cap.
    const deep = Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `d${i}`).join("/");
    fs.mkdirSync(path.join(tmp, deep, ".claude", "skills"), { recursive: true });
    const ok = Array.from({ length: MAX_DEPTH + 1 }, (_, i) => `d${i}`).join("/");
    fs.mkdirSync(path.join(tmp, ok, ".claude", "skills"), { recursive: true });
    assert.deepEqual(skillSearchDirs(tmp), [path.join(tmp, ok, ".claude", "skills")]);
  });

  it("ignores a skill with no concept-skill marker", async () => {
    writeSkill(".claude/skills/plain", 'name: plain\ndescription: "Ordinary."');
    writeSkill(".claude/skills/other", 'name: other\ndescription: "x."\nmetadata:\n  type: something-else');
    // A top-level `type:` is not the marker — only `metadata.type` is.
    writeSkill(".claude/skills/flat", 'name: flat\ntype: concept-skill\nversion: "9.9"');
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    assert.deepEqual(
      (await discoverConceptSkills(tmp)).map((s) => s.id),
      ["auth-flow"]
    );
  });

  it("falls back to the directory name when the frontmatter has no name", async () => {
    writeSkill(".claude/skills/nameless", "metadata:\n  type: concept-skill");
    const [s] = await discoverConceptSkills(tmp);
    assert.equal(s.id, "nameless");
    assert.equal(s.version, "1.0");
    assert.equal(s.lastUpdate, "");
  });

  it("counts the sub-concept and agent-note files", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const dir = path.join(tmp, "apps/web/.claude/skills/auth-flow");
    fs.mkdirSync(path.join(dir, "sub-concepts"));
    fs.writeFileSync(path.join(dir, "sub-concepts", "tokens.md"), "x");
    fs.writeFileSync(path.join(dir, "sub-concepts", "sessions.md"), "x");
    fs.writeFileSync(path.join(dir, "sub-concepts", "notes.txt"), "not markdown");
    fs.mkdirSync(path.join(dir, "agents"));
    fs.writeFileSync(path.join(dir, "agents", "backend.md"), "x");

    const [skill] = await discoverConceptSkills(tmp);
    assert.deepEqual(skill.subConcepts, ["sessions.md", "tokens.md"]);
    assert.deepEqual(skill.agentNotes, ["backend.md"]);
  });

  it("finds a skill by id or by directory", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    assert.equal((await findConceptSkill(tmp, "auth-flow"))?.id, "auth-flow");
    assert.equal((await findConceptSkill(tmp, "apps/web/.claude/skills/auth-flow"))?.id, "auth-flow");
    assert.equal((await findConceptSkill(tmp, "apps/web/.claude/skills/auth-flow/SKILL.md"))?.id, "auth-flow");
    assert.equal(await findConceptSkill(tmp, "nope"), null);
  });
});

// The create flow's commonest call is "stamp the skill I wrote thirty seconds ago", which is not a
// concept skill YET — so `findConceptSkill` cannot see it.
describe("resolveSkillPath", () => {
  it("finds an UNMARKED skill by id, anywhere in the tree", async () => {
    const p = writeSkill("apps/api/.claude/skills/job-queue", 'name: job-queue\ndescription: "Queue."');
    assert.equal(await resolveSkillPath(tmp, "job-queue"), p);
  });

  it("finds a skill whose frontmatter name differs from its directory", async () => {
    const p = writeSkill("apps/api/.claude/skills/queue-dir", 'name: job-queue\ndescription: "Queue."');
    assert.equal(await resolveSkillPath(tmp, "job-queue"), p);
    assert.equal(await resolveSkillPath(tmp, "queue-dir"), p);
  });

  it("accepts a directory or a file path too", async () => {
    const p = writeSkill("apps/api/.claude/skills/job-queue", 'name: job-queue\ndescription: "Queue."');
    assert.equal(await resolveSkillPath(tmp, "apps/api/.claude/skills/job-queue"), p);
    assert.equal(await resolveSkillPath(tmp, "apps/api/.claude/skills/job-queue/SKILL.md"), p);
  });

  it("returns null rather than a path that was never going to exist", async () => {
    assert.equal(await resolveSkillPath(tmp, "nope"), null);
  });
});

describe("stampConceptSkill", () => {
  it("changes ONLY the version and last-update lines", () => {
    const p = writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const before = fs.readFileSync(p, "utf8");

    assert.equal(stampConceptSkill(p, { version: "2.0", lastUpdate: "deadbeef" }), true);

    const after = fs.readFileSync(p, "utf8");
    const beforeLines = before.split("\n");
    const afterLines = after.split("\n");
    assert.equal(afterLines.length, beforeLines.length);
    const changed = afterLines.filter((line, i) => line !== beforeLines[i]);
    assert.deepEqual(changed, ['  version: "2.0"', "  last-update: deadbeef"]);
  });

  it("leaves the body byte-identical, including a description with a colon in it", () => {
    const p = writeSkill(
      "apps/web/.claude/skills/auth-flow",
      [
        "name: auth-flow",
        'description: "How auth works: tokens, sessions, and the bit that bites."',
        "metadata:",
        "  type: concept-skill",
        '  version: "1.0"',
        "  last-update: abc123",
      ].join("\n"),
      "# Auth Flow\n\n---\n\n```ts\nconst x: number = 1;\n```\n\nmetadata: not frontmatter\n\nTrailing prose.\n"
    );
    const bodyOf = (s: string) => s.slice(s.indexOf("\n---", 4));
    const before = bodyOf(fs.readFileSync(p, "utf8"));

    stampConceptSkill(p, { version: "1.1", lastUpdate: "cafe01" });

    const after = fs.readFileSync(p, "utf8");
    assert.equal(bodyOf(after), before);
    assert.ok(after.includes('description: "How auth works: tokens, sessions, and the bit that bites."'));
  });

  // The create flow's normal case: the skill it just wrote carries no marker yet.
  it("creates the metadata block on a skill that has none", async () => {
    const p = writeSkill(".claude/skills/plain", 'name: plain\ndescription: "Ordinary."');
    const before = fs.readFileSync(p, "utf8");
    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" }), true);
    const after = fs.readFileSync(p, "utf8");
    assert.equal(
      after,
      before.replace(
        'description: "Ordinary."\n',
        'description: "Ordinary."\nmetadata:\n  type: concept-skill\n  version: "1.0"\n  last-update: cafe01\n'
      )
    );
    const [found] = await discoverConceptSkills(tmp);
    assert.equal(found.id, "plain");
    assert.equal(found.version, "1.0");
    assert.equal(found.lastUpdate, "cafe01");
  });

  // The map is the USER's — a stamp that quietly dropped a sibling key would be hard to notice.
  it("keeps metadata keys that are not ours, and the block's own indentation", async () => {
    const p = writeSkill(
      ".claude/skills/plain",
      [
        "name: plain",
        'description: "x"',
        "metadata:",
        "    owner: platform-team",
        "    type: concept-skill",
        "allowed-tools: Read",
      ].join("\n")
    );
    stampConceptSkill(p, { version: "2.0", lastUpdate: "cafe01" });
    const after = fs.readFileSync(p, "utf8");
    assert.ok(after.includes("    owner: platform-team"));
    assert.ok(after.includes('    version: "2.0"'));
    assert.ok(after.includes("    last-update: cafe01"));
    // The key after the block stays after it, and outside it.
    assert.match(after, /last-update: cafe01\nallowed-tools: Read\n---/);
    assert.equal((await discoverConceptSkills(tmp))[0].version, "2.0");
  });

  it("converts an inline metadata map to a block, carrying its keys over", async () => {
    const p = writeSkill(
      ".claude/skills/plain",
      ["name: plain", 'description: "x"', "metadata: { owner: platform-team }"].join("\n")
    );
    stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" });
    const after = fs.readFileSync(p, "utf8");
    assert.ok(after.includes("  owner: platform-team"));
    assert.ok(!after.includes("metadata: {"));
    assert.equal((await discoverConceptSkills(tmp))[0].version, "1.0");
  });

  it("is idempotent: no duplicated keys on a re-stamp", async () => {
    const p = writeSkill(".claude/skills/plain", 'name: plain\ndescription: "x"');
    stampConceptSkill(p, { version: "1.0", lastUpdate: "a" });
    stampConceptSkill(p, { version: "1.1", lastUpdate: "b" });
    const after = fs.readFileSync(p, "utf8");
    assert.equal(after.match(/type: concept-skill/g)?.length, 1);
    assert.equal(after.match(/version:/g)?.length, 1);
    assert.equal(after.match(/last-update:/g)?.length, 1);
    assert.equal((await discoverConceptSkills(tmp))[0].version, "1.1");
  });

  it("is byte-identical on a re-stamp with the same values, and reports it did not write", () => {
    const p = writeSkill(".claude/skills/plain", 'name: plain\ndescription: "x"', "# Body\n\nNo trailing newline");
    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "a" }), true);
    const once = fs.readFileSync(p);
    const mtime = fs.statSync(p).mtimeMs;

    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "a" }), false);
    assert.ok(fs.readFileSync(p).equals(once), "second identical stamp must leave the bytes unchanged");
    assert.equal(fs.statSync(p).mtimeMs, mtime, "second identical stamp must not rewrite the file");

    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "a" }), false);
    assert.ok(fs.readFileSync(p).equals(once));
  });

  it("is byte-identical when the existing marker already holds the stamped values", () => {
    const p = writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const before = fs.readFileSync(p);
    assert.equal(stampConceptSkill(p, { version: "1.3", lastUpdate: "abc123" }), false);
    assert.ok(fs.readFileSync(p).equals(before));
  });

  it("is byte-identical on a CRLF file re-stamped with the same values", () => {
    const dir = path.join(tmp, ".claude/skills/crlf");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    const raw =
      '---\r\nname: crlf\r\nmetadata:\r\n  type: concept-skill\r\n  version: "1.0"\r\n  last-update: a\r\n---\r\n\r\nbody\r\n';
    fs.writeFileSync(p, raw);
    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "a" }), false);
    assert.equal(fs.readFileSync(p, "utf8"), raw);
  });

  // Every line must end in \r\n: no bare \n anywhere, i.e. every \n is preceded by \r.
  const assertAllCrlf = (s: string) => {
    assert.equal(s.match(/(?<!\r)\n/g), null, `bare LF found in ${JSON.stringify(s)}`);
    assert.ok(s.endsWith("\r\n"));
  };

  it("keeps CRLF on every line when a CRLF file is stamped with new values", async () => {
    const dir = path.join(tmp, ".claude/skills/crlf");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    const body = "\r\n# Body\r\n\r\n---\r\n\r\nProse.\r\n";
    const raw =
      '---\r\nname: crlf\r\ndescription: "x: y"\r\nmetadata:\r\n  type: concept-skill\r\n  version: "1.0"\r\n  last-update: a\r\n---\r\n' +
      body;
    fs.writeFileSync(p, raw);

    assert.equal(stampConceptSkill(p, { version: "1.1", lastUpdate: "b" }), true);

    const after = fs.readFileSync(p, "utf8");
    assertAllCrlf(after);
    assert.equal(
      after,
      '---\r\nname: crlf\r\ndescription: "x: y"\r\nmetadata:\r\n  type: concept-skill\r\n  version: "1.1"\r\n  last-update: b\r\n---\r\n' +
        body
    );
    assert.ok(after.endsWith(`---\r\n${body}`), "body bytes after the closing --- must be unchanged");
    const [found] = await discoverConceptSkills(tmp);
    assert.equal(found.version, "1.1");
    assert.equal(found.lastUpdate, "b");

    // And the CRLF result is itself a fixed point.
    assert.equal(stampConceptSkill(p, { version: "1.1", lastUpdate: "b" }), false);
    assert.equal(fs.readFileSync(p, "utf8"), after);
  });

  it("appends a missing metadata block with CRLF endings on a CRLF file", async () => {
    const dir = path.join(tmp, ".claude/skills/crlf-plain");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    const raw = '---\r\nname: crlf-plain\r\ndescription: "Ordinary."\r\n---\r\n\r\nbody\r\n';
    fs.writeFileSync(p, raw);

    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" }), true);

    const after = fs.readFileSync(p, "utf8");
    assertAllCrlf(after);
    assert.equal(
      after,
      '---\r\nname: crlf-plain\r\ndescription: "Ordinary."\r\nmetadata:\r\n  type: concept-skill\r\n  version: "1.0"\r\n  last-update: cafe01\r\n---\r\n\r\nbody\r\n'
    );
    const [found] = await discoverConceptSkills(tmp);
    assert.equal(found.id, "crlf-plain");
    assert.equal(found.version, "1.0");
    assert.equal(found.lastUpdate, "cafe01");

    assert.equal(stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" }), false);
    assert.equal(fs.readFileSync(p, "utf8"), after);
  });

  it("refuses a file with no frontmatter rather than prepending one", () => {
    const dir = path.join(tmp, ".claude/skills/broken");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    fs.writeFileSync(p, "# No frontmatter here\n");
    assert.throws(() => stampConceptSkill(p, { version: "1.0", lastUpdate: "x" }), /no frontmatter/);
    assert.equal(fs.readFileSync(p, "utf8"), "# No frontmatter here\n");
  });
});
