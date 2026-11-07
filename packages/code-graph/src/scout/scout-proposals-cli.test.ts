// `code-graph scout --proposals` through the real CLI, dist and the bundle, on throwaway git repositories with
// a fake `.git` directory (findRepoRoot looks for `.git`, no git init needed). No model call, no store. Requires
// `pnpm build` first (dist and bundle). Each SCOUT_PROPOSALS_TEST_* variable points the same assertions at a
// mutant copy, for a negative control; unset, they use the real files.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(here, "../..");
const DIST = process.env.SCOUT_PROPOSALS_TEST_DIST ?? path.join(PKG, "dist/cli.js");
const BUNDLE = process.env.SCOUT_PROPOSALS_TEST_BUNDLE ?? path.resolve(PKG, "../../plugin/scripts/code-graph.cjs");
const SKILL =
  process.env.SCOUT_PROPOSALS_TEST_SKILL ?? path.resolve(PKG, "../../plugin/skills/refactor-scout/SKILL.md");
const TIMEOUT_MS = 120_000;

let tmp = "";
let cache = "";

function run(cli: string, cwd: string, args: string[], input?: string, nodeArgs: string[] = []) {
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.CLAUDE_PROJECT_DIR;
  return spawnSync("node", [...nodeArgs, cli, ...args], { cwd, encoding: "utf8", env, input, timeout: TIMEOUT_MS });
}

const write = (root: string, file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

/** A git root at `name` (a `.git` directory), the given files, and a config at `configDir` (default the root). */
function repo(name: string, files: string[] = [], configDir = "."): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  for (const f of files) write(root, f, "export const x = 1;\n");
  write(root, path.join(configDir, "scribe.config.json"), JSON.stringify({ project: name, concepts: {} }));
  return root;
}

const sections = (...lines: string[]) => lines.join("\n") + "\n";

before(() => {
  for (const f of [DIST, BUNDLE, SKILL]) assert.ok(fs.existsSync(f), `${f} is missing, run pnpm build first`);
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-scout-proposals-")));
  cache = path.join(tmp, "empty-cache");
  fs.mkdirSync(cache);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const CLIS = [
  ["dist", () => DIST],
  ["bundle", () => BUNDLE],
] as const;

describe("scout --proposals: the smoke-run fixture from a temp repo", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: an absolute in-repo path prints git-root-relative, the rest of the line kept`, () => {
      const root = repo(`smoke-${name}`, ["packages/code-graph/src/scout/primer.ts"]);
      const abs = path.join(root, "packages/code-graph/src/scout/primer.ts");
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections("PROPOSALS:", `- ${abs}: dead-export: unused export \`x\`, drop it`)
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");
      assert.equal(
        r.stdout,
        "PROPOSALS:\n- packages/code-graph/src/scout/primer.ts: dead-export: unused export `x`, drop it\n"
      );
      assert.ok(!r.stdout.includes(root), "the temp root is not printed");
    });
  }

  it("dist: the same answer through --root from another directory", () => {
    const root = repo("smoke-root-flag", ["packages/code-graph/src/scout/primer.ts"]);
    const abs = path.join(root, "packages/code-graph/src/scout/primer.ts");
    const r = run(DIST, tmp, ["--root", root, "scout", "--proposals"], sections("PROPOSALS:", `- ${abs}: k: p`));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "PROPOSALS:\n- packages/code-graph/src/scout/primer.ts: k: p\n");
  });
});

describe("scout --proposals: path forms through the CLI", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: absolute, ./ and a/../ paths print git-root-relative, one block`, () => {
      const root = repo(`forms-${name}`, ["src/a.ts", "src/b.ts"]);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections(
          "PROPOSALS:",
          `- ${path.join(root, "src/a.ts")}: k: abs`,
          "- ./src/b.ts: k: dot",
          "- src/x/../a.ts: k: dotdot"
        )
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "PROPOSALS:\n- src/a.ts: k: abs\n- src/b.ts: k: dot\n- src/a.ts: k: dotdot\n");
    });

    it(`${name}: line references, backticks and * bullets are kept or normalised, prose is dropped`, () => {
      const root = repo(`shape-${name}`, ["src/a.ts"]);
      const abs = path.join(root, "src/a.ts");
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections(
          "Here is what I found across the files.",
          "PROPOSALS:",
          `- ${abs}:12-30: k: range`,
          `* \`${abs}:5\`: k: starred`,
          "- `src/a.ts`: k: ticked"
        )
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        "PROPOSALS:\n- src/a.ts:12-30: k: range\n- src/a.ts:5: k: starred\n- src/a.ts: k: ticked\n"
      );
      assert.doesNotMatch(r.stdout, /Here is what/);
    });
  }
});

