// `code-graph scout --proposals`, unit level: the path normaliser, the section parser and the printed block.
// Pure, except the config-in-a-subdirectory cases, which take an `exists` stub instead of the disk. The CLI
// form, dist and bundle, is pinned in scout-proposals-cli.test.ts.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleProposals, formatProposals, normaliseProposalPath, type ProposalRoots } from "./proposals.js";

let tmp = "";
before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cg-proposals-")));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Config at the git root. `exists` throws: a flat config must never consult the disk. */
const flat = (): ProposalRoots => ({
  repoRoot: tmp,
  configRoot: tmp,
  exists: () => {
    throw new Error("a config at the git root must not check the disk");
  },
});

/**
 * Config in `pkg/`, and only `files` (repo-relative) exist. Their directories exist too, as `existsSync` says
 * of a directory, so a new file in a directory that holds a listed file is settled by that directory.
 */
function sub(files: string[]): ProposalRoots {
  const present = new Set<string>();
  for (const f of files) {
    for (let p = path.join(tmp, f); p.startsWith(tmp) && p !== tmp; p = path.dirname(p)) present.add(p);
  }
  return { repoRoot: tmp, configRoot: path.join(tmp, "pkg"), exists: (p) => present.has(p) };
}

const SMOKE_REL = "packages/code-graph/src/scout/primer.ts";
const SMOKE = path.join(tmp, SMOKE_REL);

describe("normaliseProposalPath, config at the git root", () => {
  it("an absolute path inside the repository loses the root (the smoke-run bug)", () => {
    assert.equal(normaliseProposalPath(SMOKE, flat()), SMOKE_REL);
  });

  it("./ and a/../ prefixes are cleaned", () => {
    assert.equal(normaliseProposalPath("./src/a.ts", flat()), "src/a.ts");
    assert.equal(normaliseProposalPath("src/x/../a.ts", flat()), "src/a.ts");
    assert.equal(normaliseProposalPath(path.join(tmp, "src/x/../a.ts"), flat()), "src/a.ts");
  });

  it("an absolute path with .. that stays inside the repository is cleaned", () => {
    assert.equal(normaliseProposalPath(path.join(tmp, "a/../src/a.ts"), flat()), "src/a.ts");
  });

  it("a relative path never consults the disk when the config sits at the git root", () => {
    assert.equal(normaliseProposalPath("src/new/brand-new.ts", flat()), "src/new/brand-new.ts");
  });

  it("outside the repository is null: a relative path leaving it, an absolute one elsewhere", () => {
    assert.equal(normaliseProposalPath("../x.ts", flat()), null);
    assert.equal(normaliseProposalPath("./../x.ts", flat()), null);
    assert.equal(normaliseProposalPath("/elsewhere/z.ts", flat()), null);
  });

  it("a sibling directory that shares the repository's name prefix is outside, not inside", () => {
    assert.equal(normaliseProposalPath(`${tmp}-sibling/x.ts`, flat()), null);
  });

  it("the current directory itself is null, not a file", () => {
    assert.equal(normaliseProposalPath(".", flat()), null);
  });

  it("the repository root as an absolute path is '.', inside the repository", () => {
    assert.equal(normaliseProposalPath(tmp, flat()), ".");
  });
});

