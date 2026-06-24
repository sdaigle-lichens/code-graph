#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { getSystemDb, getProjectDb } from "./scribe/db.js";
import { tryLoadConfig } from "./config.js";
import { bootstrap } from "./scribe/bootstrap.js";
import { extract } from "./scribe/extract.js";
import { apply } from "./scribe/apply.js";
import { runConcept, runImpact, runCross, runVertex, runFile } from "./query/run.js";
import { search, applyTokenBudget, SearchNoResultsError } from "./query/search.js";
import { preflight } from "./query/preflight.js";
import {
  classifyStrength,
  computeGapReport,
  buildSuccessNote,
  formatGapDiagnostic,
  uncoveredSourceFiles,
} from "./query/gaps.js";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(pkgRoot, "docker-compose.arangodb.yml");
const pkg = JSON.parse(
  readFileSync(join(pkgRoot, "package.json"), "utf-8")
) as { version: string };

function runDockerCompose(...args: string[]) {
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, ...args],
    { stdio: "inherit" }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const program = new Command();
program.name("code-graph").version(pkg.version);

program
  .command("up")
  .description("start ArangoDB via Docker Compose")
  .action(() => runDockerCompose("up", "-d"));

program
  .command("down")
  .description("stop ArangoDB via Docker Compose")
  .action(() => runDockerCompose("down"));

program
  .command("status")
  .description("show ArangoDB and project DB status")
  .action(async () => {
    const url = process.env.ARANGO_URL ?? "http://localhost:8529";
    const ok = (label: string) => console.log(`  [✓] ${label}`);
    const fail = (label: string) => console.log(`  [✗] ${label}`);

    let reachable = false;
    try {
      const sysDb = getSystemDb();
      await sysDb.version();
      reachable = true;
    } catch {}

    reachable ? ok(`ArangoDB reachable (${url})`) : fail(`ArangoDB unreachable (${url})`);

    const config = tryLoadConfig(process.cwd());
    if (!config) {
      fail("scribe.config.json not found in CWD ancestry");
      return;
    }
    ok(`scribe.config.json found (project: ${config.project})`);

    if (!reachable) return;

    try {
      const dbName = process.env.ARANGO_DB ?? config.project;
      const sysDb = getSystemDb();
      const databases = await sysDb.listDatabases();
      const dbExists = databases.includes(dbName);
      dbExists ? ok(`DB "${dbName}" exists`) : fail(`DB "${dbName}" missing`);

      if (!dbExists) return;

      const db = getProjectDb(dbName);
      const collections = await db.listCollections();
      const colNames = collections.map((c) => c.name);

      for (const name of ["vertices", "edges", "docs", "concepts"]) {
        colNames.includes(name) ? ok(`collection ${name}`) : fail(`collection ${name} missing`);
      }

      const graph = db.graph("code_graph");
      const graphExists = await graph.exists();
      graphExists ? ok("graph code_graph") : fail("graph code_graph missing");

      const views = await db.listViews();
      const viewExists = views.some((v) => v.name === "code_search_view");
      viewExists ? ok("view code_search_view") : fail("view code_search_view missing");
    } catch (err) {
      console.error("error querying DB:", (err as Error).message);
    }
  });

program
  .command("view-db")
  .description("open ArangoDB web UI in browser")
  .action(() => {
    const url = process.env.ARANGO_URL ?? "http://localhost:8529";
    const open = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawnSync(open, [url], { stdio: "inherit" });
  });

