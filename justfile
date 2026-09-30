set shell := ["bash", "-cu"]

# Default: list recipes
default:
    @just --list

# ─── Dev ─────────────────────────────────────────────────────────────────────

# Install deps
install:
    pnpm install

# Build every workspace package (turbo orders them by dependsOn)
build:
    pnpm build

# Type-check without emit, across the workspace
typecheck:
    pnpm typecheck

# Run unit tests (node:test via tsx for the CLI, vitest for the app)
test:
    pnpm test

# check + typecheck + test, the pre-push gate
verify:
    pnpm verify

# Prettier over the enforced set (scope lives in .prettierignore)
check:
    pnpm check

# Wipe build output
clean:
    rm -rf packages/*/dist apps/*/out .turbo

# Full cycle: clean, install, build, link
fresh: clean install build link

# ---- Global Setup -----------------------------------------------------------

# pnpm 10 removed `link --global`; `add -g` is the replacement, and it resolves a relative path
# against the GLOBAL dir, not the cwd — hence the absolute path. Needs pnpm's global bin dir
# (`pnpm bin -g`) on PATH, i.e. PNPM_HOME set up.

# Put the code-graph binary on PATH for local dev
link:
    pnpm add -g "$(pwd)/packages/code-graph"

# Unlink global binary
unlink:
    pnpm remove -g code-graph

# ─── Graph store ────────────────────────────────────────────────────────────

# Show store / schema / row-count status
status:
    code-graph status

# Rebuild the full-text search index
reindex:
    code-graph reindex

# ─── Pilot (lichens-ordonnancement-ui) ───────────────────────────────────────

pilot_dir := env_var_or_default("PILOT_DIR", "/Users/samueldaigle/Documents/gits/lichens-ordonnancement-ui")
concept   := env_var_or_default("CONCEPT", "workorder-store")

# Bootstrap DB + collections + view in pilot project
bootstrap:
    cd {{pilot_dir}} && code-graph bootstrap

# Extract AST for concept (default: workorder-store)
extract:
    cd {{pilot_dir}} && code-graph extract {{concept}}

# Apply enriched.json to DB (upserts vertices + edges)
apply:
    cd {{pilot_dir}} && code-graph apply {{concept}}

# Show drift between AST and DB
drift:
    cd {{pilot_dir}} && code-graph drift {{concept}}

# Re-extract + apply in one go
refresh: extract apply

# Query concept subgraph
concept:
    cd {{pilot_dir}} && code-graph query concept {{concept}}

# Run full search query (override with `just search QUERY="…"`)
QUERY := "sync sends stale ops"
search:
    cd {{pilot_dir}} && code-graph search "{{QUERY}}"

# Impact query — set SYM and DIR
SYM := "src/store/workorder.store.ts:setWorkorderIndex"
DIR := "in"
impact:
    cd {{pilot_dir}} && code-graph query impact "{{SYM}}" --direction={{DIR}}

# ─── Eval ────────────────────────────────────────────────────────────────────

# Run Layer-A eval harness against this repo's own graph (the refactor gate)
eval:
    node packages/code-graph/dist/cli.js eval --tasks eval/tasks.code-graph.json

# Re-extract + re-apply both of this repo's own concepts, then re-run the gate
regraph:
    node packages/code-graph/dist/cli.js extract code-graph-search
    node packages/code-graph/dist/cli.js apply code-graph-search
    node packages/code-graph/dist/cli.js extract scribe-pipeline
    node packages/code-graph/dist/cli.js apply scribe-pipeline
    just eval

# Run Layer-A eval harness from the pilot dir instead
eval-pilot:
    cd {{pilot_dir}} && code-graph eval

# ─── Desktop app ─────────────────────────────────────────────────────────────

# Run the Electron app in dev (electron-vite, HMR on the renderer)
app:
    pnpm --filter code-graph-desktop dev

# Build the app to apps/desktop/out, then run that build over file://
app-build:
    pnpm --filter code-graph-desktop build

app-start: app-build
    pnpm --filter code-graph-desktop start

# ─── Editor integration ──────────────────────────────────────────────────────

# Build the LSP server (TypeScript → packages/lsp/dist)
lsp-build:
    pnpm --filter code-graph-lsp build

# Install the LSP binary on PATH (symlinks via pnpm)
lsp-link: lsp-build
    cd packages/lsp && pnpm link --global

# Build the Zed extension (Rust → wasm)
zed-build:
    cd editor/zed-code-graph && cargo build --target wasm32-wasip1 --release
