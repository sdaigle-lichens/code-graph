# Tell an unreadable ts-morph deps dir apart from a missing one in the macOS sandbox

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Feedback from a session running `/code-graph:update-concept-skills` in the maestro repo (2026-10-29): `code-graph extract` said ts-morph could not be found and to run `code-graph deps install`. They ran it and extract failed again with the same message, because the Claude Code sandbox could not read `~/.cache/code-graph`, where `deps install` had put `ts-morph@28.0.0`. `deps status` also said "missing".

The code already classifies a deps dir as present, absent, unreadable or not-visible (`probeDepsDir`, `blockedState`) and names `sandbox.filesystem.allowRead` for the blocked states, so start by reproducing: under the macOS Seatbelt sandbox with a denied `~/.cache/code-graph`, see what stat returns and which message `extract` and `deps status` print, with the current build and the plugin version that session used. Then fix the classification or message so both commands say the dir exists but cannot be read from this session, and name the absolute path to add to `sandbox.filesystem.allowRead`, instead of only "missing, run deps install". This is a code change in the deps lookup and the error messages in source code, with tests, plus a short up-front check in the `code-graph-install` and `code-graph-update` plugin skills that tells the user which path to allow before extract is attempted. Regenerate the committed plugin bundle (`pnpm bundle`) since source changes.

Out of scope: where `deps install` writes, and downloading inside graph commands.

## Acceptance criteria

- [ ] The macOS sandbox behaviour with a denied deps dir is reproduced and written in the report (what stat returns, what was printed before the fix)
- [ ] With the deps dir present but unreadable, `extract` and `deps status` say so and name the absolute path to allow in `sandbox.filesystem.allowRead`; they never say only "missing, run deps install"
- [ ] With the deps dir truly absent, the messages still say to run `code-graph deps install`
- [ ] The install and update plugin skills check deps readability before the first extract and tell the user which path to allow
- [ ] Tests cover the unreadable case; plugin bundle regenerated; `just eval` 7/7 and `pnpm check` green (or its parts, in the sandbox)

## Blocked by

None — can start immediately
