/**
 * CLI-side refusals for the unattended update run (task 079). The headless run is marked by
 * `CODE_GRAPH_UNATTENDED` (set by the runner, inherited by the `claude -p` session and its Bash calls).
 * Under the marker, `enrich prune --yes`, `delete-concept --yes` (without `--keep-enriched`, the run's own
 * removal) and a `--root` outside the run's project exit 1 with one stderr line and write nothing. No
 * imports beyond node:fs/node:path, so the CLI can run it before any command loads.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const UNATTENDED_MARKER = "CODE_GRAPH_UNATTENDED";
/** The project the run belongs to; the runner sets it so a `--root` elsewhere can be told apart. */
export const UNATTENDED_ROOT_ENV = "CODE_GRAPH_UNATTENDED_ROOT";

export function isUnattended(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[UNATTENDED_MARKER]);
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Why `command` must not run unattended, or null. `command` is `enrich prune`, `delete-concept` or `root`. */
export function unattendedRefusal(
  command: "enrich prune" | "delete-concept" | "root",
  o: { yes?: boolean; keepEnriched?: boolean; root?: string },
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): string | null {
  if (!isUnattended(env)) return null;
  if (command === "enrich prune" && o.yes) {
    return "enrich prune --yes is refused in an unattended run (a pruned enriched file is unrecoverable)";
  }
  if (command === "delete-concept" && o.yes && !o.keepEnriched) {
    return "delete-concept --yes is refused in an unattended run without --keep-enriched (the enriched file is unrecoverable)";
  }
  if (command === "root" && o.root) {
    const project = real(env[UNATTENDED_ROOT_ENV] || env.CLAUDE_PROJECT_DIR || cwd);
    const target = real(resolve(cwd, o.root));
    const rel = relative(project, target);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      return `--root ${o.root} is outside the unattended run's project ${project}`;
    }
  }
  return null;
}

/** Prints the refusal as one stderr line and exits 1. */
export function refuseUnattended(reason: string | null): void {
  if (!reason) return;
  process.stderr.write(`error: ${reason}\n`);
  process.exit(1);
}
