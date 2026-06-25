---
name: add-concept
description: Add one new concept to an existing scribe.config.json via seed-driven import-graph expansion. Proposes globs, gets approval, writes the config key, and auto-runs the structural build (extract + apply). Invoked by /add-concept.
allowed-tools: Bash, Read, Write
---

## Purpose

Declare a single new concept in an existing `scribe.config.json` — the "catalog-of-one"
complement to `/code-graph-init`. The value over hand-editing the config is the *judgment*:
proposing the right glob pattern from a seed. After approval the structural build runs
automatically (zero tokens, deterministic).

Also the remediation for a whiff whose answer lives in uncovered files: phase-9 gap-(c)
routes into this skill with the uncovered files as the seed.

## Preconditions

1. `scribe.config.json` must exist. If it does not, use `/code-graph-init` first.
2. A seed must be provided: a file path, directory, or symbol name that is the *center* of the
   domain. If no seed is given, run `code-graph catalog --json` repo-wide and use name-match
   to locate likely roots (more expensive; prefer a seed when one is available).

## Step 1 — resolve the seed

The seed is the domain root — the high-cohesion center of the cluster, distinct from a
shared-infrastructure hub. Examples:
- `src/store/workorder.store.ts` → root for workorder-store domain
- `src/features/billing/` → root for billing domain
- `BillingService` (symbol name) → grep to find the file, then use it as the root

If the seed is a symbol, run:
```bash
grep -r "export.*BillingService\|export function BillingService\|export class BillingService" src/
```
to locate the file.

## Step 2 — scoped catalog

Run the catalog scoped to the seed's neighborhood rather than repo-wide:

```bash
code-graph catalog --json
```

(Catalog is always repo-wide but fast — ~seconds. Use the output to look up the seed file's
`imports[]` entries for expansion. Store the result; do not re-run.)

Identify the seed in `files[]`. Check if the seed is in `hubs[]` — if so, warn the user that
hub files are shared infrastructure, not domain roots, and ask them to pick a more specific
seed.

## Step 3 — bidirectional expansion (asymmetric, cohesion-gated)

From the seed file, walk the import graph in both directions:

**Dependents (fan-in) — who imports the seed:**
- These are the consumers: hooks, components, or actions that use the store/service.
- Include: tight wrappers, files whose name root matches the seed's domain.
- **Stop** at a file that:
  - Is mostly about a different domain (naming diverges from the seed's domain root)
  - Is already declared in another concept (surface as overlap, don't absorb)
  - Is a generic consumer (no domain cohesion — imports the seed plus 10 unrelated things)

**Dependencies (fan-out) — what the seed imports:**
- Include: domain types, domain utilities with the same name root.
- **Stop** at:
  - Hub files (in `hubs[]`) — shared infrastructure, not part of the concept
  - Files already in another concept (surface as overlap, don't absorb)
  - Files with no naming/directory cohesion to the seed

**Depth limit**: default 1–2 hops; extend only if cohesion stays high (files keep the same
name root or directory prefix as the seed).

**Borderline files** (imports the seed but half is about another domain): list them as
"borderline — add?" suggestions in the review. Do not auto-include.

**Read budget**: ≤ 30 file reads total to resolve ambiguous boundaries. Beyond that, finalize
with what's known.

## Step 4 — propose globs and name

**Name**: derive from the seed filename. Examples:
- `workorder.store.ts` → `workorder-store`
- `billing-service.ts` → `billing-service`
- `src/features/gantt/` → `gantt`

**Namespace** (unit prefix): derive from the seed's unit (from catalog `files[].unit`).
- Seed in `apps/web/...` → `web/<name>`
- Seed in `packages/ui-kit/...` → `ui-kit/<name>`
- Seed in a single-package root → no prefix (just `<name>`)

**Glob strategy** — broadest glob that captures only the intended files:
- If the domain **wholly owns a directory**: `src/features/gantt/**` (compact, survives new files)
- If the domain is **scattered or shares a dir**: narrower patterns or explicit paths
- Test each candidate glob against the catalog `files[]` list (minimatch in your head or via
  a quick grep) and confirm the captured set

## Step 5 — review presentation

Present one summary for user approval:

```
Concept: web/workorder-store

  Rationale: Workorder store + supporting hooks/components — all code that reads or writes
             the workorder data model.

  Root:     src/store/workorder.store.ts
  Globs:
    src/store/workorder.store.ts
    src/hooks/use-workorder*.ts
    src/routes/*/workorder-card.tsx

  Captures: 7 files
  Samples:  src/store/workorder.store.ts, src/hooks/use-workorder-list.ts, …

  Cohesion: ✓ tight cluster (7 files, 12 import edges within the set)

  Overlaps: src/lib/dates.ts is also in web/scheduling (informational, not a conflict)

  Borderline (not included, add?):
    src/routes/index.tsx — imports workorder.store but is mostly a routing entry point

  [accept / edit globs / rename / reject]
```

Wait for explicit acceptance before writing.

## Step 6 — write config key (on acceptance)

Load `scribe.config.json`, add the new concept:

```json
{
  "concepts": {
    "<namespace/name>": {
      "globs": ["<glob1>", "..."]
    }
  }
}
```

No `skill` field — SKILL.md is authored at enrich time, not now. Preserve all other fields
exactly as-is.

## Step 7 — auto-run structural build

Immediately after writing the config, run the zero-token structural build:

```bash
code-graph extract <concept>
code-graph apply <concept>
```

Do not run `/scribe-enrich` — no SKILL.md exists yet, and enrichment is incremental by design.

Report to the user:
```
Added and built `web/workorder-store` structurally (N vertices, M edges).

Enrich it when you're working in it:
  1. Write its SKILL.md at .claude/skills/workorder-store/SKILL.md
  2. Run /scribe-enrich web/workorder-store
```

## Hard rules

- **One concept per invocation** — if the user wants to add two concepts, run twice.
- **Require scribe.config.json** — stop with a helpful message if it's missing.
- **Hub exclusion** — if the seed is a hub, warn and ask for a better seed.
- **Never auto-run /scribe-enrich** — no SKILL.md = enrichment fails; always defer.
- **No SKILL.md scaffolding** — an empty stub pollutes the graph; omit the `skill` field.
- **Overlap is surfaced, never resolved** — overlap is allowed by design.
- **Per-concept approval is mandatory** — never write without explicit user acceptance.