program
  .command("bootstrap")
  .description("bootstrap graph collections for current project")
  .action(async () => {
    try {
      await bootstrap((msg) => console.log(msg));
      console.log("\nbootstrap complete");
    } catch (err) {
      console.error("bootstrap failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("extract <concept>")
  .description("extract AST for a concept")
  .action(async (concept: string) => {
    try {
      await extract(concept);
    } catch (err) {
      console.error("extract failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("apply <concept>")
  .description("apply enriched doc to graph")
  .option("--dry-run")
  .option("--approve-drift")
  .action(async (concept: string, opts: { dryRun?: boolean; approveDrift?: boolean }) => {
    try {
      await apply(concept, {
        dryRun: opts.dryRun ?? false,
        approveDrift: opts.approveDrift ?? false,
      });
    } catch (err) {
      console.error("apply failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("drift <concept>")
  .description("show drift for a concept (alias for apply --dry-run)")
  .action(async (concept: string) => {
    try {
      await apply(concept, { dryRun: true, approveDrift: false });
    } catch (err) {
      console.error("drift failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("search <query>")
  .description("natural language search over graph")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .option("--full-skill", "include full skill body in output (default: skill name only)")
  .action(async (query: string, opts: { maxTokens?: string; json?: boolean; fullSkill?: boolean }) => {
    try {
      const maxTokens = parseInt(opts.maxTokens ?? "3000", 10);
      const json = opts.json ?? false;
      const skillMode = opts.fullSkill ? "full" : "names";
      const result = await search(query, { maxTokens, json, skillMode });
      const strength = classifyStrength(result);

      if (json) {
        // JSON mode is the contract for the eval harness — always include gaps.
        const { db, config } = await preflight();
        const gaps = await computeGapReport(db, config);
        console.log(JSON.stringify({ ...result, strength, gaps }, null, 2));
        return;
      }

      let md = applyTokenBudget(result, maxTokens, { skillMode });
      // Lazy: only pay for the gap computation when results are thin.
      if (strength === "thin") {
        const { db, config } = await preflight();
        const report = await computeGapReport(db, config);
        const note = buildSuccessNote(report);
        if (note) md += `\n\n${note}`;
      }
      console.log(md);
    } catch (err) {
      if (err instanceof SearchNoResultsError) {
        // Whiff: surface what's missing before falling back. Best-effort.
        try {
          const { db, config } = await preflight();
          const report = await computeGapReport(db, config);
          const uncovered = uncoveredSourceFiles(config);
          if (report.fixable.length || report.unenrichable.length || uncovered.length) {
            console.log(formatGapDiagnostic(report, uncovered));
          }
        } catch {
          // diagnostic is additive; never let it mask the underlying whiff
        }
        console.error(err.message);
        process.exit(6);
      }
      console.error("search failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("eval")
  .description("run layer-A eval harness against eval/tasks.json")
  .option("--tasks <path>", "path to tasks.json")
  .action(async (opts: { tasks?: string }) => {
    const { existsSync } = await import("node:fs");
    const { runEval } = await import("./eval/harness.js");
    const config = tryLoadConfig(process.cwd());

    let tasksPath = opts.tasks;
    if (!tasksPath) {
      const configRootTasks = config ? join(config.configRoot, "eval", "tasks.json") : null;
      const pkgTasks = join(pkgRoot, "eval", "tasks.json");
      if (configRootTasks && existsSync(configRootTasks)) {
        tasksPath = configRootTasks;
      } else if (existsSync(pkgTasks)) {
        tasksPath = pkgTasks;
      } else {
        console.error("no eval/tasks.json found; pass --tasks <path>");
        process.exit(1);
      }
    }

    const outputDir = config ? join(config.configRoot, "eval") : join(pkgRoot, "eval");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outputDir, { recursive: true });

    console.log(`running eval from ${tasksPath}`);
    const run = await runEval(tasksPath, outputDir);
    const verdict = run.regressions.length === 0 ? "green" : "REGRESSIONS";
    console.log(`\n${verdict}: ${run.passed}/${run.total} passed, ${run.skipped} skipped`);
    if (run.regressions.length > 0) {
      console.log("failed:", run.regressions.join(", "));
      process.exit(1);
    }
  });

const query = program.command("query").description("graph query subcommands");

query
  .command("concept <name>")
  .description("query a concept subgraph")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .option("--no-skill", "omit skill context")
  .action(async (name: string, opts: { maxTokens?: string; json?: boolean; skill?: boolean }) => {
    try {
      await runConcept(name, {
        maxTokens: parseInt(opts.maxTokens ?? "3000", 10),
        json: opts.json ?? false,
        skill: opts.skill !== false,
      });
    } catch (err) {
      console.error("query concept failed:", (err as Error).message);
      process.exit(1);
    }
  });

query
  .command("impact <symbol>")
  .description("query impact of a symbol")
  .option("--direction <dir>", "in|out|both", "both")
  .option("--max <n>", "max results", "20")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .action(async (symbol: string, opts: { direction?: string; max?: string; maxTokens?: string; json?: boolean }) => {
    const dir = (opts.direction ?? "both") as "in" | "out" | "both";
    try {
      await runImpact(symbol, {
        direction: dir,
        max: parseInt(opts.max ?? "20", 10),
        maxTokens: parseInt(opts.maxTokens ?? "3000", 10),
        json: opts.json ?? false,
      });
    } catch (err) {
      console.error("query impact failed:", (err as Error).message);
      process.exit(1);
    }
  });

query
  .command("cross <conceptA> <conceptB>")
  .description("query cross-concept relationships")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .action(async (conceptA: string, conceptB: string, opts: { maxTokens?: string; json?: boolean }) => {
    try {
      await runCross(conceptA, conceptB, {
        maxTokens: parseInt(opts.maxTokens ?? "3000", 10),
        json: opts.json ?? false,
      });
    } catch (err) {
      console.error("query cross failed:", (err as Error).message);
      process.exit(1);
    }
  });

query
  .command("vertex <location>")
  .description("query vertex by filepath:line, name, concept::name, or filepath:name")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .action(async (location: string, opts: { maxTokens?: string; json?: boolean }) => {
    try {
      await runVertex(location, {
        maxTokens: parseInt(opts.maxTokens ?? "3000", 10),
        json: opts.json ?? false,
      });
    } catch (err) {
      console.error("query vertex failed:", (err as Error).message);
      process.exit(1);
    }
  });

query
  .command("file <filepath>")
  .description("query all live vertices in a file with their immediate edges")
  .option("--max-tokens <n>", "max tokens", "5000")
  .option("--json", "output JSON")
  .action(async (filepath: string, opts: { maxTokens?: string; json?: boolean }) => {
    try {
      await runFile(filepath, {
        maxTokens: parseInt(opts.maxTokens ?? "5000", 10),
        json: opts.json ?? false,
      });
    } catch (err) {
      console.error("query file failed:", (err as Error).message);
      process.exit(1);
    }
  });

program.parse();
