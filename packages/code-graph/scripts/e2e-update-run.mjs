#!/usr/bin/env node
// Manual end-to-end check of the unattended update-concept-skills run (task 078). Not part of
// `pnpm test`: the real mode needs a `claude` CLI on PATH and spends tokens.
//
//   node packages/code-graph/scripts/e2e-update-run.mjs [checkout] [--sim revised|failed|readonly] [--keep]
//
// Builds a throwaway fixture in a fresh mkdtemp dir under os.tmpdir(): a git repo with concepts alpha
// (one commit behind its stamp) and beta (current), both stamped 1.0, graph extracted and applied, no
// update state files. Then runs the real trigger (`maybeStartUpdate`) and the real runner (`runUpdate`)
// in the foreground. Without --sim the runner calls `claude -p`; with --sim an injected session stages
// alpha's SKILL.md and a manifest (`revised`), marks alpha failed (`failed`), or stages it and makes the
// installed SKILL.md read-only to simulate a sandboxed runner (`readonly`).
//
// Prints the prompt, the permission mode and --allowedTools, the claude exit code, the report, the
// state file, git status and git diff. Exit 0 only when claude exited 0 and the report says
// `result: complete` (--sim failed and --sim readonly therefore exit 1 by design; they print
// `expected: INCOMPLETE` when that is what happened). Uses the checkout's built dist/ and
// plugin/scripts/code-graph.cjs: run `pnpm build` first. The fixture is removed unless --keep.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SIM_MODES = new Set(["revised", "failed", "readonly"]);

function parseArgs(argv) {
  const o = { checkout: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."), sim: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sim") o.sim = argv[++i];
    else if (a.startsWith("--sim=")) o.sim = a.slice(6);
    else if (a === "--keep") o.keep = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else o.checkout = resolve(a);
  }
  if (o.sim !== null && !SIM_MODES.has(o.sim))
    throw new Error(`--sim takes revised, failed or readonly (got ${o.sim})`);
  return o;
}

function buildFixture(repo, cli) {
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const git = (...a) => run("git", a);
  const cg = (...a) => run(process.execPath, [cli, ...a]);
  const write = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@example.invalid");
  git("config", "user.name", "e2e");
  git("config", "commit.gpgsign", "false");
  write(
    ".gitignore",
    [
      "scribe-output/graph.db*",
      "scribe-output/.*",
      "scribe-output/update-*",
      "scribe-output/*.enriched.json",
      "scribe-output/ambiguous-renames.json",
      "scribe-output/deleted/",
      "",
    ].join("\n")
  );
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src"] }, null, 2) + "\n");
  const concepts = {
    alpha: { globs: ["src/alpha/**"], skill: ".claude/skills/alpha/SKILL.md" },
    beta: { globs: ["src/beta/**"], skill: ".claude/skills/beta/SKILL.md" },
  };
  write(
    "scribe.config.json",
    JSON.stringify({ project: "e2e-078", tsconfig: "tsconfig.json", skillsDir: ".claude/skills", concepts }, null, 2) +
      "\n"
  );
  const total =
    "/** Sum of the line prices. */\nexport function computeTotal(prices: number[]): number {\n" +
    "  return prices.reduce((s, p) => s + p, 0);\n}\n";
  write("src/alpha/a.ts", total);
  write(
    "src/beta/b.ts",
    "/** Upper-cases a label. */\nexport function shout(label: string): string {\n  return label.toUpperCase();\n}\n"
  );
  write(
    ".claude/skills/alpha/SKILL.md",
    "---\nname: alpha\ndescription: Pricing helpers (alpha concept).\n---\n\n# alpha\n\n" +
      "`src/alpha/a.ts` exports `computeTotal(prices)`, the sum of the line prices.\n"
  );
  write(
    ".claude/skills/beta/SKILL.md",
    "---\nname: beta\ndescription: Label helpers (beta concept).\n---\n\n# beta\n\n" +
      "`src/beta/b.ts` exports `shout(label)`, which upper-cases a label.\n"
  );
  git("add", "-A");
  git("commit", "-q", "-m", "initial: alpha and beta");
  cg("skills", "stamp", "alpha", "beta", "--bump", "initial");
  cg("skills", "stamp", "--bump", "initial");
  cg("extract", "alpha", "beta");
  cg("apply", "alpha", "beta");
  git("add", "-A");
  git("commit", "-q", "-m", "stamp concept skills 1.0 and graph");
  write(
    "src/alpha/a.ts",
    total +
      "\n/** Total after a percentage discount. */\n" +
      "export function computeDiscountedTotal(prices: number[], percent: number): number {\n" +
      "  return computeTotal(prices) * (1 - percent / 100);\n}\n"
  );
  git("add", "-A");
  git("commit", "-q", "-m", "alpha: add computeDiscountedTotal");
  const dirty = git("status", "--porcelain");
  if (dirty) throw new Error(`fixture tree is not clean:\n${dirty}`);
  return cg("skills", "status", "--summary").trim();
}

