# Phase 6 — Query modes (concept / impact / cross / vertex)

## Goal

Implement the four secondary query modes: `concept`, `impact`, `cross`, `vertex`. These are direct affordances for callers who already know what they want — Claude Code (or a human) reaches for these when the search hybrid isn't the right shape.

All modes scoped by current project DB (resolved from nearest `scribe.config.json`). Output is markdown by default; `--json` returns raw vertices/edges.

## Context

### CLI surface

```
code-graph query concept <name> [--depth=1] [--max-tokens=3000] [--json] [--no-skill]
code-graph query impact <symbol> [--direction=in|out|both] [--max=20]
code-graph query cross <conceptA> <conceptB>
code-graph query vertex <filepath>:<line>
```

All modes accept `--json` and `--max-tokens=<n>` (default 3000).

### Token budget — truncation order (highest-value last)

When formatted output exceeds budget, drop in this order:
1. `reason` strings on edges
2. low-degree leaf vertices (vertices with ≤1 incident edge in the result set)
3. skill doc body (truncate from end, preserve first ~500 chars)

Skill prose is the highest-value content — never drop entirely if it's part of the result.

### Mode: `concept <name>`

Dump the whole subgraph for a concept. Default `--depth=1` means "vertices + their direct edges within the concept". Includes the concept's `docs/<name>::skill` body inline unless `--no-skill`.

**AQL**:
```aql
LET vertices = (
  FOR v IN vertices
    FILTER v.concept == @concept AND v.status == "live"
    RETURN v
)
LET edges = (
  FOR e IN edges
    FILTER e.concept == @concept
    RETURN e
)
LET doc = DOCUMENT("docs", CONCAT(@concept, "::skill"))
RETURN { vertices, edges, doc }
```

**Markdown shape**:
```
# Concept: workorder-store

## Skill (invariants, algorithms, gotchas)
<full SKILL.md body>

## Vertices (N)
- @<filepath>:<start>-<end> — `<name>` (<type>) — <purpose>

## Edges (M)
- <fromName> --calls--> <toName>  (line N) — <reason>
```

### Mode: `impact <symbol> [--direction]`

"What breaks if I change X?" — find the vertex by `name`, traverse along impact-relevant edges.

**Resolution**: `FOR v IN vertices FILTER v.name == @symbol AND v.status == "live" RETURN v`. If multiple matches → exit 4 with candidate list (concept + filepath + type per candidate) on stderr.

**Traversal** (direction-dependent):
- `in` (default impact direction) — who calls me / who triggers me / who delegates to me. Follow `calls, triggers, delegates-to` edges with `_to == startVertex`. Depth 2.
- `out` — what I call / what I trigger / what I delegate to. Same edge types, `_from == startVertex`. Depth 2.
- `both` — union of in and out.

**AQL skeleton** (in direction):
```aql
LET start = FIRST(FOR v IN vertices FILTER v.name == @symbol AND v.status == "live" LIMIT 1 RETURN v)
FOR v, e, p IN 1..2 INBOUND start edges
  FILTER e.type IN ["calls", "triggers", "delegates-to"]
  RETURN DISTINCT { vertex: v, edge: e, depth: LENGTH(p.edges) }
```

**Markdown shape**:
```
# Impact (inbound, depth 2): setWorkorderIndex

## Direct callers
- @<file>:<line> — `<name>` — <reason if any>

## Indirect callers (depth 2)
- @<file>:<line> — `<name>` ← <intermediate>
```

`--max=20` caps results.

### Mode: `cross <conceptA> <conceptB>`

Vertices that participate in cross-concept edges between the two concepts.

**AQL**:
```aql
FOR e IN edges
  FILTER e.crosses_concept == true
  LET fromV = DOCUMENT(e._from)
  LET toV = DOCUMENT(e._to)
  FILTER (fromV.concept == @a AND toV.concept == @b) OR (fromV.concept == @b AND toV.concept == @a)
  RETURN { edge: e, from: fromV, to: toV }
```

