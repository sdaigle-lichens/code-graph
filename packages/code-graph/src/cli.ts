#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning on first use. The LSP surfaces this
// process's stderr and the plugin skills read it, so the warning is dropped
// before anything can touch the store. Must run before those imports.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

import { statSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { tryLoadConfig } from "./config.js";
import { registerSkillsCommands } from "./skills/commands.js";
import { packageRoot, packageVersion } from "./version.js";

// Everything that touches the store (node:sqlite) or the TypeScript compiler (ts-morph) is imported
// lazily, inside the command that needs it. The `skills` group is layer 1 — it runs in repos with
// no graph and no TypeScript, on any supported Node — so loading this file must pull in neither,
// and the bundled plugin script resolves ts-morph from the project only when a graph command asks.
const lazy = {
  db: () => import("./scribe/db.js"),
  bootstrap: () => import("./scribe/bootstrap.js"),
  run: () => import("./query/run.js"),
  search: () => import("./query/search.js"),
  preflight: () => import("./query/preflight.js"),
  gaps: () => import("./query/gaps.js"),
};

/** `search` printed results but the top cluster is weak or un-enriched; the caller should verify (grep, SKILL.md). */
const EXIT_LOW_CONFIDENCE = 7;

/**
 * True (after printing why) when the config declares no concepts: graph commands that iterate
 * concepts then exit 0 without loading typescript, ts-morph or the store. A missing config still
 * exits 5 inside `loadConfig`.
 */
async function skippedForNoConcepts(command: string): Promise<boolean> {
  const { loadConfig } = await import("./config.js");
  if (Object.keys(loadConfig(process.cwd()).concepts).length > 0) return false;
  console.log(`${command}: no concepts configured in scribe.config.json, skipped`);
  return true;
}

const program = new Command();
program.name("code-graph").version(packageVersion());

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

    const { resolveDbPath } = await lazy.db();
    const { bootstrapStore, SCHEMA_VERSION } = await lazy.bootstrap();
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
    const { resolveDbPath } = await lazy.db();
    const { bootstrapStore } = await lazy.bootstrap();
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
    const { resolveDbPath } = await lazy.db();
    const { bootstrapStore, rebuildSearchIndex } = await lazy.bootstrap();
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
      if (await skippedForNoConcepts("extract")) return;
      // A docs-only concept needs no TypeScript compiler, so it must not load ts-morph.
      const { loadConfig } = await import("./config.js");
      const { isDocsOnly, extractDocsOnly } = await import("./scribe/ast-output.js");
      const config = loadConfig(process.cwd());
      if (config.concepts[concept] && isDocsOnly(config, concept)) {
        await extractDocsOnly(config, concept);
        return;
      }
      const { extract } = await import("./scribe/extract.js");
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
  .option("--json", "with --dry-run: emit the drift as JSON (names and files)")
  .action(async (concept: string, opts: { dryRun?: boolean; approveDrift?: boolean; json?: boolean }) => {
    try {
      if (opts.json && !opts.dryRun) {
        console.error("apply failed: --json needs --dry-run");
        process.exit(1);
      }
      if (await skippedForNoConcepts("apply")) return;
      const { apply } = await import("./scribe/apply.js");
      await apply(concept, {
        dryRun: opts.dryRun ?? false,
        approveDrift: opts.approveDrift ?? false,
        json: opts.json ?? false,
      });
    } catch (err) {
      console.error("apply failed:", (err as Error).message);
      process.exit(1);
    }
  });

const enrich = program.command("enrich").description("incremental enrichment: list targets, merge partial results");

enrich
  .command("targets <concept>")
  .description(
    "list vertices that need enrichment: changed, stale, and never-enriched ones that are core or new/changed since the previous apply"
  )
  .option("--vertex <name...>", "list just these vertices (name or _key), with full details")
  .option("--all", "list every never-enriched vertex, not only core and touched ones (whole-concept enrichment)")
  .option("--summary", "counts per reason, the core block and one short line per target (no edge arrays)")
  .option("--core", "no-op: core-first is the default (kept for older skills)")
  .option("--json", "output JSON")
  .action(
    async (
      concept: string,
      opts: { vertex?: string[]; json?: boolean; core?: boolean; all?: boolean; summary?: boolean }
    ) => {
      try {
        if (await skippedForNoConcepts("enrich targets")) return;
        const { enrichTargets } = await import("./scribe/enrich.js");
        enrichTargets(concept, {
          vertices: opts.vertex ?? [],
          json: opts.json ?? false,
          all: opts.all ?? false,
          summary: opts.summary ?? false,
          core: opts.core ?? false,
        });
      } catch (err) {
        console.error("enrich targets failed:", (err as Error).message);
        process.exit(1);
      }
    }
  );

enrich
  .command("merge <concept> <partial>")
  .description("merge a partial enrichment into <concept>.enriched.json (upsert by _key), then run apply")
  .action(async (concept: string, partial: string) => {
    try {
      if (await skippedForNoConcepts("enrich merge")) return;
      const { enrichMerge } = await import("./scribe/enrich.js");
      enrichMerge(concept, partial);
    } catch (err) {
      console.error("enrich merge failed:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("drift <concept>")
  .description("show drift for a concept (alias for apply --dry-run)")
  .option("--json", "emit the drift as JSON (names and files)")
  .action(async (concept: string, opts: { json?: boolean }) => {
    try {
      if (await skippedForNoConcepts("drift")) return;
      const { apply } = await import("./scribe/apply.js");
      await apply(concept, { dryRun: true, approveDrift: false, json: opts.json ?? false });
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
    const { search, applyTokenBudget, budgetSearchJson, SearchNoResultsError } = await lazy.search();
    const { preflight } = await lazy.preflight();
    const {
      classifyStrength,
      computeGapReport,
      compactGaps,
      buildSuccessNote,
      formatGapDiagnostic,
      uncoveredSourceFiles,
    } = await lazy.gaps();
    try {
      const maxTokens = parseInt(opts.maxTokens ?? "3000", 10);
      const json = opts.json ?? false;
      const skillMode = opts.fullSkill ? "full" : "names";
      const result = await search(query, { maxTokens, json, skillMode });
      const strength = classifyStrength(result);

      if (json) {
        // Always include strength and gaps; trim the rest to --max-tokens (the eval harness calls search() directly).
        const { db, config } = await preflight();
        const gaps = compactGaps(await computeGapReport(db, config));
        const low = result.confidence?.low === true;
        const extra = {
          strength,
          gaps,
          low_confidence: low,
          ...(low ? { low_confidence_reason: result.confidence?.reason } : {}),
        };
        console.log(JSON.stringify(budgetSearchJson(result, extra, maxTokens), null, 2));
        if (low) process.exitCode = EXIT_LOW_CONFIDENCE;
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
      if (result.confidence?.low) process.exitCode = EXIT_LOW_CONFIDENCE;
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
    const pkgRoot = packageRoot();
    if (!tasksPath) {
      const configRootTasks = config ? join(config.configRoot, "eval", "tasks.json") : null;
      const pkgTasks = pkgRoot ? join(pkgRoot, "eval", "tasks.json") : null;
      if (configRootTasks && existsSync(configRootTasks)) {
        tasksPath = configRootTasks;
      } else if (pkgTasks && existsSync(pkgTasks)) {
        tasksPath = pkgTasks;
      } else {
        console.error("no eval/tasks.json found; pass --tasks <path>");
        process.exit(1);
      }
    }

    const outputDir = join(config?.configRoot ?? pkgRoot ?? process.cwd(), "eval");
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
      const { runConcept } = await lazy.run();
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
      const { runImpact } = await lazy.run();
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
      const { runCross } = await lazy.run();
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
      const { runVertex } = await lazy.run();
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
      const { runFile } = await lazy.run();
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

const deps = program.command("deps").description("manage the plugin-owned ts-morph install used by graph commands");

deps
  .command("install")
  .description("install pinned ts-morph into the plugin deps directory (downloads from the npm registry)")
  .action(async () => {
    const { depsInstall } = await import("./deps.js");
    process.exitCode = depsInstall();
  });

deps
  .command("status")
  .description("show where ts-morph resolves from: plugin deps directory, then the project")
  .action(async () => {
    const { depsStatus } = await import("./deps.js");
    depsStatus();
  });

registerSkillsCommands(program);

program.parseAsync().catch((err: Error) => {
  // The bundled plugin script resolves ts-morph from the plugin deps directory, then the project;
  // when neither has it the error lands here, and that message (naming `deps install`) is the diagnosis.
  console.error(`code-graph: ${err?.message ?? err}`);
  process.exit(1);
});