/** The injected session for --sim: what a well-behaved headless run leaves in staging. */
function simSession(mode, repo, cli, claimedLine) {
  return async (args) => {
    const prompt = args[args.indexOf("-p") + 1];
    const staging = /staging: ([^;]+);/.exec(prompt)?.[1];
    if (!staging) return { code: 1, stdout: "", stderr: "no staging: in the prompt" };
    console.log(`sim: claimed line in -p: ${prompt.includes(claimedLine)}`);
    try {
      execFileSync(process.execPath, [cli, "refresh-skills", "--claim-update", "--concepts", "alpha"], {
        cwd: repo,
        stdio: "pipe",
      });
      console.log("sim: refresh-skills --claim-update during the run: exit 0 (unexpected: the runner holds the lock)");
    } catch (e) {
      console.log(`sim: refresh-skills --claim-update during the run: exit ${e.status} (expected 14)`);
    }
    if (mode !== "failed") {
      mkdirSync(join(staging, "alpha"), { recursive: true });
      const cur = readFileSync(join(repo, ".claude/skills/alpha/SKILL.md"), "utf-8");
      writeFileSync(
        join(staging, "alpha", "SKILL.md"),
        cur.replace(
          /\n*$/,
          "\n`computeDiscountedTotal(prices, percent)` applies a percentage discount to that total.\n"
        )
      );
    }
    const action = mode === "failed" ? "failed" : "revised";
    writeFileSync(
      join(staging, "manifest.json"),
      JSON.stringify({ concepts: [{ id: "alpha", action, reason: `sim ${mode}` }] })
    );
    if (mode === "readonly") chmodSync(join(repo, ".claude/skills/alpha/SKILL.md"), 0o444);
    return { code: 0, stdout: `simulated session (${mode})`, stderr: "" };
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) {
    console.log("usage: node e2e-update-run.mjs [checkout] [--sim revised|failed|readonly] [--keep]");
    return 0;
  }
  const cli = join(o.checkout, "plugin", "scripts", "code-graph.cjs");
  const dist = join(o.checkout, "packages", "code-graph", "dist", "scribe", "update-run.js");
  for (const p of [cli, dist]) if (!existsSync(p)) throw new Error(`missing ${p}: run pnpm build in ${o.checkout}`);
  const mod = await import(pathToFileURL(dist).href);

  const repo = join(realpathSync(mkdtempSync(join(tmpdir(), "e2e-update-run-"))), "repo");
  mkdirSync(repo);
  console.log(`fixture: ${repo}`);
  console.log(`checkout: ${o.checkout}`);
  console.log(`mode: ${o.sim ? `--sim ${o.sim} (injected session, no claude)` : "real claude -p"}`);
  let code = 1;
  try {
    console.log(`skills status: ${buildFixture(repo, cli)}`);

    const env = { ...process.env };
    // This checkout's plugin (its skill text), not an installed older one.
    env[mod.PLUGIN_DIR_ENV] ??= join(o.checkout, "plugin");
    let launch = null;
    const trigger = await mod.maybeStartUpdate(repo, {
      env,
      cliScript: cli,
      ...(o.sim ? { claudeAvailable: () => true } : {}),
      spawn: (l) => {
        launch = l;
      },
    });
    console.log(`trigger: ${JSON.stringify(trigger)}`);
    if (!launch) {
      console.error("the trigger started nothing (for the real mode, is claude on PATH?)");
      return 2;
    }

    // Wrap the session to print exactly what the runner passes to claude.
    const real = o.sim ? simSession(o.sim, repo, cli, mod.CLAIMED_BY_RUNNER) : undefined;
    let seen = null;
    const claude = async (args, opts) => {
      seen = args;
      const at = (flag) => args[args.indexOf(flag) + 1];
      console.log(`\n=== prompt\n${at("-p")}`);
      console.log(`prompt carries the claimed line: ${at("-p").includes(mod.CLAIMED_BY_RUNNER)}`);
      console.log(`=== permission mode: ${at("--permission-mode")}`);
      console.log(`=== allowedTools\n${args.slice(args.indexOf("--allowedTools") + 1).join("\n")}\n`);
      if (real) return real(args, opts);
      return runRealClaude(args, opts);
    };
    const exit = await mod.runUpdate(launch.root, launch.lockToken, launch.concepts, { env, cliScript: cli, claude });
    if (!seen) console.log("(claude was not started)");
    console.log(`claude exit: ${exit}`);

    const report = join(launch.stateDir, mod.UPDATE_REPORT_FILE);
    const reportText = existsSync(report) ? readFileSync(report, "utf-8") : "";
    console.log(`\n=== report (${report})\n${reportText || "(missing)"}`);
    const state = join(launch.stateDir, mod.UPDATE_STATE_FILE);
    console.log(`=== state (${state})\n${existsSync(state) ? readFileSync(state, "utf-8") : "(missing)"}`);
    const git = (...a) => execFileSync("git", a, { cwd: repo }).toString();
    console.log(`=== git status --short\n${git("status", "--short") || "(clean)"}`);
    console.log(`=== git diff\n${git("diff")}`);

    const complete = /^- result: complete$/m.test(reportText);
    if (o.sim === "failed" || o.sim === "readonly") {
      console.log(complete ? "UNEXPECTED: result complete" : "expected: INCOMPLETE");
      if (o.sim === "readonly") console.log(`sandboxed line: ${/^- sandboxed: /m.test(reportText)}`);
    }
    console.log(`\nverdict: claude exit ${exit}, result ${complete ? "complete" : "INCOMPLETE"}`);
    code = exit === 0 && complete ? 0 : 1;
  } finally {
    if (o.keep) console.log(`fixture kept: ${repo}`);
    else {
      try {
        chmodSync(join(repo, ".claude/skills/alpha/SKILL.md"), 0o644);
      } catch {
        // not made read-only
      }
      rmSync(dirname(repo), { recursive: true, force: true });
    }
  }
  return code;
}

/** `claude` with the runner's args, its output streamed to the terminal as well as collected. */
function runRealClaude(args, o) {
  return import("node:child_process").then(
    ({ spawn }) =>
      new Promise((done) => {
        let stdout = "";
        let stderr = "";
        const child = spawn("claude", args, { cwd: o.cwd, env: o.env, stdio: ["ignore", "pipe", "pipe"] });
        const timer = setTimeout(() => child.kill("SIGTERM"), o.timeoutMs);
        child.stdout.on("data", (d) => {
          stdout += d;
          process.stdout.write(d);
        });
        child.stderr.on("data", (d) => {
          stderr += d;
          process.stderr.write(d);
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          done({ code: null, stdout, stderr: stderr + err.message });
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          done({ code, stdout, stderr });
        });
      })
  );
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`e2e-update-run: ${err.message}`);
      process.exit(2);
    }
  );
}
