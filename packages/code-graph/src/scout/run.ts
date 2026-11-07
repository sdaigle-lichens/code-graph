// `code-graph scout <scope-file>`: everything of the refactor scout that costs no model call. It turns a
// scope file into at most MAX_SESSIONS prompt files, one per Haiku session, and reports what it left out.
// The plugin skill `refactor-scout` spawns the sessions: this code never calls a model.
//
// The primer needs both halves of the index. The store knows each file's concept and the cross-concept
// relations; it holds no import edges, so fan-in, fan-out, hubs, cycles and exports come from the catalog,
// as they did in the bench. That is why a missing tsconfig stops the run as a missing store does: the bench
// never measured a scout without its primer.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { CatalogResult } from "../catalog/catalog.js";
import type { ScribeConfig } from "../config.js";
import { formatCross } from "../query/format.js";
import { loadConfigOrExit, preflight, storeExists } from "../query/preflight.js";
import { queryCross } from "../query/queries.js";
import {
  buildMetricsPrimer,
  buildScopeBlock,
  crossImportEdges,
  findCycles,
  unusedExports,
  type CrossSection,
} from "./primer.js";
import { scoutPrompt } from "./prompt.js";
import {
  findRepoRoot,
  MAX_FILES_PER_SESSION,
  MAX_SESSIONS,
  readScope,
  ScopeFileError,
  splitScope,
  type SkippedLine,
} from "./scope.js";

/** The scope file itself is missing or unreadable. */
export const EXIT_SCOUT_NO_SCOPE = 11;
/** No index or no tsconfig: the primer cannot be built and the scout does not run without it. */
export const EXIT_SCOUT_NO_PRIMER = 12;

/** Concept pairs of one primer that get a `query cross` section, as the bench capped them. */
const MAX_CROSS_SECTIONS = 4;
/** `query cross` output budget, the CLI's default. */
const CROSS_MAX_TOKENS = 3000;
/** A source larger than this is generated or data: the unused-export scan skips it. */
const MAX_SOURCE_BYTES = 2e6;
const SOURCE_FILE = /\.(ts|tsx|cjs|mjs)$/;

export type ScoutSession = { prompt: string; files: string[] };
export type ScoutPlan = {
  /** The git root: every path of the plan and of the prompts is relative to it. */
  root: string;
  /** Usable scope lines. */
  scope: number;
  sessions: ScoutSession[];
  /**
   * Where the skill writes the sessions' returned sections for `scout --proposals <file>` (absolute, in the
   * prompt directory), or null when no session was planned. A file, not a heredoc, so the skill's step 3 is one
   * plain command its `allowed-tools` pattern matches.
   */
  answers: string | null;
  /** Files in the index, past the session cap. */
  notScanned: string[];
  /** Existing files the index does not cover. */
  ignored: number;
  skippedLines: SkippedLine[];
  /** Why no session was planned, or null when one was. An empty plan is no result, never a clean one. */
  nothingScanned: string | null;
};

/** A stop the caller reports in one line and exits on. */
export class ScoutStop extends Error {
  constructor(
    message: string,
    readonly exitCode: number
  ) {
    super(message);
  }
}

const noPrimer = (reason: string) =>
  new ScoutStop(`refactor-scout: ${reason}, so no metrics primer and no proposals`, EXIT_SCOUT_NO_PRIMER);

function hasLiveVertices(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM vertices WHERE status = 'live' LIMIT 1").get() !== undefined;
}

/**
 * The config's `tsconfig` key, with no auto-detection: without the key `extract` treats every concept as
 * docs-only and stores no code vertex, so a tsconfig found on disk would not bring the index back, and
 * `extract` + `apply` would never fix a stop reported as "no index".
 */
function declaredTsconfig(config: ScribeConfig): string {
  if (!config.tsconfig) throw noPrimer("no `tsconfig` key in scribe.config.json");
  return join(config.configRoot, config.tsconfig);
}

async function loadCatalog(root: string, tsconfig: string): Promise<CatalogResult> {
  if (!existsSync(tsconfig)) throw noPrimer("no tsconfig");
  // Lazy, and inside the try: a missing ts-morph surfaces here, and its error names `deps install`.
  try {
    const { runCatalog } = await import("../catalog/catalog.js");
    return await runCatalog({ root, tsconfig });
  } catch (err) {
    throw noPrimer(`no catalog (${(err as Error).message.split("\n")[0]})`);
  }
}

