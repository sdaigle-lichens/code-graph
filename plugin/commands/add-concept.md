---
description: Add one new concept to scribe.config.json via seed-driven import-graph expansion, then auto-run the structural build
argument-hint: [seed-file | seed-dir | seed-symbol]
---

# /add-concept

Add a single new concept to an existing `scribe.config.json`. The skill proposes globs from
a seed (a file, directory, or symbol name at the domain center), gets approval, writes the
config key, and runs `code-graph extract + apply` automatically.

## When to use

- After `/code-graph-init` to add a domain that wasn't proposed initially
- After `code-graph delete-concept <name>` to declare a replacement
- When a whiff (`code-graph search` exit 6) surfaces uncovered files that belong to a new
  domain — pass those files as the seed

**Not needed** when you already know the exact globs — just hand-edit `scribe.config.json`
and run `code-graph extract <c>` + `code-graph apply <c>` directly. The skill's value is
the *judgment* of proposing the right globs.

## Usage

```
/add-concept <seed>
/add-concept src/store/workorder.store.ts
/add-concept src/features/billing/
/add-concept BillingService
```

- `seed` — file path, directory, or symbol name at the domain center. Required; if omitted
  the skill will run a repo-wide catalog pass and attempt name-match (more expensive).

## Procedure

1. Verify `scribe.config.json` exists (walk up from CWD). If missing, stop: "run
   `/code-graph-init` first to initialize code-graph for this project."

2. Invoke the `add-concept` skill with the seed argument. The skill will:
   - Run `code-graph catalog --json` to get the import graph
   - Check if the seed is a hub (warn if so, ask for a better seed)
   - Expand bidirectionally from the seed (1–2 hops, cohesion-gated)
   - Propose globs, namespace from seed unit, name from seed filename
   - Present the review for approval
   - On acceptance: write the concept key to `scribe.config.json`, then run
     `code-graph extract <c>` and `code-graph apply <c>`

3. When done, remind the user:
   - The concept is structurally queryable now (impact / cross / vertex all work)
   - Enrichment is deferred: write a SKILL.md, then run `/scribe-enrich <concept>`

## Exit conditions

- `scribe.config.json` not found → stop, redirect to `/code-graph-init`
- Seed is a hub → warn, ask for a different seed; do not proceed with hub as root
- `code-graph extract` or `code-graph apply` fails → surface the error; user can re-run
  manually after fixing
- User rejects the proposed concept → stop; no changes written
