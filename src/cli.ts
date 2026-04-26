#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { getSystemDb, getProjectDb } from "./scribe/db.js";
import { tryLoadConfig } from "./config.js";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const composeFile = join(pkgRoot, "docker-compose.arangodb.yml");
const pkg = JSON.parse(
  readFileSync(join(pkgRoot, "package.json"), "utf-8")
) as { version: string };

function notImplemented() {
  console.error("not implemented yet");
  process.exit(1);
}

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

    let reachable = false;
    try {
      const sysDb = getSystemDb();
      await sysDb.version();
      reachable = true;
    } catch {}

    console.log(`ArangoDB (${url}): ${reachable ? "reachable" : "unreachable"}`);

    const config = tryLoadConfig(process.cwd());
    if (!config) {
      console.log("no scribe.config.json found in CWD ancestry");
      return;
    }

    const dbName = process.env.ARANGO_DB ?? config.project;
    console.log(`project DB: ${dbName}`);

    if (!reachable) return;

    try {
      const sysDb = getSystemDb();
      const databases = await sysDb.listDatabases();
      const exists = databases.includes(dbName);
      console.log(`DB exists: ${exists ? "yes" : "no"}`);

      if (exists) {
        const db = getProjectDb(dbName);
        const collections = await db.listCollections();
        const hasConcepts = collections.some((c) => c.name === "concepts");
        if (hasConcepts) {
          const col = db.collection("concepts");
          const count = await col.count();
          console.log(`concepts collection: ${count.count} documents`);
        } else {
          console.log("concepts collection: not found");
        }
      }
    } catch (err) {
      console.error("error querying DB:", (err as Error).message);
    }
  });

program
  .command("bootstrap")
  .description("bootstrap graph collections for current project")
  .action(notImplemented);

program
  .command("extract <concept>")
  .description("extract AST for a concept")
  .action(notImplemented);

program
  .command("apply <concept>")
  .description("apply enriched doc to graph")
  .option("--dry-run")
  .option("--approve-drift")
  .action(notImplemented);

program
  .command("drift <concept>")
  .description("show drift for a concept")
  .action(notImplemented);

program
  .command("search <query>")
  .description("natural language search over graph")
  .action(notImplemented);

const query = program.command("query").description("graph query subcommands");

query
  .command("concept <name>")
  .description("query a concept subgraph")
  .option("--depth <n>", "traversal depth", "1")
  .option("--max-tokens <n>", "max tokens", "3000")
  .option("--json", "output JSON")
  .option("--no-skill", "omit skill context")
  .action(notImplemented);

query
  .command("impact <symbol>")
  .description("query impact of a symbol")
  .option("--direction <dir>", "in|out|both", "both")
  .option("--max <n>", "max results", "20")
  .action(notImplemented);

query
  .command("cross <conceptA> <conceptB>")
  .description("query cross-concept relationships")
  .action(notImplemented);

query
  .command("vertex <location>")
  .description("query vertex by filepath:line")
  .action(notImplemented);

program.parse();
