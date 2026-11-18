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

/** Runs `git <subcommand> <args>` in `cwd` with inherited stdio; returns the exit code (1 when refused). */
export function runReadOnlyGit(subcommand: string, args: string[], cwd: string): number {
  const refused = refusedGitCall(subcommand, args);
  if (refused) {
    process.stderr.write(`error: ${refused}\n`);
    return 1;
  }
  const r = spawnSync("git", [subcommand, ...args], { cwd, stdio: "inherit" });
  if (r.error) {
    process.stderr.write(`error: ${r.error.message}\n`);
    return 1;
  }
  return r.status ?? 1;
}