/** Every source file's text, for the unused-export scan. An unreadable entry is skipped: a lead, not a gate. */
function readSources(root: string, dir = "", out: Array<{ file: string; text: string }> = []) {
  let entries;
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "scribe-output" || e.name === "dist")
      continue;
    const file = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      readSources(root, file, out);
      continue;
    }
    if (!SOURCE_FILE.test(e.name)) continue;
    try {
      if (statSync(join(root, file)).size < MAX_SOURCE_BYTES) {
        out.push({ file, text: readFileSync(join(root, file), "utf8") });
      }
    } catch {
      // A broken symlink, or a file gone since the listing.
    }
  }
  return out;
}

/**
 * The catalog with its paths moved from the config root to the git root, so that scope lines, prompts and
 * the agents' proposals all speak the paths the scope file came in. The store is the one thing left on
 * config-root paths: `conceptLookup` takes them back.
 */
function rebaseCatalog(catalog: CatalogResult, inRepo: (file: string) => string): CatalogResult {
  const keys = (counts: Record<string, number>) =>
    Object.fromEntries(Object.entries(counts).map(([file, n]) => [inRepo(file), n]));
  return {
    ...catalog,
    files: catalog.files.map((f) => ({ ...f, path: inRepo(f.path) })),
    imports: catalog.imports.map((e) => ({ ...e, from: inRepo(e.from), to: inRepo(e.to) })),
    fanIn: keys(catalog.fanIn),
    fanOut: keys(catalog.fanOut),
    hubs: catalog.hubs.map(inRepo),
  };
}

function conceptLookup(db: DatabaseSync, prefix: string): (file: string) => string {
  const statement = db.prepare(
    "SELECT concept FROM vertices WHERE filepath = ? AND status = 'live' ORDER BY start_line ASC LIMIT 1"
  );
  const memo = new Map<string, string>();
  return (file) => {
    const stored = file.slice(prefix.length);
    if (!memo.has(file)) memo.set(file, (statement.get(stored) as { concept: string } | undefined)?.concept ?? "");
    return memo.get(file)!;
  };
}

async function crossSections(db: DatabaseSync, concepts: string[]): Promise<CrossSection[]> {
  const out: CrossSection[] = [];
  for (let i = 0; i < concepts.length; i++) {
    for (let j = i + 1; j < concepts.length && out.length < MAX_CROSS_SECTIONS; j++) {
      const [a, b] = [concepts[i], concepts[j]];
      const { entries } = await queryCross(db, a, b);
      const text = formatCross(entries, a, b, { maxTokens: CROSS_MAX_TOKENS, includeSkill: false, json: false });
      out.push({ a, b, text });
    }
  }
  return out;
}

async function sessionPrompt(
  files: string[],
  {
    db,
    catalog,
    sources,
    cycles,
    prefix,
  }: {
    db: DatabaseSync;
    catalog: CatalogResult;
    sources: ReturnType<typeof readSources>;
    cycles: string[][];
    prefix: string;
  }
): Promise<string> {
  const conceptOf = conceptLookup(db, prefix);
  const inSession = new Set(files);
  const digest = new Map(catalog.files.map((f) => [f.path, f]));
  const exportsOf = (file: string) => digest.get(file)?.exports ?? [];
  const concepts = [...new Set(files.map(conceptOf).filter(Boolean))].sort();
  const primer = buildMetricsPrimer({
    files: files.map((file) => ({
      file,
      concept: conceptOf(file),
      fanIn: catalog.fanIn[file] ?? 0,
      fanOut: catalog.fanOut[file] ?? 0,
      exports: exportsOf(file).length,
    })),
    hubs: files.filter((f) => catalog.hubs.includes(f)),
    cycles: cycles.filter((comp) => comp.some((f) => inSession.has(f))),
    unused: unusedExports(
      files.map((file) => ({ file, exports: exportsOf(file) })),
      sources
    ),
    crossEdges: crossImportEdges(catalog.imports, inSession, conceptOf),
    cross: await crossSections(db, concepts),
  });
  return scoutPrompt(buildScopeBlock(files.map((file) => ({ file, concept: conceptOf(file) }))), primer);
}

/** The skill writes the returned sections here; the next run's `freshPromptDir` removes it. */
const ANSWERS_FILE = "answers.md";

