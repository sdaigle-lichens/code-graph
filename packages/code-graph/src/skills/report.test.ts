// `skills check` and `skills status` against real fixtures: a temp project tree and, for status, a
// real git repository with real commits. Nothing is stubbed — the git window is whatever
// `git rev-list` / `git diff` say it is.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkConceptSkills, conceptSkillsStatus, gitWindow } from "./report.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-skills-report-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function marked(name: string, lastUpdate = "", version = "1.0"): string {
  return [
    "---",
    `name: ${name}`,
    'description: "x"',
    "metadata:",
    "  type: concept-skill",
    `  version: "${version}"`,
    `  last-update: ${lastUpdate}`,
    "---",
    "",
    "# Body",
    "",
  ].join("\n");
}

const unmarked = (name: string) => `---\nname: ${name}\ndescription: "x"\n---\n\n# Body\n`;

function config(concepts: Record<string, { globs: string[]; skill?: string }>, extra: object = {}): void {
  write("scribe.config.json", JSON.stringify({ project: "p", concepts, ...extra }, null, 2));
}

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", tmp, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
}

function commitAll(msg: string): string {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
}

describe("checkConceptSkills", () => {
  it("is ok when every concept has its marked skill, by name or by declared path", async () => {
    config({
      auth: { globs: ["src/auth/**"] },
      billing: { globs: ["src/billing/**"], skill: "apps/web/.claude/skills/billing/SKILL.md" },
    });
    write(".claude/skills/auth/SKILL.md", marked("auth"));
    write("apps/web/.claude/skills/billing/SKILL.md", marked("billing"));
    assert.deepEqual(await checkConceptSkills(tmp), {
      ok: true,
      missing: [],
      mismatches: [],
      unmarked: [],
      docsOnly: [],
    });
  });

  it("reports a concept with no skill, and one whose declared path is absent", async () => {
    config({
      ghost: { globs: ["src/ghost/**"] },
      gone: { globs: ["src/gone/**"], skill: ".claude/skills/gone/SKILL.md" },
    });
    const r = await checkConceptSkills(tmp);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, [
      { concept: "ghost", declared: null },
      { concept: "gone", declared: ".claude/skills/gone/SKILL.md" },
    ]);
  });

  it("reports a mismatch when the declared path disagrees with the marked skill named after the concept", async () => {
    config({ auth: { globs: ["src/auth/**"], skill: "docs/auth/SKILL.md" } });
    write(".claude/skills/auth/SKILL.md", marked("auth"));
    const r = await checkConceptSkills(tmp);
    assert.equal(r.ok, false);
    assert.deepEqual(r.mismatches, [
      { concept: "auth", declared: "docs/auth/SKILL.md", found: ".claude/skills/auth/SKILL.md" },
    ]);
    assert.deepEqual(r.missing, []);
  });

  it("reports an unmarked declared skill without failing ok", async () => {
    config({ auth: { globs: ["src/auth/**"], skill: ".claude/skills/auth/SKILL.md" } });
    write(".claude/skills/auth/SKILL.md", unmarked("auth"));
    const r = await checkConceptSkills(tmp);
    assert.equal(r.ok, true);
    assert.deepEqual(r.unmarked, [{ concept: "auth", path: ".claude/skills/auth/SKILL.md" }]);
    assert.deepEqual(r.missing, []);
  });

  it("lists marked skills belonging to no concept as docs-only, which is allowed", async () => {
    config({});
    write("infra/.claude/skills/terraform-layout/SKILL.md", marked("terraform-layout"));
    const r = await checkConceptSkills(tmp);
    assert.equal(r.ok, true);
    assert.deepEqual(r.docsOnly, [{ id: "terraform-layout", path: "infra/.claude/skills/terraform-layout/SKILL.md" }]);
  });

  it("works with no scribe.config.json at all: every marked skill is docs-only", async () => {
    write(".claude/skills/a/SKILL.md", marked("a"));
    const r = await checkConceptSkills(tmp);
    assert.equal(r.ok, true);
    assert.equal(r.docsOnly.length, 1);
  });
});

