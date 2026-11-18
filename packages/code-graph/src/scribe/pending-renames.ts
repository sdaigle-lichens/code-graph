// Ambiguous rename candidates that `apply --approve-unambiguous-renames` left unapplied, kept until a
// person settles them. The old vertex's `.enriched.json` entry stays in the file as an orphan (nothing
// is deleted); this record is what lets every later update run list it in its report
// (`update-skills-report.md`) until it is settled with `enrich prune <concept>` or a re-enrich of the
// new vertex.
//
// fs only (no store, no zod): the update runner and `refresh-skills --finish-update` read it on the hook
// path, which must not load node:sqlite.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Next to graph.db, with the lock and the update state. */
export const PENDING_RENAMES_FILE = "ambiguous-renames.json";

export type PendingRename = {
  concept: string;
  oldKey: string;
  oldName: string;
  newKey: string;
  newName: string;
  filepath: string;
  score: number;
  recordedAt: string;
  /** The old key had an `.enriched.json` entry when recorded (that entry is now an orphan). */
  oldEnriched: boolean;
  /** The new key already had its own entry when recorded (then only a prune settles it). */
  newEnriched: boolean;
  /** Listed in at least one report. */
  reported?: boolean;
};

function filePath(stateDir: string): string {
  return join(stateDir, PENDING_RENAMES_FILE);
}

export function readPendingRenames(stateDir: string): PendingRename[] {
  try {
    const raw = JSON.parse(readFileSync(filePath(stateDir), "utf-8")) as { renames?: unknown };
    return Array.isArray(raw.renames) ? (raw.renames as PendingRename[]) : [];
  } catch {
    return [];
  }
}

function writePendingRenames(stateDir: string, renames: PendingRename[]): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(filePath(stateDir), JSON.stringify({ renames }, null, 2) + "\n");
}

const sameRename = (a: PendingRename, b: Pick<PendingRename, "concept" | "oldKey" | "newKey">) =>
  a.concept === b.concept && a.oldKey === b.oldKey && a.newKey === b.newKey;

/** Adds this apply's ambiguous candidates for `concept` (a pair already recorded keeps its record). */
export function recordPendingRenames(stateDir: string, renames: PendingRename[]): void {
  if (renames.length === 0) return;
  const kept = readPendingRenames(stateDir);
  for (const r of renames) if (!kept.some((k) => sameRename(k, r))) kept.push(r);
  writePendingRenames(stateDir, kept);
}

/** `_key`s in `<configRoot>/scribe-output/<concept>.enriched.json` (empty when the file is absent). */
function enrichedKeys(configRoot: string, concept: string): Set<string> {
  const p = join(configRoot, "scribe-output", `${concept}.enriched.json`);
  if (!existsSync(p)) return new Set();
  try {
    const doc = JSON.parse(readFileSync(p, "utf-8")) as { vertices?: { _key?: unknown }[] };
    return new Set((doc.vertices ?? []).map((v) => String(v._key)));
  } catch {
    return new Set();
  }
}

/**
 * Settled = the orphaned entry is gone (pruned, or remapped by a later apply), or the new vertex got an
 * entry it did not have when recorded (re-enriched). A record whose old key had no entry is settled
 * from the start: nothing was orphaned, it is listed once.
 */
export function isSettled(r: PendingRename, keys: Set<string>): boolean {
  return !keys.has(r.oldKey) || (!r.newEnriched && keys.has(r.newKey));
}

/**
 * The report section for every unsettled record (plus, once, each settled record never reported),
 * as markdown lines; [] when there is none. Drops settled records that were already reported and marks
 * the listed ones reported.
 */
export function pendingRenamesSection(stateDir: string, configRoot: string): string[] {
  const all = readPendingRenames(stateDir);
  if (all.length === 0) return [];
  const keysByConcept = new Map<string, Set<string>>();
  const keysOf = (c: string) => {
    let k = keysByConcept.get(c);
    if (!k) keysByConcept.set(c, (k = enrichedKeys(configRoot, c)));
    return k;
  };
  const listed: string[] = [];
  const kept: PendingRename[] = [];
  for (const r of all) {
    const settled = isSettled(r, keysOf(r.concept));
    if (settled && r.reported) continue;
    const where = `${r.filepath}, score ${r.score.toFixed(2)}`;
    const what = settled
      ? r.oldEnriched
        ? "already settled"
        : "not applied; no enrichment entry was orphaned"
      : `enriched entry \`${r.oldKey}\` kept as an orphan in \`scribe-output/${r.concept}.enriched.json\`; ` +
        `settle with \`code-graph enrich prune ${r.concept}\` (dry run, then \`--yes\`) or re-enrich ${r.newName}`;
    listed.push(`- ${r.concept}: ${r.oldName} → ${r.newName} (${where}): ${what}`);
    if (!settled) kept.push({ ...r, reported: true });
  }
  writePendingRenames(stateDir, kept);
  if (listed.length === 0) return [];
  return ["## Ambiguous renames left for a person", "", ...listed];
}
