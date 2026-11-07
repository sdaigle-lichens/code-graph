// `code-graph refresh-skills`: re-run extract + apply for every concept whose SKILL.md changed since
// its last apply. The plugin's Stop / SubagentStop hook runs it with `--hook`, so the "a written
// SKILL.md is followed by extract + apply" rule no longer depends on an agent remembering it.
//
// Detection is a hash compare: the SKILL.md on disk (`readConceptSkill`, the same bytes and hash
// `extract` writes) against the store's `docs/<concept>::skill` `body_hash`. Concepts that were never
// applied are left alone (a first ingest is `add-concept`'s job, not a stop hook's).
//
// Each concept runs as child processes of this same CLI (`extract <c>`, then `apply <c>
// --defer-renames`): extract and apply print to stdout and `process.exit`, which must not reach the
// hook's own stdout (Claude Code parses it as JSON) or end the run early. A rename candidate makes
// apply write nothing and exit `EXIT_RENAMES_DEFERRED`; the concept is reported, never applied.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tryLoadConfig, type ScribeConfig } from "../config.js";
import { readConceptSkill } from "./ast-output.js";
import { EXIT_RENAMES_DEFERRED } from "./exit-codes.js";

// Defined in ./exit-codes.ts (shared with apply, which must not import this hook module); re-exported.
export { EXIT_RENAMES_DEFERRED };

/**
 * The plugin hook's timeout (plugin/hooks/hooks.json `timeout`, seconds). A lock older than this
 * belongs to a run Claude Code has already killed, so it is taken over.
 */
export const HOOK_TIMEOUT_SECONDS = 120;

const LOCK_FILE = ".refresh-skills.lock";

export type ChangedSkill = { concept: string; skillPath: string };

export type RefreshOutcome =
  | { concept: string; status: "refreshed" }
  | { concept: string; status: "deferred"; detail: string }
  | { concept: string; status: "failed"; step: "extract" | "apply"; detail: string };

export type RefreshReport = {
  /** Why nothing ran; absent when detection ran (even if it found nothing). */
  skipped?: string;
  changed: string[];
  results: RefreshOutcome[];
  ms: number;
};

/** Why a refresh cannot run here, or null. Every reason is a silent no-op for the hook. */
export function refreshSkipReason(config: ScribeConfig | null): string | null {
  if (!config) return "no scribe.config.json";
  if (Object.keys(config.concepts).length === 0) return "no concepts configured";
  if (!config.tsconfig || !existsSync(resolve(config.configRoot, config.tsconfig))) return "no tsconfig";
  if (!isBuiltin("node:sqlite")) return "node:sqlite unavailable";
  return null;
}

/** Concepts whose SKILL.md differs from the body last applied to the store at `dbPath`. */
export async function changedSkillConcepts(config: ScribeConfig, dbPath: string): Promise<ChangedSkill[]> {
  const { getStore } = await import("./db.js");
  const { docKey, getRecord } = await import("./rows.js");
  const { isConceptApplied } = await import("./enrich.js"); // lazy: enrich.ts loads the store stack
  const { assertStoreNotNewer } = await import("./bootstrap.js");
  const store = getStore(dbPath);
  assertStoreNotNewer(store, dbPath); // throws NewerStoreError: the CLI exits 3, the hook reports it
  const changed: ChangedSkill[] = [];
  for (const concept of Object.keys(config.concepts)) {
    let skill;
    try {
      skill = await readConceptSkill(config, concept);
    } catch {
      continue; // declared skill path that does not exist: `extract` reports it, not a stop hook
    }
    if (!skill) continue;
    // Only a concept already applied (`isConceptApplied`, the one definition shared with drift, apply
    // and the enrich roll-up): a first ingest is `add-concept`'s job. A skill added after the first
    // apply has no doc row yet, so it counts as changed.
    if (!isConceptApplied(store, concept)) continue;
    const doc = getRecord<{ body_hash?: string }>(store, "docs", docKey(concept));
    if (!doc || doc.body_hash !== skill.contentHash) changed.push({ concept, skillPath: skill.path });
  }
  return changed;
}

function lockAge(path: string): number {
  return Date.now() - statSync(path).mtimeMs;
}

/**
 * Takes the per-store lock. Returns an ownership token (also the lock file's content) or null when
 * a live run holds it. A stale lock (older than the hook timeout) is taken over by renaming it to a
 * name unique to this run: rename is atomic, so of several racing takers exactly one moves it, the rest
 * get ENOENT. If the file moved turns out to be fresh (another run replaced the stale lock between our
 * stat and our rename) it is hard-linked back and we report the lock as held.
 */