describe("gitWindow", () => {
  it("is 'unstamped' without a sha", () => {
    assert.deepEqual(gitWindow(tmp, "", []), { commitsSince: null, filesChanged: [], reason: "unstamped" });
  });

  it("is 'not-a-git-repo' outside a repository", () => {
    assert.deepEqual(gitWindow(tmp, "abc123", []), { commitsSince: null, filesChanged: [], reason: "not-a-git-repo" });
  });

  it("is 'unknown-commit' for a sha git does not have", () => {
    git("init", "-q");
    write("a.txt", "a");
    commitAll("one");
    assert.deepEqual(gitWindow(tmp, "0123456789abcdef0123456789abcdef01234567", []), {
      commitsSince: null,
      filesChanged: [],
      reason: "unknown-commit",
      unknownFreshness: true,
    });
  });

  it("is 'malformed-sha' with unknownFreshness for non-hex or option-like shas, even outside a repo", () => {
    for (const sha of ["not-a-sha", "--output=/tmp/x", "-1", "abc 123", "abc", "zzzz1234"]) {
      assert.deepEqual(gitWindow(tmp, sha, []), {
        commitsSince: null,
        filesChanged: [],
        reason: "malformed-sha",
        unknownFreshness: true,
      });
    }
  });

  it("an unknown commit also carries unknownFreshness", () => {
    git("init", "-q");
    write("a.txt", "a");
    commitAll("one");
    const w = gitWindow(tmp, "deadbeefdeadbeef", []);
    assert.equal(w.reason, "unknown-commit");
    assert.equal(w.unknownFreshness, true);
    assert.equal(w.commitsSince, null);
  });

  it("counts commits and files since the sha, scoped by :(glob) pathspecs", () => {
    git("init", "-q");
    write("src/auth/a.ts", "1");
    write("src/billing/b.ts", "1");
    const base = commitAll("base");
    write("src/auth/a.ts", "2");
    commitAll("auth change");
    write("src/billing/b.ts", "2");
    commitAll("billing change");
    write("src/auth/deep/nested/c.ts", "1");
    commitAll("auth nested add");

    assert.deepEqual(gitWindow(tmp, base, ["src/auth/**"]), {
      commitsSince: 2,
      filesChanged: ["src/auth/a.ts", "src/auth/deep/nested/c.ts"],
      filesChangedCounts: [
        { path: "src/auth/a.ts", commits: 1 },
        { path: "src/auth/deep/nested/c.ts", commits: 1 },
      ],
    });
    assert.deepEqual(gitWindow(tmp, base, []), {
      commitsSince: 3,
      filesChanged: ["src/auth/a.ts", "src/auth/deep/nested/c.ts", "src/billing/b.ts"],
      filesChangedCounts: [
        { path: "src/auth/a.ts", commits: 1 },
        { path: "src/auth/deep/nested/c.ts", commits: 1 },
        { path: "src/billing/b.ts", commits: 1 },
      ],
    });
    // `:(glob)` magic: a single `*` does not cross a directory.
    assert.deepEqual(gitWindow(tmp, base, ["src/auth/*"]), {
      commitsSince: 1,
      filesChanged: ["src/auth/a.ts"],
      filesChangedCounts: [{ path: "src/auth/a.ts", commits: 1 }],
    });
    const head = git("rev-parse", "HEAD");
    assert.deepEqual(gitWindow(tmp, head, ["src/auth/**"]), {
      commitsSince: 0,
      filesChanged: [],
      filesChangedCounts: [],
    });
  });
});

