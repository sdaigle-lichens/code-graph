# Report r013: 015-key-the-plugin-deps-cache-by-the-pinned-deps-not-the-code-graph-version.md

- Task: 015-key-the-plugin-deps-cache-by-the-pinned-deps-not-the-code-graph-version.md
- Written: 2026-10-17T00:17:54.506Z
- From session: code-graph-a7

Outcome: task 015 done, clean session, nothing committed (changes are in the working tree).
- depsKey() in packages/code-graph/src/project-deps.ts names the cache folder from PINNED_DEPS (ts-morph@28.0.0), under the XDG/~/.cache code-graph deps dir and under $CLAUDE_PLUGIN_DATA deps. Old deps/<version> folders are not searched.
- No auto-download added; the missing-dependency error still names deps install.
- New project-deps.test.ts; two cli.test.ts resolution-order tests moved to the new key, plus a test that an old deps/0.3.7 folder is ignored.
- Docs (usage.md, installation.md, packages/code-graph/CLAUDE.md, project-deps.ts header) describe the new path, the one-time reinstall and that deps/0.3.* can be deleted.
- Version 0.3.8 in all three files, bundle regenerated.
- Test agent ran a real deps status/install/extract flow with a temp cache; reviewer and scribe found no issues. pnpm check, pnpm test (289) and just eval 7/7 green as reported by agents. Not run on macOS.
Suggested ticket changes: none.