describe("scout --proposals: backticks closing before the line ref, and numbered bullets", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: a backticked absolute path with the ref after the closing backtick prints git-root-relative, backticks dropped`, () => {
      const root = repo(`tick-abs-${name}`, ["src/a.ts"]);
      const abs = path.join(root, "src/a.ts");
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections("PROPOSALS:", "- `" + abs + "`:12: dup: x", "- `" + abs + "`:12-30: dup: y")
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "PROPOSALS:\n- src/a.ts:12: dup: x\n- src/a.ts:12-30: dup: y\n");
      assert.ok(!r.stdout.includes(root), "the temp root is not printed");
    });

    it(`${name}: a backticked relative path with a range from pkg/ is config-prefixed, the range kept`, () => {
      const root = repo(`tick-pkg-${name}`, ["pkg/src/a/x.ts"], "pkg");
      const r = run(
        cli(),
        path.join(root, "pkg"),
        ["scout", "--proposals"],
        sections("PROPOSALS:", "- `src/a/x.ts`:12-30: k: p")
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "PROPOSALS:\n- pkg/src/a/x.ts:12-30: k: p\n");
    });

    it(`${name}: a backticked absolute outside path is kept as given, backticks and all, and named on the outside line`, () => {
      const root = repo(`tick-out-${name}`, ["src/a.ts"]);
      const r = run(cli(), root, ["scout", "--proposals"], sections("PROPOSALS:", "- `/elsewhere/x.ts`:3: k: p"));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        "outside the repository: 1 path(s) kept as given: /elsewhere/x.ts:3\nPROPOSALS:\n- `/elsewhere/x.ts`:3: k: p\n"
      );
    });

    it(`${name}: the three line-ref layouts and the plain backticked path print the same form, '.' with a ref is kept as given`, () => {
      const root = repo(`tick-forms-${name}`, ["src/a.ts"]);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections(
          "PROPOSALS:",
          "- `src/a.ts:12`: k: inside",
          "- `src/a.ts`:12: k: outside-ref",
          "- src/a.ts:12: k: bare",
          "- `src/a.ts`: k: no-ref",
          "- `.`:3: k: dot"
        )
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        "PROPOSALS:\n- src/a.ts:12: k: inside\n- src/a.ts:12: k: outside-ref\n- src/a.ts:12: k: bare\n- src/a.ts: k: no-ref\n- `.`:3: k: dot\n"
      );
    });

    it(`${name}: numbered 1. and 1) bullets print as - bullets, a numbered line with no space after the number is dropped`, () => {
      const root = repo(`numbered-${name}`, ["src/a.ts", "src/b.ts"]);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections("PROPOSALS:", "1. src/a.ts: k: p", "2) ./src/b.ts:7: k: q", "3.foo: k: dropped")
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");
      assert.equal(r.stdout, "PROPOSALS:\n- src/a.ts: k: p\n- src/b.ts:7: k: q\n");
    });
  }
});

describe("scout --proposals: a config in a git subdirectory", () => {
  // The git root holds `other/y.ts` and `shared/t.ts`; the config is in `pkg/`, which holds `src/a/x.ts`,
  // `src/fresh/keep.ts` (so `src/fresh/` exists) and `shared/t.ts` too (a tie).
  const files = ["pkg/src/a/x.ts", "pkg/src/fresh/keep.ts", "pkg/shared/t.ts", "other/y.ts", "shared/t.ts"];
  const SECTION = sections(
    "PROPOSALS:",
    "- src/a/x.ts: k: config-relative",
    "- /PKG/src/a/x.ts: k: absolute-in-config",
    "- ./src/a/x.ts:3: k: dot-with-line",
    "- a/../src/a/x.ts: k: dotdot",
    "- other/y.ts: k: git-root-file",
    "- /ROOT/other/y.ts: k: absolute-git-root-file",
    "- shared/t.ts: k: tie-goes-to-git-root",
    "- src/fresh/new.ts: k: new-file-in-config-dir",
    "- ../other/y.ts: k: config-relative-dotdot-inside",
    "- /ROOT: k: the-root-itself",
    "- /elsewhere/z.ts: k: outside-abs",
    "- ../../outside.ts: k: outside-rel"
  );

  for (const [name, cli] of CLIS) {
    it(`${name}: run from the config directory, each path is git-root-relative and the outside ones are named`, () => {
      const root = repo(`mono-${name}`, files, "pkg");
      const text = SECTION.replaceAll("/PKG", path.join(root, "pkg")).replaceAll("/ROOT", root);
      const r = run(cli(), path.join(root, "pkg"), ["scout", "--proposals"], text);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          "outside the repository: 2 path(s) kept as given: /elsewhere/z.ts, ../../outside.ts",
          "PROPOSALS:",
          "- pkg/src/a/x.ts: k: config-relative",
          "- pkg/src/a/x.ts: k: absolute-in-config",
          "- pkg/src/a/x.ts:3: k: dot-with-line",
          "- pkg/src/a/x.ts: k: dotdot",
          "- other/y.ts: k: git-root-file",
          "- other/y.ts: k: absolute-git-root-file",
          "- shared/t.ts: k: tie-goes-to-git-root",
          "- pkg/src/fresh/new.ts: k: new-file-in-config-dir",
          "- other/y.ts: k: config-relative-dotdot-inside",
          "- .: k: the-root-itself",
          "- /elsewhere/z.ts: k: outside-abs",
          "- ../../outside.ts: k: outside-rel",
          "",
        ].join("\n")
      );
    });
  }

  for (const [name, cli] of CLIS) {
    it(`${name}: a prefix-sibling of the git root, absolute or ../ from pkg/, is outside and kept as given`, () => {
      const root = repo(`prefix-${name}`, ["pkg/src/a/x.ts"], "pkg");
      const sibling = `${root}-sibling`;
      const r = run(
        cli(),
        path.join(root, "pkg"),
        ["scout", "--proposals"],
        sections(
          "PROPOSALS:",
          `- ${sibling}/y.ts: k: abs`,
          `- ../../${path.basename(root)}-sibling/y.ts: k: rel`,
          `- ${path.join(root, "pkg2")}/z.ts: k: inside`
        )
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        [
          `outside the repository: 2 path(s) kept as given: ${sibling}/y.ts, ../../${path.basename(root)}-sibling/y.ts`,
          "PROPOSALS:",
          `- ${sibling}/y.ts: k: abs`,
          `- ../../${path.basename(root)}-sibling/y.ts: k: rel`,
          "- pkg2/z.ts: k: inside",
          "",
        ].join("\n")
      );
    });
  }

  it("dist: the same from the git root with --root pointing at the config directory", () => {
    const root = repo("mono-root-flag", files, "pkg");
    const r = run(
      DIST,
      tmp,
      ["--root", path.join(root, "pkg"), "scout", "--proposals"],
      sections("PROPOSALS:", "- src/a/x.ts: k: p")
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "PROPOSALS:\n- pkg/src/a/x.ts: k: p\n");
  });

  it("dist: a config in the subdirectory with no file anywhere falls back to the git root, unrewritten", () => {
    const root = repo("mono-nothing", [], "pkg");
    const r = run(
      DIST,
      path.join(root, "pkg"),
      ["scout", "--proposals"],
      sections("PROPOSALS:", "- src/new/deep.ts: k: p")
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "PROPOSALS:\n- src/new/deep.ts: k: p\n");
  });
});

describe("scout --proposals: outside the repository", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: an absolute path elsewhere and a ../ path are kept as given and named before the block`, () => {
      const root = repo(`outside-${name}`, ["src/a.ts"]);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections(
          "PROPOSALS:",
          "- /elsewhere/z.ts:4: k: p",
          "- ../x.ts: k: q",
          `- ${path.join(root, "src/a.ts")}: k: in`
        )
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(
        r.stdout,
        "outside the repository: 2 path(s) kept as given: /elsewhere/z.ts:4, ../x.ts\nPROPOSALS:\n- /elsewhere/z.ts:4: k: p\n- ../x.ts: k: q\n- src/a.ts: k: in\n"
      );
    });
  }

  for (const [name, cli] of CLIS) {
    it(`${name}: an empty bullet is dropped and a relative '.' is kept as given, not flagged outside`, () => {
      const root = repo(`empty-bullet-${name}`, ["src/a.ts"]);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections("PROPOSALS:", "-   ", "- .: k: p", "- src/a.ts: k: q")
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "PROPOSALS:\n- .: k: p\n- src/a.ts: k: q\n");
    });
  }

  it("dist: no outside path means no outside line", () => {
    const root = repo("outside-none", ["src/a.ts"]);
    const r = run(DIST, root, ["scout", "--proposals"], sections("PROPOSALS:", "- src/a.ts: k: p"));
    assert.equal(r.stdout, "PROPOSALS:\n- src/a.ts: k: p\n");
  });
});

