set shell := ["bash", "-cu"]

# Default: list recipes
default:
    @just --list

# ─── Dev ─────────────────────────────────────────────────────────────────────

# Install deps
install:
    pnpm install

# Build TypeScript → dist/
build:
    pnpm build

# Type-check without emit
typecheck:
    pnpm exec tsc --noEmit

# Wipe build output
clean:
    rm -rf dist

# Full cycle: clean, install, build, link
fresh: clean install build link

# ---- Global Setup -----------------------------------------------------------

# Link binary globally for local dev
link:
    pnpm link --global

# Unlink global binary
unlink:
    pnpm unlink --global

# ─── ArangoDB ────────────────────────────────────────────────────────────────

# Start ArangoDB container
up:
    code-graph up

# Stop ArangoDB container
down:
    code-graph down

# Show DB / collection / view status
status:
    code-graph status

# Open ArangoDB web UI in browser
view-db:
    code-graph view-db

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

# Run Layer-A eval harness from pilot dir
eval:
    cd {{pilot_dir}} && code-graph eval

# ─── Editor integration ──────────────────────────────────────────────────────

# Build the LSP server (TypeScript → lsp/dist)
lsp-build:
    cd lsp && pnpm install && pnpm build

# Install the LSP binary on PATH (symlinks via pnpm)
lsp-link: lsp-build
    cd lsp && pnpm link --global

# Build the Zed extension (Rust → wasm)
zed-build:
    cd editor/zed-code-graph && cargo build --target wasm32-wasip1 --release