describe("conceptSkillsStatus", () => {
  it("reports per-concept freshness over its globs, docs-only skills over the repo, and the list record", async () => {
    git("init", "-q");
    config(
      { auth: { globs: ["src/auth/**"] }, billing: { globs: ["src/billing/**"] } },
      { skills: { version: "1.2", last_update: "" } }
    );
    write("src/auth/a.ts", "1");
    write("src/billing/b.ts", "1");
    write(".claude/skills/auth/SKILL.md", marked("auth"));
    const base = commitAll("base");

    // Stamp the skills and the list at `base`, then move on.
    write(".claude/skills/auth/SKILL.md", marked("auth", base, "2.1"));
    write("docs/.claude/skills/runbook/SKILL.md", marked("runbook", base, "1.3"));
    config(
      { auth: { globs: ["src/auth/**"] }, billing: { globs: ["src/billing/**"] } },
      { skills: { version: "1.2", last_update: base } }
    );
    commitAll("stamp");
    write("src/auth/a.ts", "2");
    commitAll("auth change");
    const head = git("rev-parse", "HEAD");

    const r = await conceptSkillsStatus(tmp);
    assert.equal(r.head, head);
    assert.deepEqual(r.list, {
      version: "1.2",
      lastUpdate: base,
      source: "scribe.config.json",
      commitsSince: 2,
      filesChanged: [
        ".claude/skills/auth/SKILL.md",
        "docs/.claude/skills/runbook/SKILL.md",
        "scribe.config.json",
        "src/auth/a.ts",
      ],
      filesChangedCounts: [
        { path: ".claude/skills/auth/SKILL.md", commits: 1 },
        { path: "docs/.claude/skills/runbook/SKILL.md", commits: 1 },
        { path: "scribe.config.json", commits: 1 },
        { path: "src/auth/a.ts", commits: 1 },
      ],
    });
    assert.deepEqual(r.concepts, [
      {
        concept: "auth",
        skill: "auth",
        path: ".claude/skills/auth/SKILL.md",
        version: "2.1",
        lastUpdate: base,
        globs: ["src/auth/**"],
        scope: "globs",
        commitsSince: 1,
        filesChanged: ["src/auth/a.ts"],
        filesChangedCounts: [{ path: "src/auth/a.ts", commits: 1 }],
      },
      {
        concept: "billing",
        skill: null,
        path: null,
        version: null,
        lastUpdate: null,
        globs: ["src/billing/**"],
        scope: "globs",
        commitsSince: null,
        filesChanged: [],
        reason: "unstamped",
      },
      {
        concept: null,
        skill: "runbook",
        path: "docs/.claude/skills/runbook/SKILL.md",
        version: "1.3",
        lastUpdate: base,
        globs: [],
        scope: "repo",
        commitsSince: 2,
        filesChanged: [
          ".claude/skills/auth/SKILL.md",
          "docs/.claude/skills/runbook/SKILL.md",
          "scribe.config.json",
          "src/auth/a.ts",
        ],
        filesChangedCounts: [
          { path: ".claude/skills/auth/SKILL.md", commits: 1 },
          { path: "docs/.claude/skills/runbook/SKILL.md", commits: 1 },
          { path: "scribe.config.json", commits: 1 },
          { path: "src/auth/a.ts", commits: 1 },
        ],
      },
    ]);
  });

  it("reads the list record from the legacy file when the config has no block", async () => {
    git("init", "-q");
    write("a.txt", "a");
    const base = commitAll("base");
    write(".claude/concept-skills.json", JSON.stringify({ version: "3.0", last_update: base }));
    const r = await conceptSkillsStatus(tmp);
    assert.equal(r.list?.source, ".claude/concept-skills.json");
    assert.equal(r.list?.commitsSince, 0);
  });

  it("outside git: empty head and not-a-git-repo windows", async () => {
    config({ auth: { globs: ["src/auth/**"] } });
    write(".claude/skills/auth/SKILL.md", marked("auth", "abc123"));
    const r = await conceptSkillsStatus(tmp);
    assert.equal(r.head, "");
    assert.equal(r.list, null);
    assert.equal(r.concepts[0].reason, "not-a-git-repo");
    assert.equal(r.concepts[0].commitsSince, null);
  });
});