**Markdown shape**:
```
# Cross: <conceptA> ↔ <conceptB>

- <conceptA>::<name> --<edgeType>--> <conceptB>::<name> — <reason>
```

If no edges → exit 0 with "no cross-concept edges between A and B".

### Mode: `vertex <filepath>:<line>`

Find vertex enclosing the given line, return it + 1-hop neighbors.

**AQL**:
```aql
LET v = FIRST(
  FOR x IN vertices
    FILTER x.filepath == @filepath
       AND x.start_line <= @line
       AND x.end_line >= @line
       AND x.status == "live"
    SORT x.start_line DESC
    LIMIT 1
    RETURN x
)
LET neighbors = (
  FOR n, e IN 1..1 ANY v edges
    RETURN { neighbor: n, edge: e }
)
RETURN { vertex: v, neighbors }
```

If no vertex matches → exit 6.

**Markdown shape**:
```
# Vertex: @<filepath>:<line>

`<name>` (<type>) — <purpose>
Signature: `<signature>`

## Neighbors
- → <name> via <edgeType>
- ← <name> via <edgeType>
```

## Tasks

1. Create `src/query/preflight.ts` — centralized exit-code-conscious checks reused by every query mode AND by phase 7's `search`:
   - `loadConfigOrExit(): ScribeConfig` — wraps `tryLoadConfig`; exits 5 with stderr "no scribe.config.json found above <cwd>".
   - `checkServerReachable(): Promise<void>` — probes `getSystemDb().version()`; exits 2 with stderr "ArangoDB not reachable at <url>; try `code-graph up`".
   - `checkDbExists(dbName: string): Promise<void>` — checks `_system` DB list; exits 3 with stderr "DB <name> not found; try `code-graph bootstrap`".
   - `preflight(): Promise<{ config, db }>` — runs all three in order, returns the config + a `Database` handle for the project DB.

   Every query mode and `search` calls `preflight()` before running its AQL.

2. Create `src/query/queries.ts` — export typed AQL query functions:
   - `queryConcept(db, concept) → { vertices, edges, doc }`
   - `queryImpact(db, symbol, direction, max) → { startVertex, results } | { ambiguous: candidates[] }`
   - `queryCross(db, a, b) → { edges }`
   - `queryVertex(db, filepath, line) → { vertex, neighbors } | null`
2. Create `src/query/format.ts`:
   - `formatConcept(result, opts)` → markdown string
   - `formatImpact(result, opts)` → markdown
   - `formatCross(result, opts)` → markdown
   - `formatVertex(result, opts)` → markdown
   - `truncate(markdown, maxTokens)` → applies the truncation order. Token estimator: `chars / 4`.
3. Create `src/query/run.ts`:
   - `run(mode, args, opts)` dispatcher.
   - Calls `preflight()` first.
   - Handles `--json` (skip formatting, emit raw result).
   - Handles ambiguous-symbol exit 4 with candidate list to stderr.
   - Handles "no result" cases — exit 6 for vertex mode, exit 0 with note for cross.
4. Wire `code-graph query concept|impact|cross|vertex` subcommands in `src/cli.ts`.

## Done when

- `code-graph query concept workorder-store` returns ~15–25 vertices + skill body inline.
- `code-graph query concept workorder-store --json | jq '.vertices | length'` matches DB count.
- `code-graph query impact setWorkorderIndex --direction=in` returns at least `useDndWorkorderList` (per Phase 8 verification step).
- `code-graph query impact <ambiguous-name>` exits 4 with candidate list on stderr.
- `code-graph query cross workorder-store scheduler-store` returns the cross-concept edges (empty list acceptable until 2nd concept is onboarded).
- `code-graph query vertex src/store/workorder.store.ts:60` returns the enclosing vertex + 1-hop neighbors.
- `--max-tokens=500` produces truncated markdown that still includes the skill body's first ~500 chars.
- `--json` flag returns valid parseable JSON with vertices/edges.
