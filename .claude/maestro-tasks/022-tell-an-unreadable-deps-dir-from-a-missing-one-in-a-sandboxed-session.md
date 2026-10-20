# Tell an unreadable deps dir from a missing one in a sandboxed session

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro hit this on 0.3.14. The user ran `code-graph deps install` in their own shell, and ts-morph landed in `~/.cache/code-graph/deps/ts-morph@28.0.0`. In the Claude session, Claude Code's Bash sandbox denies reads under the home directory except for an allowlist, and `~/.cache` isn't on it. So `extract` failed with "could not be found ... Run code-graph deps install", and `deps status` said `ts-morph: missing`. Both point the user at an install that already happened.

Verified in code:
- `resolveDependency` (project-deps.ts ~L84-95) skips a dir with `existsSync(join(dir, "node_modules"))`. `existsSync` is false for ENOENT and EACCES alike, so "unreadable" collapses into "missing".
- `depsStatus` (deps.ts) and `MissingProjectDependencyError` (project-deps.ts) both say only "run deps install".
- Sandboxed commands carry `SANDBOX_RUNTIME=1` in the environment (seen in this repo's sessions).
- Under bubblewrap, a denied home path may show up as ENOENT rather than EACCES (it can be absent from the mount), so errno alone is not enough. Use errno where it helps, and the sandbox flag otherwise.

**1. Errors (CLI).** When no deps dir resolves and the process is sandboxed (`SANDBOX_RUNTIME=1`), or a stat of a deps dir fails with EACCES/EPERM:
- `deps status` prints, per dir, whether the dir looks unreadable rather than absent.
- The missing-dependency error (`extract`, `catalog`, …) says:
  - the plugin deps dir may exist but can't be read from this sandboxed session;
  - check with `code-graph deps status` in your own shell;
  - if it's installed there, add the cache dir (`<XDG_CACHE_HOME|~/.cache>/code-graph`, printed as an absolute path) to `sandbox.filesystem.allowRead`, or run the graph command outside the sandbox.

Keep "run `code-graph deps install`" as the advice when the process isn't sandboxed and the dirs are truly absent (ENOENT). Same exit code as today.

**2. Install flow (skill).** `plugin/skills/code-graph-install/SKILL.md` step 7 (graph dependencies):
- If the sandbox is enabled (`sandbox.enabled` true in the project's or the user's settings) and `deps status` reports ts-morph missing or unreadable, offer to add the absolute cache dir to `sandbox.filesystem.allowRead`.
- Say it is a lasting settings change, and add it only on the user's yes.
- Default to the user settings (`~/.claude/settings.json`), since the cache is per user. Offer `.claude/settings.local.json` as the alternative.
- Edit the JSON with Edit, merging into an existing `allowRead` array, and skip it when already present.
- `deps install` itself downloads from the npm registry, which the sandbox usually blocks, so keep telling the user to run it in their own shell (`! code-graph deps install`, or the plugin's `node … code-graph.cjs deps install`).

**3. Plugin data dir: check only, decided by the user.** Keep `~/.cache` as the install target. `$CLAUDE_PLUGIN_DATA/deps/<key>` is searched first and `~/.claude/plugins` is usually readable in the sandbox, but `CLAUDE_PLUGIN_DATA` is unset in the user's shell, where `deps install` runs.
- Switch `deps install` to the plugin data dir only if the CLI can locate it from the user's shell through something Claude Code documents (an env var, a CLI command or a documented path), not by guessing its internal folder layout.
- If it can't, change nothing, and say in the report what you checked.

Version 0.3.15 in all three files, bundle regenerated. Update the "plugin bundle" notes in packages/code-graph/CLAUDE.md and docs/installation.md.

## Acceptance criteria

- [ ] With `SANDBOX_RUNTIME=1` and no readable deps dir, `deps status` and the missing-dependency error name the sandbox read path and `sandbox.filesystem.allowRead`, not just `deps install`; tests cover the sandboxed and non-sandboxed messages and an EACCES stat
- [ ] Without the sandbox flag and with the dirs absent, the message is unchanged in substance (`deps install`)
- [ ] code-graph-install step 7 offers, with consent, to add the absolute cache dir to `sandbox.filesystem.allowRead` (user settings by default), idempotently, and only when the sandbox is enabled
- [ ] The install target stays `~/.cache` unless the plugin data dir can be located from the user's shell through something Claude Code documents; the report says what was checked
- [ ] claude plugin validate, pnpm check, pnpm test and just eval (7/7) are green; the version is 0.3.15 in all three files and the bundle is regenerated
