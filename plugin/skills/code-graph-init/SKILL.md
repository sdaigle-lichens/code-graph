---
name: code-graph-init
description: One-time project initialization — scans the repo, proposes curated concept slices with per-concept approval, and writes scribe.config.json. Invoked by /code-graph-init; never invoke directly.
allowed-tools: Bash, Read, Write
---

## Purpose

Write `scribe.config.json` from scratch for a new project. Proposes a curated set of concept
slices (one per domain), gets per-concept approval, then writes the file. This runs **once** at
onboarding. For adding a concept later, use `/add-concept`.

## Preconditions — check first

1. Run `ls scribe.config.json 2>/dev/null` from the project root.
   - **File exists** → stop. Tell the user: "scribe.config.json already exists — init is
     one-time only. To add a concept use `/add-concept`; to remove one use
     `code-graph delete-concept <name>`." Do not proceed.
   - **File missing** → continue.

2. Find the project root (look for `tsconfig.json`, `package.json`, or `pnpm-workspace.yaml`
   walking up from CWD). Most invocations run from the project root already.

## Step 1 — run the catalog digest

```bash
code-graph catalog --json [--tsconfig <path>]
```

This runs a ts-morph pass and returns JSON with:
- `units` — workspace units (monorepo apps/packages, or root for single-package)
- `files[]` — per-file: `path`, `unit`, `exports`, `kind`, `leadingDoc`
- `imports[]` — file → file adjacency
- `fanIn`, `fanOut` — per-file import counts
- `hubs` — files with fan-in ≥ 5 (shared infrastructure, **exclude from concept proposals**)

If `code-graph catalog` fails, check that ArangoDB is NOT needed (it isn't — catalog is
DB-free). The most common error is a missing tsconfig; pass `--tsconfig` explicitly.

## Step 2 — infer domains (no file reads yet)

From the catalog digest, cluster files into domain candidates using **names + structure only**:

- **Directory cohesion**: files under `src/features/gantt/` → candidate `gantt`
- **Name cohesion**: files named `workorder*.ts`, `use-workorder*.ts` → candidate `workorder-store`
- **Export patterns**: files that export only `*Store*` functions → store concept
- **Kind signals**: `store` + `hook` + `component` files sharing a name root → likely one domain

Exclude from proposal candidates:
- Files in `hubs[]` — they are shared infrastructure (logger, design-system, utils)
- Test files (`kind == "test"`), index files (`kind == "index"`), config files (`kind == "config"`)
- Files already belonging to a hub-dominated cluster (fan-in >> fan-out)

## Step 3 — validate with import graph

For each domain candidate, compute cohesion from `imports[]`:

- **Tight cluster** (good): files in the candidate mostly import each other; few external edges
  → mark `✓ tight cluster`
- **Disconnected** (warn): candidate lumps two files with no imports between them
  → mark `⚠ disconnected — consider splitting`
- **Spans a hub** (warn): candidate includes a high-fan-in file that is also imported by files
  outside the candidate → mark `⚠ includes infrastructure file`

## Step 4 — bounded free-read fallback (≤ 30 reads)

When a domain boundary is ambiguous from names alone (two files share a name root but may be
unrelated), open the file(s) to check. **Hard cap: 30 file reads total per init pass.** After
reaching the cap, finalize proposals with what is known and note any unresolved spots.

## Step 5 — stopping rule (curation, not coverage)

- Propose only candidates above a clear-domain confidence bar.
- Cap: **~8 concepts per app unit, ~4 per package unit**. If inference produces more, prefer
  tighter, higher-confidence slices and drop borderline ones.
- Do NOT try to cover every file. Report uncovered tail as intentional — utils, config, glue
  code belongs to no clean domain and stays uncovered on purpose.

## Step 6 — present proposals for per-concept approval

For **each** proposed concept, show:

```
Concept: web/workorder-store

  Domain: Workorder store + supporting hooks/components; everything that reads/writes
          the workorder data model.

  Globs:
    src/store/workorder.store.ts
    src/hooks/use-workorder*.ts
    src/routes/*/workorder-card.tsx

  Captures: 7 files
  Samples:  src/store/workorder.store.ts, src/hooks/use-workorder-list.ts, …

  Cohesion: ✓ tight cluster — all 7 files import each other at ≥1 hop

  [accept / edit globs / rename / reject]
```

Wait for the user's response per concept before moving to the next. Accepted globs are
locked; if the user edits globs, re-check coverage against the digest file list and show
the updated set.

Surface overlaps as information: "src/lib/dates.ts is also in web/scheduling" — not a
conflict to resolve.

## Step 7 — coverage summary

After all concept decisions, show:

```
Coverage summary
  Accepted: N concepts covering M files (K% of source files)
  Intentionally uncovered: utils/, config/, shared/, …
```

Ask the user to confirm before writing.

## Step 8 — scaffold scribe.config.json

Collect from the user (or auto-detect + confirm):

- `project` — immutable DB name. Detect from `package.json "name"` (strip `@scope/`), confirm
  with the user since it is the ArangoDB database name and cannot be changed later.
- `tsconfig` — auto-detected from the catalog run; show the detected value.
- `skillsDir` — optional (`".claude/skills"` if the dir exists, otherwise omit).

Write the file:

```json
{
  "project": "<confirmed>",
  "tsconfig": "<detected>",
  "skillsDir": ".claude/skills",
  "concepts": {
    "<accepted concept name>": {
      "globs": ["<glob1>", …]
    }
  }
}
```

No `skill` field per concept — SKILL.md is authored at enrich time, not init time.

Report to the user:
```
Wrote scribe.config.json with N concepts.

Next steps:
  code-graph bootstrap        # create the ArangoDB database
  code-graph extract <c>      # per concept: structural build (zero tokens)
  code-graph apply <c>        # upsert into DB

Enrichment (tokens) is deferred — run /scribe-enrich <c> when you're working in that domain
and have written its SKILL.md.
```

## Hard rules

- **Never run init twice** — check precondition first, stop if scribe.config.json exists.
- **Never write anything except scribe.config.json** — no other files.
- **30-file read cap** — enforce strictly; finalize with partial info past the cap.
- **No forced coverage** — uncovered tail is intentional. Do not manufacture junk concepts.
- **Hub exclusion is mandatory** — files in `hubs[]` must never be proposed as concept roots.
- **Per-concept approval is mandatory** — never write without explicit user acceptance.
- **Concept keys are immutable after write** — they feed the vertex `_key` hash; changing a
  concept name later requires delete + re-add.