describe("normaliseProposalPath, config in a git subdirectory (pkg/)", () => {
  it("a relative path that exists under the config root is taken from it", () => {
    assert.equal(normaliseProposalPath("src/a/x.ts", sub(["pkg/src/a/x.ts"])), "pkg/src/a/x.ts");
  });

  it("a relative path that exists under the git root is kept git-root-relative", () => {
    assert.equal(normaliseProposalPath("other/y.ts", sub(["other/y.ts"])), "other/y.ts");
  });

  it("the git root wins a tie when the file exists under both", () => {
    assert.equal(normaliseProposalPath("shared/t.ts", sub(["shared/t.ts", "pkg/shared/t.ts"])), "shared/t.ts");
  });

  it("a new file whose directory exists only under the config root becomes config-prefixed", () => {
    assert.equal(normaliseProposalPath("src/fresh/new.ts", sub(["pkg/src/fresh/keep.ts"])), "pkg/src/fresh/new.ts");
  });

  it("a new file whose directory exists only under the git root is git-root-relative", () => {
    assert.equal(normaliseProposalPath("src/fresh/new.ts", sub(["src/fresh/keep.ts"])), "src/fresh/new.ts");
  });

  it("a new file under a directory that exists nowhere falls back to the git root", () => {
    assert.equal(normaliseProposalPath("src/new/deep.ts", sub([])), "src/new/deep.ts");
  });

  it("./ and a/../ relative forms are cleaned before the config-root test", () => {
    assert.equal(normaliseProposalPath("./src/a/x.ts", sub(["pkg/src/a/x.ts"])), "pkg/src/a/x.ts");
    assert.equal(normaliseProposalPath("a/../src/a/x.ts", sub(["pkg/src/a/x.ts"])), "pkg/src/a/x.ts");
  });

  it("an absolute path inside the repository is git-root-relative, even when outside pkg/", () => {
    assert.equal(normaliseProposalPath(path.join(tmp, "src/a/x.ts"), sub([])), "src/a/x.ts");
  });

  it("an absolute path under pkg/ is git-root-relative, so pkg/ stays in the printed path", () => {
    assert.equal(normaliseProposalPath(path.join(tmp, "pkg/src/a/x.ts"), sub([])), "pkg/src/a/x.ts");
  });

  it("a ../ path is judged after the config root is joined: inside the repository it is kept, past it null", () => {
    assert.equal(normaliseProposalPath("../shared/x.ts", sub(["shared/x.ts"])), "shared/x.ts");
    assert.equal(normaliseProposalPath("../shared/new.ts", sub([])), "shared/new.ts");
    assert.equal(normaliseProposalPath("./../shared/x.ts", sub([])), "shared/x.ts");
    assert.equal(normaliseProposalPath("..", sub([])), ".");
    assert.equal(normaliseProposalPath("../../x.ts", sub([])), null);
  });

  it("a ../ path that leaves the repository is null even when its name shares the repository's prefix", () => {
    assert.equal(normaliseProposalPath(`../../${path.basename(tmp)}-sibling/x.ts`, sub([])), null);
  });

  it("an absolute path that shares the config root's name prefix (pkg2 beside pkg) is inside the repository", () => {
    assert.equal(normaliseProposalPath(path.join(tmp, "pkg2/x.ts"), sub([])), "pkg2/x.ts");
  });

  it("an absolute prefix-sibling of the repository root is outside with the config in pkg/", () => {
    assert.equal(normaliseProposalPath(`${tmp}-sibling/x.ts`, sub([])), null);
  });

  it("a new top-level file under pkg/ is git-root-relative: the root exists, so it settles the candidate", () => {
    // The root is the only directory that exists here; the config directory must not win the tie.
    const roots: ProposalRoots = {
      repoRoot: tmp,
      configRoot: path.join(tmp, "pkg"),
      exists: (p) => p === tmp || p === path.join(tmp, "pkg"),
    };
    assert.equal(normaliseProposalPath("top-new.ts", roots), "top-new.ts");
  });

  it("an absolute path never consults the disk", () => {
    const roots: ProposalRoots = {
      repoRoot: tmp,
      configRoot: path.join(tmp, "pkg"),
      exists: () => {
        throw new Error("absolute paths are settled without the disk");
      },
    };
    assert.equal(normaliseProposalPath(path.join(tmp, "pkg/src/a/x.ts"), roots), "pkg/src/a/x.ts");
  });
});

