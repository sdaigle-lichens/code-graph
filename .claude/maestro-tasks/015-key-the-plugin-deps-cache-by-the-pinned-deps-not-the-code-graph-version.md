# Key the plugin deps cache by the pinned deps, not the code-graph version

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today every plugin release makes `deps install` run again from a terminal. `cacheDepsDir()` (packages/code-graph/src/project-deps.ts:52-55) returns `<XDG_CACHE_HOME|~/.cache>/code-graph/deps/<packageVersion()>`, so each code-graph version looks in a new, empty folder, even though the only thing installed there is `PINNED_DEPS = { "ts-morph": "28.0.0" }` (L33), which is unchanged across releases. The user hit this after updating to 0.3.7: `deps status` showed ts-morph missing in `~/.cache/code-graph/deps/0.3.7`. Inside Claude Code, `$CLAUDE_PLUGIN_DATA/deps` is searched first and isn't tied to a version, so this mostly hurts terminal runs and any session without that variable.

Name the cache folder after the pinned deps, e.g. `~/.cache/code-graph/deps/ts-morph@28.0.0`, derived from `PINNED_DEPS` (sorted `name@version` pairs joined deterministically, so adding a dep later still gives a stable name). One install then survives every plugin update, and a new download happens only when a pin changes. Apply the same key under `$CLAUDE_PLUGIN_DATA/deps/<key>`, so a pin bump never loads an older ts-morph left in the plugin data folder. `deps install` (deps.ts:22) writes to `pluginDepsDirs()[0]` as it does now, and `deps status` prints the new paths.

Keep the 008 rules: no silent or automatic download, `deps install` stays explicit, the missing-dependency error still names it, the lookup order is the plugin folders then the project, and layer 1 never reaches this code. Don't search the old `deps/<version>` folders. Users run `deps install` once more after this ships; say so in the docs, and say that old `deps/0.3.*` folders can be deleted. The path must work on macOS (`os.homedir()/.cache`, `@` is a valid character on APFS) and Linux; don't add a macOS-specific `~/Library/Caches` path.

Update the path wording in project-deps.ts's header comment, packages/code-graph/CLAUDE.md L28, docs/usage.md L93 and docs/installation.md L31. Bump all three version files to 0.3.8 and regenerate the bundle.

## Acceptance criteria

- [ ] The cache deps folder name is derived from PINNED_DEPS (e.g. `ts-morph@28.0.0`), not from the code-graph version, under both the XDG/~/.cache root and $CLAUDE_PLUGIN_DATA/deps
- [ ] A test shows the folder stays the same when the code-graph version changes and changes when a pin changes
- [ ] deps install writes to the new folder, deps status lists it, and a graph command resolves ts-morph from it; old deps/<version> folders aren't searched
- [ ] No automatic download is added; the MissingProjectDependencyError message still names `deps install`; layer 1 still never loads this path
- [ ] The docs (usage.md, installation.md, packages/code-graph/CLAUDE.md, the project-deps.ts header) describe the new path, the one-time reinstall after upgrading and that old folders can be deleted
- [ ] pnpm check, pnpm test and just eval (7/7) are green; the version is 0.3.8 in all three files and the bundle is regenerated

## Blocked by

None — can start immediately
