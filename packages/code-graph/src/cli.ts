#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning on first use. The LSP surfaces this
// process's stderr and the plugin skills read it, so the warning is dropped
// before anything can touch the store. Must run before those imports.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { resolveDbPath } from "./scribe/db.js";
import { tryLoadConfig } from "./config.js";
import { bootstrapStore, rebuildSearchIndex, SCHEMA_VERSION } from "./scribe/bootstrap.js";
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
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf-8")) as { version: string };

const program = new Command();
program.name("code-graph").version(pkg.version);

program
  .command("status")
  .description("show graph store status for the current project")
  .action(async () => {
    const ok = (label: string) => console.log(`  [\u2713] ${label}`);
    const fail = (label: string) => console.log(`  [\u2717] ${label}`);

    const config = tryLoadConfig(process.cwd());
    if (!config) {
      fail("scribe.config.json not found in CWD ancestry");
      return;
    }
    ok(`scribe.config.json found (project: ${config.project})`);

    const dbPath = resolveDbPath(config);
    let bytes: number | null = null;
    try {
      bytes = statSync(dbPath).size;
    } catch {}
    if (bytes === null) {
      fail(`store ${dbPath} missing \u2014 run \`code-graph bootstrap\``);
      return;
    }
    ok(`store ${dbPath} (${(bytes / 1024).toFixed(0)} KiB)`);

    try {
      const store = bootstrapStore(dbPath);

      const version = (store.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      version <= SCHEMA_VERSION
        ? ok(`schema v${version}`)
        : fail(`schema v${version} is newer than this CLI (v${SCHEMA_VERSION}) \u2014 upgrade code-graph`);

      const integrity = (store.prepare("PRAGMA integrity_check").get() as Record<string, string>).integrity_check;
      integrity === "ok" ? ok("integrity_check ok") : fail(`integrity_check: ${integrity}`);

      const count = (table: string) => (store.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
      for (const table of ["vertices", "edges", "docs", "concepts"]) {
        const n = count(table);
        n > 0 ? ok(`${table}: ${n}`) : fail(`${table}: empty`);
      }

      // A stale index is the one failure mode the wholesale rebuild can leave
      // behind, and it is invisible from query results alone.
      const indexed = count("search_fts");
      const expected = count("vertices") + count("docs");
      indexed === expected
        ? ok(`search index: ${indexed} rows`)
        : fail(`search index has ${indexed} rows, expected ${expected} \u2014 run \`code-graph reindex\``);
    } catch (err) {
      console.error("error reading store:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("bootstrap")
  .description("create the graph store for the current project")
  .action(async () => {
    const config = tryLoadConfig(process.cwd());
    if (!config) {
      console.error(`no scribe.config.json found above ${process.cwd()}`);
      process.exit(5);
    }
    const dbPath = resolveDbPath(config);
    try {
      bootstrapStore(dbPath);
      console.log(`store ready: ${dbPath}`);
    } catch (err) {
      console.error("bootstrap failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("reindex")
  .description("rebuild the full-text search index from the stored graph")
  .action(async () => {
    const config = tryLoadConfig(process.cwd());
    if (!config) {
      console.error(`no scribe.config.json found above ${process.cwd()}`);
      process.exit(5);
    }
    try {
      const store = bootstrapStore(resolveDbPath(config));
      rebuildSearchIndex(store);
      const n = (store.prepare("SELECT count(*) AS c FROM search_fts").get() as { c: number }).c;
      console.log(`search index rebuilt: ${n} rows`);
    } catch (err) {
      console.error("reindex failed:", (err as Error).message);
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

program
  .command("catalog")
  .description("repo-wide ts-morph digest: units, exports, import adjacency, fan-in/out")
  .option("--json", "output JSON (required for machine consumption)")
  .option("--tsconfig <path>", "path to tsconfig (auto-detected if omitted)")
  .option("--hub-min-fan-in <n>", "fan-in threshold for hub detection", "5")
  .action(async (opts: { json?: boolean; tsconfig?: string; hubMinFanIn?: string }) => {
    if (!opts.json) {
      console.error("error: --json is required (catalog output is always JSON)");
      process.exit(1);
    }
    const { runCatalog, resolveTsconfig } = await import("./catalog/catalog.js");
    const cwd = process.cwd();
    const tsconfig = resolveTsconfig(cwd, opts.tsconfig);
    if (!tsconfig) {
      console.error("error: no tsconfig found in CWD — pass --tsconfig <path>");
      process.exit(1);
    }
    try {
      const result = await runCatalog({
        root: cwd,
        tsconfig,
        hubMinFanIn: parseInt(opts.hubMinFanIn ?? "5", 10),
      });
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error("catalog failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("delete-concept <name>")
  .description("archive a concept: marks vertices/edges archived, removes from config + artifacts")
  .option("--yes", "skip interactive confirmation")
  .action(async (name: string, opts: { yes?: boolean }) => {
    const { deleteConcept } = await import("./scribe/delete-concept.js");
    await deleteConcept(name, { yes: opts.yes ?? false });
  });

program.parse();