describe("assembleProposals", () => {
  it("the smoke-run line: an absolute in-repo path with a backtick message is rewritten and the rest kept", () => {
    const text = `Found one.\nPROPOSALS:\n- ${SMOKE}: dead-export: unused export \`foo\`, drop it\n`;
    const r = assembleProposals(text, flat());
    assert.equal(r.answered, true);
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}: dead-export: unused export \`foo\`, drop it`]);
    assert.deepEqual(r.outside, []);
  });

  it("./ and a/../ paths in one section are normalised, each line on its own", () => {
    const r = assembleProposals("PROPOSALS:\n- ./src/a.ts: k: p1\n- src/x/../b.ts: k: p2\n", flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: p1", "- src/b.ts: k: p2"]);
  });

  it("a line reference is kept after the rewritten path: :12 and :12-30", () => {
    const r = assembleProposals(`PROPOSALS:\n- ${SMOKE}:12: k: a\n- ${SMOKE}:12-30: k: b\n`, flat());
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}:12: k: a`, `- ${SMOKE_REL}:12-30: k: b`]);
  });

  it("a line reference on a relative path is kept too", () => {
    const r = assembleProposals("PROPOSALS:\n- ./src/x.ts:7: k: p\n", flat());
    assert.deepEqual(r.lines, ["- src/x.ts:7: k: p"]);
  });

  it("surrounding backticks are dropped, with and without a line reference", () => {
    const r = assembleProposals(
      `PROPOSALS:\n- \`${SMOKE}\`: k: a\n- \`${SMOKE}:5\`: k: b\n- \`src/x.ts\`: k: c\n`,
      flat()
    );
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}: k: a`, `- ${SMOKE_REL}:5: k: b`, "- src/x.ts: k: c"]);
  });

  it("* bullets, indented or not, are printed as - bullets", () => {
    const r = assembleProposals(`PROPOSALS:\n* ${SMOKE}: k: a\n  * src/x.ts: k: b\n`, flat());
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}: k: a`, "- src/x.ts: k: b"]);
  });

  it("prose and bullets before the first PROPOSALS: line are ignored", () => {
    const text = [
      "I read the scope. Some notes:",
      `- ${SMOKE}: k: ignored because it comes before the section`,
      "PROPOSALS:",
      "- src/kept.ts: k: p",
    ].join("\n");
    const r = assembleProposals(text, flat());
    assert.equal(r.answered, true);
    assert.deepEqual(r.lines, ["- src/kept.ts: k: p"]);
  });

  it("a bullet with no ': ' is kept as given", () => {
    const r = assembleProposals("PROPOSALS:\n- looks fine to me\n", flat());
    assert.deepEqual(r.lines, ["- looks fine to me"]);
  });

  it("an empty bullet is dropped", () => {
    const r = assembleProposals("PROPOSALS:\n-   \n- src/a.ts: k: p\n", flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: p"]);
  });

  it("a session section with PROPOSALS: none and a later one with bullets prints the bullets", () => {
    const text = "PROPOSALS: none\n\nPROPOSALS:\n- src/a.ts: k: p\n";
    const r = assembleProposals(text, flat());
    assert.equal(r.answered, true);
    assert.deepEqual(r.lines, ["- src/a.ts: k: p"]);
  });

  it("several sections are concatenated in the order given", () => {
    const text = [
      "PROPOSALS:",
      "- src/a.ts: k: first",
      "session 2 failed, not scanned: src/b.ts",
      "PROPOSALS:",
      `- ${SMOKE}: k: second`,
    ].join("\n");
    const r = assembleProposals(text, flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: first", `- ${SMOKE_REL}: k: second`]);
  });

  it("CRLF line endings parse the same", () => {
    const r = assembleProposals(`PROPOSALS:\r\n- ${SMOKE}: k: p\r\n`, flat());
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}: k: p`]);
  });

  it("the rest of a line is kept as returned, colons and all", () => {
    const r = assembleProposals("PROPOSALS:\n- src/a.ts: dead-export: a: b, c\n", flat());
    assert.deepEqual(r.lines, ["- src/a.ts: dead-export: a: b, c"]);
  });

  it("an absolute path and a ../ path outside the repository are kept as given and listed as outside", () => {
    const text = `PROPOSALS:\n- /elsewhere/z.ts: k: p\n- ../x.ts: k: q\n- ${tmp}-sibling/y.ts: k: r\n`;
    const r = assembleProposals(text, flat());
    assert.deepEqual(r.lines, ["- /elsewhere/z.ts: k: p", "- ../x.ts: k: q", `- ${tmp}-sibling/y.ts: k: r`]);
    assert.deepEqual(r.outside, ["/elsewhere/z.ts", "../x.ts", `${tmp}-sibling/y.ts`]);
  });

  it("an outside path with a line reference is listed with it", () => {
    const r = assembleProposals("PROPOSALS:\n- /elsewhere/z.ts:9: k: p\n", flat());
    assert.deepEqual(r.lines, ["- /elsewhere/z.ts:9: k: p"]);
    assert.deepEqual(r.outside, ["/elsewhere/z.ts:9"]);
  });

  it("an in-repo path is not listed as outside", () => {
    const r = assembleProposals(`PROPOSALS:\n- ${SMOKE}: k: p\n`, flat());
    assert.deepEqual(r.outside, []);
  });

  it("the repository root as an absolute path is not flagged as outside and prints as '.'", () => {
    const r = assembleProposals(`PROPOSALS:\n- ${tmp}: k: p\n`, flat());
    assert.deepEqual(r.outside, []);
    assert.deepEqual(r.lines, ["- .: k: p"]);
  });

  it("a config-root-relative ../ path that stays inside the repository is rewritten, not flagged", () => {
    const r = assembleProposals("PROPOSALS:\n- ../shared/x.ts: k: p\n- ../../x.ts: k: q\n", sub([]));
    assert.deepEqual(r.lines, ["- shared/x.ts: k: p", "- ../../x.ts: k: q"]);
    assert.deepEqual(r.outside, ["../../x.ts"]);
  });

  it("the repository root as '.' is not flagged as outside", () => {
    const r = assembleProposals("PROPOSALS:\n- .: k: p\n", flat());
    assert.deepEqual(r.outside, []);
  });

  it("answered is false with no PROPOSALS: line, even with bullets, and for empty text", () => {
    assert.equal(assembleProposals("- src/a.ts: k: p\n", flat()).answered, false);
    assert.equal(assembleProposals("", flat()).answered, false);
    assert.equal(assembleProposals("nothing scanned: every session failed", flat()).answered, false);
    assert.deepEqual(assembleProposals("", flat()).lines, []);
  });

  it("a PROPOSALS: none section is answered with no lines", () => {
    const r = assembleProposals("PROPOSALS: none\n", flat());
    assert.equal(r.answered, true);
    assert.deepEqual(r.lines, []);
  });
});

describe("assembleProposals, backticks closing before the line reference", () => {
  it("a backticked absolute path with the ref after the closing backtick is git-root-relative, backticks dropped", () => {
    const r = assembleProposals(`PROPOSALS:\n- \`${SMOKE}\`:12: dup: x\n`, flat());
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}:12: dup: x`]);
    assert.deepEqual(r.outside, []);
  });

  it("a backticked absolute path with a line range is git-root-relative, the range kept", () => {
    const r = assembleProposals(`PROPOSALS:\n- \`${SMOKE}\`:12-30: dup: x\n`, flat());
    assert.deepEqual(r.lines, [`- ${SMOKE_REL}:12-30: dup: x`]);
    assert.deepEqual(r.outside, []);
  });

  it("a backticked relative path with a range from a config in pkg/ is config-root-relative, the range kept", () => {
    const r = assembleProposals("PROPOSALS:\n- `src/a/x.ts`:12-30: k: p\n", sub(["pkg/src/a/x.ts"]));
    assert.deepEqual(r.lines, ["- pkg/src/a/x.ts:12-30: k: p"]);
    assert.deepEqual(r.outside, []);
  });

  it("the three line-ref layouts and the plain backticked path print the same normalised form", () => {
    const r = assembleProposals(
      "PROPOSALS:\n- `src/a.ts:12`: k: p\n- `src/a.ts`:12: k: p\n- src/a.ts:12: k: p\n- `src/a.ts`: k: p\n",
      flat()
    );
    assert.deepEqual(r.lines, [
      "- src/a.ts:12: k: p",
      "- src/a.ts:12: k: p",
      "- src/a.ts:12: k: p",
      "- src/a.ts: k: p",
    ]);
  });

  it("a backticked absolute outside path with a line ref is kept as given, backticks and all, and listed without them", () => {
    const r = assembleProposals("PROPOSALS:\n- `/elsewhere/x.ts`:3: k: p\n", flat());
    assert.deepEqual(r.lines, ["- `/elsewhere/x.ts`:3: k: p"]);
    assert.deepEqual(r.outside, ["/elsewhere/x.ts:3"]);
  });

  it("a backticked ../ path with a range is outside, its listing keeps the range", () => {
    const r = assembleProposals("PROPOSALS:\n- `../x.ts`:3-9: k: p\n", flat());
    assert.deepEqual(r.lines, ["- `../x.ts`:3-9: k: p"]);
    assert.deepEqual(r.outside, ["../x.ts:3-9"]);
  });

  it("a backticked absolute outside path with no line ref is listed without backticks", () => {
    const r = assembleProposals("PROPOSALS:\n- `/elsewhere/x.ts`: k: p\n", flat());
    assert.deepEqual(r.lines, ["- `/elsewhere/x.ts`: k: p"]);
    assert.deepEqual(r.outside, ["/elsewhere/x.ts"]);
  });

  it("a backticked ../ path that stays inside the repository from pkg/ is rewritten, not listed", () => {
    const r = assembleProposals("PROPOSALS:\n- `../shared/x.ts`:5: k: p\n", sub([]));
    assert.deepEqual(r.lines, ["- shared/x.ts:5: k: p"]);
    assert.deepEqual(r.outside, []);
  });

  it("a backticked '.' with a line ref names no file: kept as given and not listed as outside", () => {
    const r = assembleProposals("PROPOSALS:\n- `.`:3: k: p\n- `.`: k: q\n", flat());
    assert.deepEqual(r.lines, ["- `.`:3: k: p", "- `.`: k: q"]);
    assert.deepEqual(r.outside, []);
  });

  it("a stray backtick layout (`a`b`) is no path: kept as given and not listed as outside", () => {
    const r = assembleProposals("PROPOSALS:\n- `a`b`:3: k: p\n", flat());
    assert.deepEqual(r.lines, ["- `a`b`:3: k: p"]);
    assert.deepEqual(r.outside, []);
  });
});