describe("scout --proposals: sections that answered none", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: every section none prints PROPOSALS: none and exit 0`, () => {
      const root = repo(`none-${name}`);
      const r = run(cli(), root, ["scout", "--proposals"], sections("PROPOSALS: none", "", "PROPOSALS: none"));
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "PROPOSALS: none\n");
      assert.equal(r.stderr, "");
    });
  }
});

describe("scout --proposals: exit 13, no PROPOSALS: section on stdin", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: empty stdin is exit 13, one stderr line, nothing on stdout (never PROPOSALS: none)`, () => {
      const root = repo(`empty-${name}`);
      const r = run(cli(), root, ["scout", "--proposals"], "");
      assert.equal(r.status, 13, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.equal(r.stderr.trim().split("\n").length, 1, r.stderr);
      assert.match(r.stderr, /no PROPOSALS: section/);
    });

    it(`${name}: prose and bullets with no PROPOSALS: line are exit 13, bullets are not printed`, () => {
      const root = repo(`prose-${name}`);
      const r = run(
        cli(),
        root,
        ["scout", "--proposals"],
        sections("nothing scanned: every session failed", "- src/a.ts: k: p")
      );
      assert.equal(r.status, 13, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
    });
  }
});

describe("scout --proposals: bad combinations are exit 1", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: a scope file with --proposals is exit 1 and prints nothing`, () => {
      const root = repo(`combo-scope-${name}`);
      fs.writeFileSync(path.join(root, "scope.txt"), "src/a.ts\n");
      const r = run(cli(), root, ["scout", "scope.txt", "--proposals"], sections("PROPOSALS:", "- src/a.ts: k: p"));
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /takes no scope file and no --json/);
    });

    it(`${name}: --json with --proposals is exit 1 and prints nothing`, () => {
      const root = repo(`combo-json-${name}`);
      const r = run(cli(), root, ["scout", "--proposals", "--json"], sections("PROPOSALS:", "- src/a.ts: k: p"));
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
    });

    it(`${name}: scout with neither a scope file nor --proposals is exit 1`, () => {
      const root = repo(`combo-none-${name}`);
      const r = run(cli(), root, ["scout"], "");
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /a <scope-file> is required \(or --proposals\)/);
    });
  }
});

describe("scout --proposals: exit 5 with no config", () => {
  for (const [name, cli] of CLIS) {
    it(`${name}: no scribe.config.json above the directory is exit 5, nothing on stdout`, () => {
      const bare = path.join(tmp, `bare-${name}`);
      fs.mkdirSync(path.join(bare, ".git"), { recursive: true });
      const r = run(cli(), bare, ["scout", "--proposals"], sections("PROPOSALS:", "- src/a.ts: k: p"));
      assert.equal(r.status, 5, r.stdout + r.stderr);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /no scribe\.config\.json found/);
    });
  }
});

describe("scout --proposals: node:sqlite (documented exit 8, as for every scout form)", () => {
  it("dist: without node:sqlite it is exit 8 even though it opens no store", () => {
    const root = repo("no-sqlite");
    const r = run(DIST, root, ["scout", "--proposals"], sections("PROPOSALS:", "- src/a.ts: k: p"), [
      "--no-experimental-sqlite",
    ]);
    assert.equal(r.status, 8, r.stdout + r.stderr);
    assert.equal(r.stdout, "");
  });
});

describe("the refactor-scout skill's step 3 calls --proposals", () => {
  const skill = fs.readFileSync(SKILL, "utf8");

  it("pipes the returned sections to scout --proposals through a quoted heredoc", () => {
    assert.match(
      skill,
      /node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/code-graph\.cjs" scout --proposals <<'SCOUT_PROPOSALS'\n[\s\S]*\n\s*SCOUT_PROPOSALS\n/
    );
  });

  it("keeps the nothing-scanned rule for a run where no session answered", () => {
    assert.match(
      skill,
      /If no session answered, print\n\s*`nothing scanned: every session failed; this is not a clean result, the scout read no code` and no\n\s*`PROPOSALS:` line/
    );
  });

  it("keeps the PROPOSALS: none rule for a scan that proposed nothing", () => {
    assert.match(skill, /or `PROPOSALS: none`\s+when every section was none/);
    assert.match(skill, /`PROPOSALS: none` means a scan ran and proposed nothing, so never write it here/);
  });

  it("names the outside-repository line and the non-zero exit behaviour", () => {
    assert.match(skill, /named on an\s+`outside the repository:` line/);
    assert.match(skill, /On a non-zero\s+exit print its stderr line and no `PROPOSALS:` line/);
  });

  it("the allowed-tools pattern covers scout with --proposals", () => {
    const frontmatter = skill.split("---")[1];
    assert.match(frontmatter, /Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/code-graph\.cjs" scout \*\)/);
  });
});
