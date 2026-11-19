/**
 * `code-graph git <diff|log|show> [args...]`: the history reads of the unattended update run, without
 * their one write. `git diff`, `git log` and `git show` take `--output=<file>`, which writes any file, so
 * a `Bash(git diff:*)` allow rule would let a headless session write outside its staging directory. The
 * run allows only this command (through the bundled CLI's own `Bash(node <cli>:*)` rule): it refuses
 * `--output` in the arguments the shell already unquoted, then runs git with no shell. Git does not
 * accept an abbreviated `--output` (`--outp=` exits 129), so the exact flag is the one to refuse.
 */
import { spawnSync } from "node:child_process";

/** The git subcommands the command runs. */
export const READ_ONLY_GIT_SUBCOMMANDS = ["diff", "log", "show"] as const;

/** Why `git <subcommand> <args>` is refused, or null when it may run. */
export function refusedGitCall(subcommand: string, args: string[]): string | null {
  if (!(READ_ONLY_GIT_SUBCOMMANDS as readonly string[]).includes(subcommand)) {
    return `git ${subcommand} is not one of ${READ_ONLY_GIT_SUBCOMMANDS.join(", ")}`;
  }
  const out = args.find((a) => a === "--output" || a.startsWith("--output="));
  if (out) return `${out} writes a file; this command only reads history (print to stdout instead)`;
  return null;
}

/**
 * The environment git runs under: every variable that can make a read-only git command run another program
 * (GIT_EXTERNAL_DIFF, GIT_PAGER, a configured `core.pager`/`diff.external` injected through GIT_CONFIG_*) is
 * removed. Locations (GIT_DIR, GIT_WORK_TREE) are left alone.
 */
export function gitSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (
      k === "GIT_EXTERNAL_DIFF" ||
      k === "GIT_PAGER" ||
      k === "GIT_CONFIG_COUNT" ||
      k === "GIT_CONFIG_PARAMETERS" ||
      k === "GIT_CONFIG_GLOBAL" ||
      k === "GIT_CONFIG_SYSTEM" ||
      k === "GIT_CONFIG" ||
      k === "GIT_ASKPASS" ||
      k === "GIT_SSH" ||
      k === "GIT_SSH_COMMAND" ||
      k === "GIT_PROXY_COMMAND" ||
      k === "GIT_EDITOR" ||
      /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Runs `git <subcommand> <args>` in `cwd` with inherited stdio; returns the exit code (1 when refused). */
export function runReadOnlyGit(subcommand: string, args: string[], cwd: string): number {
  const refused = refusedGitCall(subcommand, args);
  if (refused) {
    process.stderr.write(`error: ${refused}\n`);
    return 1;
  }
  const r = spawnSync("git", [subcommand, ...args], {
    cwd,
    stdio: "inherit",
    env: gitSafeEnv(process.env),
  });
  if (r.error) {
    process.stderr.write(`error: ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
}