describe("assembleProposals, numbered bullets", () => {
  it("1. and 1) bullets are printed as - bullets, with the path normalised", () => {
    const r = assembleProposals(`PROPOSALS:\n1. src/a.ts: k: p\n2) ./src/b.ts:7: k: q\n10. ${SMOKE}: k: r\n`, flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: p", "- src/b.ts:7: k: q", `- ${SMOKE_REL}: k: r`]);
    assert.deepEqual(r.outside, []);
  });

  it("a numbered bullet keeps its line ref and the rest of the line, colons included", () => {
    const r = assembleProposals("PROPOSALS:\n1. src/a.ts:4: dead-export: a: b\n", flat());
    assert.deepEqual(r.lines, ["- src/a.ts:4: dead-export: a: b"]);
  });

  it("a numbered line with no space after the number is not a bullet and is dropped", () => {
    const r = assembleProposals("PROPOSALS:\n1.foo: k: p\n1)bar: k: q\n- src/kept.ts: k: r\n", flat());
    assert.deepEqual(r.lines, ["- src/kept.ts: k: r"]);
  });

  it("an empty numbered bullet is dropped", () => {
    const r = assembleProposals("PROPOSALS:\n1.   \n2) src/a.ts: k: p\n", flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: p"]);
  });

  it("a numbered outside path is kept as given and listed", () => {
    const r = assembleProposals("PROPOSALS:\n1) /elsewhere/z.ts: k: p\n", flat());
    assert.deepEqual(r.lines, ["- /elsewhere/z.ts: k: p"]);
    assert.deepEqual(r.outside, ["/elsewhere/z.ts"]);
  });

  it("a numbered line before the PROPOSALS: line is ignored", () => {
    const r = assembleProposals(`3. ${SMOKE}: k: ignored\nPROPOSALS:\n1. src/a.ts: k: p\n`, flat());
    assert.deepEqual(r.lines, ["- src/a.ts: k: p"]);
  });
});

describe("formatProposals", () => {
  it("no proposal in any answered section prints PROPOSALS: none", () => {
    assert.equal(formatProposals(assembleProposals("PROPOSALS: none\n\nPROPOSALS: none\n", flat())), "PROPOSALS: none");
  });

  it("with lines it prints PROPOSALS: then every line, nothing else", () => {
    const out = formatProposals(assembleProposals(`PROPOSALS:\n- ${SMOKE}: k: p\n- src/b.ts: k: q\n`, flat()));
    assert.equal(out, `PROPOSALS:\n- ${SMOKE_REL}: k: p\n- src/b.ts: k: q`);
  });

  it("outside paths are named on one line before the block, with the count", () => {
    const out = formatProposals(assembleProposals("PROPOSALS:\n- /elsewhere/z.ts: k: p\n- ../x.ts: k: q\n", flat()));
    assert.equal(
      out,
      "outside the repository: 2 path(s) kept as given: /elsewhere/z.ts, ../x.ts\nPROPOSALS:\n- /elsewhere/z.ts: k: p\n- ../x.ts: k: q"
    );
  });
});
