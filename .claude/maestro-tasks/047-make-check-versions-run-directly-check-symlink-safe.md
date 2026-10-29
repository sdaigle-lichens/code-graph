# Make check-versions' run-directly check symlink-safe

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`packages/code-graph/scripts/check-versions.mjs` decides whether it was run directly by comparing `path.resolve(process.argv[1])` with `fileURLToPath(import.meta.url)`. On macOS `/tmp` is a symlink to `/private/tmp`, so when the script runs from a temp directory the two paths differ and the script does nothing. That is why the drift case in the scribe ast-stability test fails (the one pre-existing failure in the package suite, 511/512, reported by ticket 046). Compare the real paths on both sides instead, and apply the same fix to any other script in the repo that copies this check (046's ensure-dist script was fixed in its own rework; confirm it). This is a code change to the script plus a test that covers a symlinked location. If the check also runs from the bundle step, regenerate the plugin bundle (`pnpm bundle`) when its output changes. This matters for the epic because later retrieval work needs a green suite to trust.

Out of scope: changing what check-versions validates, and the version bump rules.

## Acceptance criteria

- [ ] check-versions.mjs still runs when invoked through a symlinked path (e.g. under /tmp on macOS) and still does nothing when imported
- [ ] The scribe ast-stability drift case passes; the code-graph package test suite is fully green
- [ ] No other repo script keeps the symlink-unsafe run-directly comparison
- [ ] `pnpm check` green (or, in the sandbox, check-versions, check-plugin-clean, prettier and tsc --noEmit clean), and `just eval` 7/7

## Blocked by

None — can start immediately