/** Inside the project so a session reads it without a permission prompt; ignored even where `scribe-output/` is committed. */
function freshPromptDir(root: string): string {
  const dir = join(root, "scribe-output", "scout");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "*\n");
  return dir;
}

/**
 * Reads the scope, checks the index, splits the scope and writes one prompt file per session. Throws
 * `ScoutStop` when the run must not happen; an empty plan (no session) is a finished run, not a stop.
 * The scope is read first so that a bad path is reported whatever the state of the index.
 */
export async function planScout(scopePath: string): Promise<ScoutPlan> {
  const config = loadConfigOrExit();
  const root = config.configRoot;
  const repoRoot = findRepoRoot(root);
  let scope;
  try {
    scope = readScope(scopePath, repoRoot, root);
  } catch (err) {
    if (err instanceof ScopeFileError) throw new ScoutStop(`refactor-scout: ${err.message}`, EXIT_SCOUT_NO_SCOPE);
    throw err;
  }

  const tsconfig = declaredTsconfig(config);
  if (!storeExists(config)) throw noPrimer("no index");
  const { db } = await preflight();
  if (!hasLiveVertices(db)) throw noPrimer("no index");
  const subdir = relative(repoRoot, root);
  const prefix = subdir ? `${subdir}/` : "";
  const inRepo = (file: string) => `${prefix}${file}`;
  const catalog = rebaseCatalog(await loadCatalog(root, tsconfig), inRepo);

  const indexed = new Set(catalog.files.map((f) => f.path));
  const covered = scope.files.filter((f) => indexed.has(f));
  const { sessions, notScanned } = splitScope(covered, catalog.imports);

  const dir = freshPromptDir(root);
  const context = {
    db,
    catalog,
    sources: sessions.length > 0 ? readSources(root).map((source) => ({ ...source, file: inRepo(source.file) })) : [],
    cycles: findCycles(catalog.imports),
    prefix,
  };
  const planned: ScoutSession[] = [];
  for (const [i, files] of sessions.entries()) {
    const prompt = join(dir, `session-${i + 1}.md`);
    writeFileSync(prompt, await sessionPrompt(files, context));
    planned.push({ prompt, files });
  }
  const ignored = scope.files.length - covered.length;
  return {
    root: repoRoot,
    scope: scope.files.length,
    sessions: planned,
    answers: planned.length > 0 ? join(dir, ANSWERS_FILE) : null,
    notScanned,
    ignored,
    skippedLines: scope.skipped,
    nothingScanned: planned.length > 0 ? null : whyNothingScanned(ignored, scope.skipped.length),
  };
}

function whyNothingScanned(ignored: number, skipped: number): string {
  if (ignored > 0) return `no file in scope is in the code index (${ignored} ignored)`;
  if (skipped > 0) return `no scope line is a usable file (${skipped} skipped)`;
  return "the scope file lists no files";
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What the skill reads. With no session there is nothing to spawn and nothing to report: the plan says so
 * itself and never prints a `PROPOSALS:` line, which only a scan that ran can answer.
 */
export function formatPlan(plan: ScoutPlan): string {
  const lines = [
    `scout: ${plural(plan.scope, "file")} in scope, ${plural(plan.sessions.length, "session")} (at most ${MAX_FILES_PER_SESSION} files each, at most ${MAX_SESSIONS} sessions)`,
    `root: ${plan.root}`,
  ];
  if (plan.answers) lines.push(`answers: ${plan.answers}`);
  plan.sessions.forEach((s, i) => lines.push(`session ${i + 1}: ${s.prompt}: ${s.files.join(", ")}`));
  if (plan.ignored > 0) lines.push(`ignored: ${plural(plan.ignored, "file")} outside the code index`);
  if (plan.notScanned.length > 0) {
    const count = plural(plan.notScanned.length, "file");
    lines.push(`not scanned: ${count} past the session cap: ${plan.notScanned.join(", ")}`);
  }
  if (plan.skippedLines.length > 0) {
    const named = plan.skippedLines.map((s) => `${s.line} (${s.reason})`).join(", ");
    lines.push(`skipped lines: ${plan.skippedLines.length}: ${named}`);
  }
  if (plan.nothingScanned) {
    lines.push(`nothing scanned: ${plan.nothingScanned}; this is not a clean result, the scout read no code`);
  }
  return lines.join("\n");
}
