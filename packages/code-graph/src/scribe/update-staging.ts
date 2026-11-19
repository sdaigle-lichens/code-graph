// The hook-started update run cannot write concept skills itself: inside a headless `claude -p` the
// sandbox (and Claude Code's own protection of `.claude/`) refuses writes under the project's
// `.claude/skills`, whatever the permission mode. So the session writes each revised or created
// SKILL.md to a staging directory next to graph.db and lists every in-scope concept in a manifest;
// after `claude` exits, the detached runner (a plain node process, outside that sandbox) installs the
// staged files, stamps them, re-applies their docs and advances the repo-level record only when every
// concept succeeded. Anything less is reported as an incomplete run and the record is left alone, so
// a stale concept stays visibly stale.
//
// No store, ts-morph or typescript here: the store work runs through the bundled CLI as a child process.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScribeConfig } from "../config.js";
import { isWriteBlocked, resolveConceptSkillPath } from "../skills/concept-skills.js";

/** Next to graph.db; reset before each hook-started run. */
export const STAGING_DIR = "update-staging";
export const STAGING_MANIFEST = "manifest.json";

export type StagedAction = "revised" | "created" | "stamp-only" | "untouched" | "failed";
export type StagedConcept = { id: string; action: StagedAction; reason?: string };

const ACTIONS: ReadonlySet<string> = new Set(["revised", "created", "stamp-only", "untouched", "failed"]);

export function stagingDirFor(stateDir: string): string {
  return join(stateDir, STAGING_DIR);
}