export function takeLock(lockPath: string): string | null {
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const create = (): boolean => {
    try {
      writeFileSync(lockPath, token, { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  };
  if (create()) return token;
  try {
    if (lockAge(lockPath) < HOOK_TIMEOUT_SECONDS * 1000) return null;
    const moved = `${lockPath}.stale.${token}`;
    renameSync(lockPath, moved); // atomic: only one racing taker succeeds
    const wasStale = lockAge(moved) >= HOOK_TIMEOUT_SECONDS * 1000;
    if (!wasStale) {
      try {
        linkSync(moved, lockPath); // put the live lock back (EEXIST if someone already took the slot)
      } catch {
        // another run created a lock in the meantime: that one is live, ours is gone
      }
    }
    rmSync(moved, { force: true });
    return wasStale && create() ? token : null;
  } catch {
    return null;
  }
}

/**
 * Removes the lock only when `token` owns it. The file is first renamed to a name unique to this run
 * (so the check and the delete act on one file), read, and deleted only if it is ours; otherwise it
 * is linked back untouched.
 */
export function releaseLock(lockPath: string, token: string): void {
  const mine = `${lockPath}.release.${token}`;
  try {
    renameSync(lockPath, mine);
  } catch {
    return; // already gone
  }
  try {
    if (readFileSync(mine, "utf-8") !== token) {
      try {
        linkSync(mine, lockPath);
      } catch {
        // a newer lock already holds the slot
      }
    }
  } finally {
    rmSync(mine, { force: true });
  }
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines[lines.length - 1]?.trim() ?? "";
}

/** Runs this CLI with `args` in `cwd`; the same script and Node flags (tsx under tests) as the parent. */
function runCli(cliScript: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [...process.execArgv, cliScript, ...args], {
    cwd,
    encoding: "utf-8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Detect changed SKILL.md files under the config found from `cwd` and refresh each concept.
 * Never throws for an expected condition: a missing config, store or tsconfig is `skipped`.
 */
export async function refreshSkills(cwd: string, cliScript: string = process.argv[1] ?? ""): Promise<RefreshReport> {
  const started = Date.now();
  const done = (r: Omit<RefreshReport, "ms">): RefreshReport => ({ ...r, ms: Date.now() - started });

  const config = tryLoadConfig(cwd);
  const reason = refreshSkipReason(config);
  if (reason || !config) return done({ skipped: reason ?? "no scribe.config.json", changed: [], results: [] });

  const { resolveDbPath, closeStores } = await import("./db.js");
  const dbPath = resolveDbPath(config);
  if (!existsSync(dbPath)) return done({ skipped: "no graph store", changed: [], results: [] });

  let changed: ChangedSkill[];
  try {
    changed = await changedSkillConcepts(config, dbPath);
  } finally {
    closeStores(); // the children write the same store
  }
  if (changed.length === 0) return done({ changed: [], results: [] });

  const lockPath = join(dirname(dbPath), LOCK_FILE);
  const lockToken = takeLock(lockPath);
  if (!lockToken) {
    return done({
      skipped: "another refresh-skills run holds the lock",
      changed: changed.map((c) => c.concept),
      results: [],
    });
  }

  const results: RefreshOutcome[] = [];
  try {
    for (const { concept } of changed) {
      const ex = runCli(cliScript, ["extract", concept], config.configRoot);
      if (ex.status !== 0) {
        results.push({ concept, status: "failed", step: "extract", detail: lastLine(ex.stderr || ex.stdout) });
        continue;
      }
      const ap = runCli(cliScript, ["apply", concept, "--defer-renames"], config.configRoot);
      if (ap.status === 0) results.push({ concept, status: "refreshed" });
      else if (ap.status === EXIT_RENAMES_DEFERRED) {
        const count = /Deferred: (\d+) rename/.exec(ap.stdout)?.[1];
        results.push({
          concept,
          status: "deferred",
          detail: count ? `${count} rename candidate(s)` : "rename candidates",
        });
      } else {
        results.push({ concept, status: "failed", step: "apply", detail: lastLine(ap.stderr || ap.stdout) });
      }
    }
  } finally {
    releaseLock(lockPath, lockToken);
  }
  return done({ changed: changed.map((c) => c.concept), results });
}

/**
 * The message the hook shows the session (Claude Code `systemMessage`), or null for a silent stop:
 * nothing changed, or the run was skipped.
 */
export function hookMessage(report: RefreshReport): string | null {
  const lines: string[] = [];
  const refreshed = report.results.filter((r) => r.status === "refreshed");
  if (refreshed.length > 0) {
    lines.push(`code-graph: SKILL.md changed, graph refreshed for ${refreshed.map((r) => r.concept).join(", ")}.`);
  }
  for (const r of report.results) {
    if (r.status === "deferred") {
      lines.push(
        `code-graph: ${r.concept} NOT applied, ${r.detail} need a decision. ` +
          `Run \`code-graph apply ${r.concept}\` in a terminal and answer the rename prompts ` +
          `(do not use --approve-drift).`
      );
    } else if (r.status === "failed") {
      lines.push(
        `code-graph: refresh of ${r.concept} failed at ${r.step}: ${r.detail.replace(/\.+$/, "") || "no output"}. ` +
          `Run \`code-graph extract ${r.concept} && code-graph apply ${r.concept}\` to see the full error.`
      );
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/** The hook's working directory: Claude Code's stdin payload `cwd`, else the project dir, else ours. */
export function hookCwd(stdin: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    const cwd = (JSON.parse(stdin) as { cwd?: unknown }).cwd;
    if (typeof cwd === "string" && cwd) return cwd;
  } catch {
    // not JSON (or empty): fall through
  }
  return env.CLAUDE_PROJECT_DIR || process.cwd();
}

/** Reads all of stdin when it is piped (Claude Code closes it after the payload); "" for a TTY. */
export function readHookStdin(): string {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}