/** Empties the staging directory so files from an earlier run are never installed. */
export function resetStaging(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** The manifest's entries; null when it is missing or not `{ concepts: [{ id, action }] }`. */
export function readStagingManifest(dir: string): StagedConcept[] | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, STAGING_MANIFEST), "utf-8")) as { concepts?: unknown };
    if (!Array.isArray(raw.concepts)) return null;
    const out: StagedConcept[] = [];
    for (const e of raw.concepts as { id?: unknown; action?: unknown; reason?: unknown }[]) {
      if (typeof e?.id !== "string" || typeof e.action !== "string" || !ACTIONS.has(e.action)) return null;
      out.push({
        id: e.id,
        action: e.action as StagedAction,
        ...(typeof e.reason === "string" ? { reason: e.reason } : {}),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Runs the bundled CLI with `args` (after `--root <root>`). */
export type CliRun = (args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export function nodeCli(cliScript: string, root: string): CliRun {
  return (args) =>
    new Promise((done) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(process.execPath, [cliScript, "--root", root, ...args], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err) => done({ code: null, stdout, stderr: stderr + err.message }));
      child.on("close", (code) => done({ code, stdout, stderr }));
    });
}

/** A write the runner was refused (EPERM, EROFS or EACCES) and the path it was refused on. */
export type RefusedWrite = { code: string; path: string };

export type InstallResult = {
  /** Every in-scope concept succeeded and the repo-level record was advanced. */
  complete: boolean;
  /** The report section (markdown lines). */
  lines: string[];
  /** Writes refused by the filesystem: the runner was sandboxed (or the tree is read-only). */
  refused?: RefusedWrite[];
};

/** The report line for a refused write. */
export const SANDBOXED_RUNNER =
  "sandboxed: the hook runner was sandboxed (a write was refused with EPERM, EROFS or EACCES), so the run is incomplete; " +
  "run the update from a terminal or a session whose writes are allowed";

const lastLine = (s: string) => s.trim().split("\n").slice(-1)[0] ?? "";

/** Node's errno message shape: `EACCES: permission denied, open '/path'` (code, then the path in quotes). */
const REFUSED_RE = /\b(EPERM|EROFS|EACCES)\b[^'\n]*'([^'\n]+)'/;

/** The first refused write named in a CLI's output, or null. */
export function refusedWriteIn(text: string): RefusedWrite | null {
  const m = REFUSED_RE.exec(text);
  return m ? { code: m[1] as string, path: m[2] as string } : null;
}

/**
 * Installs what the session staged. `inScope` are the concepts the run was started for; each must be in
 * the manifest. Installs `revised`/`created` files, stamps them (`--bump minor` / `--bump initial`) and
 * the `stamp-only` ones (`--reviewed`), runs extract + apply on the installed ones when a store exists
 * (when either fails, each installed SKILL.md is restored as it was, stamp included), then advances the repo-level record (`skills stamp --bump minor`) only when nothing failed. The
 * staging directory is removed on success and kept otherwise.
 */
export async function installStaged(o: {
  config: ScribeConfig;
  stagingDir: string;
  dbPath: string;
  inScope: string[];
  cli: CliRun;
  /** scribe.config.json as the run found it and the concepts it declared; a concept the run created is rolled back when the run fails. */
  configBefore?: { text: string; concepts: string[] };
}): Promise<InstallResult> {
  const root = o.config.configRoot;
  const problems: string[] = [];
  const notes: string[] = [];
  const refused: RefusedWrite[] = [];
  const manifest = readStagingManifest(o.stagingDir);
  if (!manifest) problems.push(`no valid ${STAGING_MANIFEST} in the staging directory: nothing was installed`);
  const entries = manifest ?? [];
  const listed = new Set(entries.map((e) => e.id));
  for (const c of o.inScope) if (manifest && !listed.has(c)) problems.push(`${c}: missing from the manifest`);

  const revised: string[] = [];
  const created: string[] = [];
  const stampOnly: string[] = [];
  // The bytes each installed SKILL.md had before the install (null: it did not exist), restored when the
  // graph refresh fails, so no concept whose extract or apply failed keeps a fresh stamp.
  const before = new Map<string, { rel: string; bytes: Buffer | null }>();
  for (const e of entries) {
    const why = e.reason ? `: ${e.reason}` : "";
    if (e.action === "failed") {
      problems.push(`${e.id}: the session could not revise it${why}`);
      continue;
    }
    if (e.action === "untouched") {
      notes.push(`${e.id}: untouched${why}`);
      continue;
    }
    if (e.action === "stamp-only") {
      stampOnly.push(e.id);
      notes.push(`${e.id}: stamp-only${why}`);
      continue;
    }
    const staged = join(o.stagingDir, e.id, "SKILL.md");
    if (!existsSync(staged)) {
      problems.push(`${e.id}: ${e.action} in the manifest but no staged ${e.id}/SKILL.md`);
      continue;
    }
    const concept = o.config.concepts[e.id];
    if (!concept) {
      problems.push(`${e.id}: not a concept in scribe.config.json`);
      continue;
    }
    const rel = await resolveConceptSkillPath(root, e.id, concept.skill, o.config.skillsDir);
    if (!rel) {
      problems.push(`${e.id}: no SKILL.md path (declare concepts.${e.id}.skill)`);
      continue;
    }
    try {
      const dest = join(root, rel);
      const prior = existsSync(dest) ? readFileSync(dest) : null;
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(staged, dest);
      before.set(e.id, { rel, bytes: prior });
    } catch (err) {
      if (isWriteBlocked(err)) refused.push({ code: err.code ?? "EPERM", path: join(root, rel) });
      problems.push(`${e.id}: could not write ${rel}: ${(err as Error).message}`);
      continue;
    }
    (e.action === "created" ? created : revised).push(e.id);
    notes.push(`${e.id}: ${e.action}, installed ${rel}`);
  }

  const restored = new Set<string>();
  const restoreInstalled = (id: string) => {
    const prior = before.get(id);
    if (!prior || restored.has(id)) return;
    restored.add(id);
    const dest = join(root, prior.rel);
    try {
      if (prior.bytes) writeFileSync(dest, prior.bytes);
      else rmSync(dest, { force: true });
      notes.push(
        `${id}: ${prior.rel} restored, not stamped (the graph refresh failed; the revision is kept in staging)`
      );
    } catch (err) {
      if (isWriteBlocked(err)) refused.push({ code: err.code ?? "EPERM", path: dest });
      problems.push(`${id}: could not restore ${prior.rel} after the failed graph refresh: ${(err as Error).message}`);
    }
  };
  const step = async (label: string, args: string[]) => {
    const r = await o.cli(args);
    if (r.code === 0) return true;
    // A refused write (stamp exit 9, or an extract/apply/stamp errno) names its path in the output.
    // SQLite reports a refused graph.db write without an errno path.
    const hit =
      refusedWriteIn(r.stderr) ??
      refusedWriteIn(r.stdout) ??
      (/readonly database|SQLITE_READONLY/i.test(r.stderr + r.stdout)
        ? { code: "SQLITE_READONLY", path: o.dbPath }
        : null);
    if (hit) refused.push(hit);
    const detail = hit ? `${hit.code} on ${hit.path}` : lastLine(r.stderr) || lastLine(r.stdout);
    problems.push(`${label} exited ${r.code ?? "without starting"}: ${detail}`);
    return false;
  };
  if (revised.length > 0)
    await step(`skills stamp ${revised.join(" ")}`, ["skills", "stamp", ...revised, "--bump", "minor"]);
  if (created.length > 0)
    await step(`skills stamp ${created.join(" ")}`, ["skills", "stamp", ...created, "--bump", "initial"]);
  if (stampOnly.length > 0) {
    await step(`skills stamp ${stampOnly.join(" ")}`, [
      "skills",
      "stamp",
      ...stampOnly,
      "--bump",
      "minor",
      "--reviewed",
    ]);
  }
  const installed = [...revised, ...created];
  if (installed.length > 0 && existsSync(o.dbPath)) {
    const refreshed =
      (await step(`extract ${installed.join(" ")}`, ["extract", ...installed])) &&
      (await step(`apply ${installed.join(" ")}`, ["apply", ...installed, "--approve-unambiguous-renames"]));
    // The stamp goes in before extract so the store ingests the stamped SKILL.md. When the refresh fails,
    // each installed SKILL.md is put back as it was (the revision stays in the kept staging directory).
    if (!refreshed) for (const id of installed) restoreInstalled(id);
  }

  const complete =
    problems.length === 0 && (await step("skills stamp --bump minor", ["skills", "stamp", "--bump", "minor"]));
  if (complete) rmSync(o.stagingDir, { recursive: true, force: true });
  else if (o.configBefore) {
    // A failed run leaves the config as it found it: a concept it created is undeclared, its SKILL.md put back.
    const known = new Set(o.configBefore.concepts);
    const undeclare = created.filter((id) => !known.has(id));
    for (const id of undeclare) restoreInstalled(id);
    if (undeclare.length > 0) {
      const path = join(root, "scribe.config.json");
      try {
        const cur = JSON.parse(readFileSync(path, "utf-8")) as { concepts?: Record<string, unknown> };
        for (const id of undeclare) delete cur.concepts?.[id];
        const original = JSON.parse(o.configBefore.text) as unknown;
        // Byte-identical to the pre-run file when removing the concepts gives back the same JSON.
        const text =
          JSON.stringify(cur) === JSON.stringify(original) ? o.configBefore.text : `${JSON.stringify(cur, null, 2)}\n`;
        writeFileSync(path, text);
        notes.push(
          `${undeclare.join(", ")}: removed from scribe.config.json (the run failed; the revision is kept in staging)`
        );
      } catch (err) {
        if (isWriteBlocked(err)) refused.push({ code: err.code ?? "EPERM", path });
        problems.push(`could not roll back scribe.config.json: ${(err as Error).message}`);
      }
    }
  }
  const lines = [
    "## Installed by the runner",
    "",
    complete
      ? "- status: complete; the repo-level record was advanced"
      : "- status: **incomplete**; the repo-level record was not advanced, and the staging directory was kept",
    ...notes.map((n) => `- ${n}`),
    ...problems.map((p) => `- failed: ${p}`),
    ...refused.map((r) => `- refused: ${r.code} on ${r.path}`),
    ...(refused.length > 0 ? [`- ${SANDBOXED_RUNNER}`] : []),
  ];
  return { complete, lines, ...(refused.length > 0 ? { refused } : {}) };
}
