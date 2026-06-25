# Phase 10 — `code-graph-init`: concept cataloging & delete-concept

## Goal

Fill the onboarding gap. Today a human hand-authors `scribe.config.json` before any
code-graph command works — `installation.md` only sets up the **tool**, never a project. This
phase adds a one-time **initialization** step that scans a project, **proposes a curated set
of concept slices**, and writes `scribe.config.json` (skeleton + concepts) under per-concept
user approval. It also adds **delete-concept**, the safety valve that makes a one-shot init
recoverable.

The onboarding sequence becomes:

```
install the tool once (installation.md)
   → /code-graph-init           ← NEW: writes scribe.config.json + concepts
   → code-graph bootstrap       (DB + collections + view)
   → per concept: code-graph extract → /scribe-enrich → code-graph apply
```

## Scope & non-goals

- **Initialization-only.** `code-graph-init` runs **once**, at first setup. There is **no
  manual re-run mode** and **no merge/re-pass logic** — that complexity is deliberately
  excluded.
- **All post-init change goes through single-operation tools.** `delete-concept` (specced
  here) + `add-concept` (deferred) compose into "update the segmentation," one operation at a
  time. Add + delete is the update mechanism; there is no incremental re-catalog.
- **Specced here:** `code-graph-init` (skill) + `code-graph catalog --json` (CLI digest) +
  `code-graph delete-concept` (CLI) + `add-concept` (skill — *catalog-of-one*).

## Enrichment is incremental, by design

Cross-cutting principle that shapes both `code-graph-init` and `add-concept`: **semantic
enrichment (`/scribe-enrich`) is token-expensive; structural build (`extract → apply`) is
not.** `extract`/`apply` are deterministic ts-morph + DB upsert — **zero LLM tokens** — and
produce a structurally-queryable concept (impact / cross / vertex all work) with no SKILL.md.
`/scribe-enrich` is the token-heavy subagent pass that adds `purpose`/`tags`.

So the model is: **declare + structural-build cheaply now, enrich incrementally later** — one
concept at a time, when the user is actually working on that feature and has the domain
knowledge to write the SKILL.md well. This matches the existing grain (`CLAUDE.md`: concepts
are enriched one at a time) and avoids spending a whole session's tokens enriching a project
up front. Curation (small, tight concepts) is what keeps each incremental enrichment cheap.

## What a "concept" boundary is (the load-bearing decision)

A concept is drawn by **feature/domain cohesion** — "all the code that makes the workorder
store work," spanning store + hooks + components + types, possibly across directories. The
**import graph validates** that boundary; it never sets it. This is the curation contract from
`CLAUDE.md`: a concept is *a named slice*, **not** a partition that must cover every file.

Consequence the skill must internalize: domain boundaries from names will always leave a long
tail (utils, config, glue) that belongs to no clean domain. **That tail stays uncovered on
purpose.** The skill proposes high-value slices and reports the uncovered remainder — it does
not try to bucket everything.

## Detection — the CLI digest (`code-graph catalog --json`)

Deterministic facts → CLI; judgment → skill (same split as phase 9). The CLI does a
**repo-wide ts-morph pass** and emits *pure facts, no proposals*.

- **Full ts-morph project, seeded from `tsconfig` repo-wide** (not concept globs — no concepts
  exist yet). Reuses `extract.ts`'s ts-morph machinery; tsconfig gives the file set + import
  resolution (aliases, re-exports) for free. Accuracy of the import graph directly determines
  proposal quality, so the full pass is worth the one-time cost; no lighter syntactic parser.
- **Lightweight digest, not full vertices/edges.** Per file: `{ path, unit, exports: [names],
  kind, leadingDoc? }`. Plus **import adjacency** (file→file). Plus **workspace units**
  (below). Plus **fan-in / fan-out** per file (for hub detection). It does **not** read file
  bodies or propose anything — bodies are the skill's bounded job.
- **Workspace units.** Detected deterministically in priority order:
  `pnpm-workspace.yaml` → root `package.json` `"workspaces"` → `turbo.json`/`nx.json` →
  fallback to `apps/*` + `packages/*` convention. A single-package repo is just one unit (the
  root); monorepo is the general case.

## Proposal — the skill (`code-graph-init`)

### Signal acquisition (no whole-repo reads)

1. **Infer domains from the digest** — names + exports + structure. This is the domain-cohesion
   judgment; the common case opens **zero files** and scales to thousands of files.
2. **Validate against the import graph — two ways:**
   - **Cohesion check** — does a proposed concept hold together as a cluster? A concept that
     splits a tight cluster, or lumps two disconnected islands, is flagged for reconsideration.
   - **Hub exclusion** — high-fan-in files are almost always shared infrastructure (utils,
     design-system, logger). **Exclude them from being proposed as concepts.** (This is why
     "follow call traces to the roots" is a guardrail, not the discovery mechanism — root-
     finding surfaces infra, not domains.)
3. **Bounded free-read fallback** — open actual files only to disambiguate a boundary the names
   can't resolve. **Hard cap: 30 file reads per pass.** Past the cap, propose with what's known
   and flag the unresolved spots.

### Stopping rule (curation, not coverage)

- **Confidence-primary** — propose only concepts above a cohesion/clarity confidence bar,
  however many that is.
- **Count-cap as a safety valve, scaled per unit** — never flood. Defaults ~**8 concepts per
  app, ~4 per package** (tunable). The global ceiling is the sum across units, never a flat N.
- **Coverage is a reported metric, never a target.** The skill reports "N% of source files
  intentionally uncovered: utils/, config/, …" — it does not chase a coverage number (that
  manufactures junk concepts).

### Naming — namespaced keys

Concept keys are **namespaced by unit**: `web/workorder-store`, `api/billing`,
`ui-kit/forms`. This is a *naming convention*, not a schema change (`scribe.config.json` keys
are flat strings). It prevents collisions when two apps both have an "auth" domain and makes
the DB `concept` field self-describing. Note: the key feeds the vertex `_key` hash, so it is
chosen once and is expensive to rename later.

### Glob generation

Emit the **broadest glob that captures only the intended files**, hybrid per concept:

- Domain **wholly owns a directory** → directory glob (`src/features/gantt/**`). Compact,
  survives new files in that folder.
- Domain **scattered or shares a directory** → narrower patterns (`src/hooks/useWorkorder*.ts`)
  or, last resort, explicit file paths.
- The skill **tests each candidate glob** against the digest file list (minimatch, already a
  dep) and shows the captured set in the review, so the user sees exactly what a glob grabs
  before accepting. Globs prefer the broadest pattern that doesn't reach into the intentionally-
  uncovered tail.

### Overlap — allowed

A file may belong to **more than one concept** (the system supports it: `_key` includes
`concept`, so the file becomes a distinct vertex under each). The review **surfaces** overlaps
as information ("`src/lib/dates.ts` is in both `web/scheduling` and `web/billing`") — not as a
conflict to resolve.

### Skeleton creation

On a true first run there is no config file at all. The skill **scaffolds `scribe.config.json`
itself** (nothing else does, and `bootstrap` can't pick a DB name without `config.project`):

- `project` (DB name) — detected from `package.json` `name` or repo dir, **confirmed with the
  user** since it is the immutable DB name.
- `tsconfig` — auto-detected.
- `skillsDir` — optional, offered.
- `concepts` — the accepted proposals.

### Approval flow — per-concept, write once

Per the phase-9 "never silently write" ethos. The skill presents, **for each proposed
concept**: namespaced **name**, one-line **domain rationale**, proposed **globs**, **file
count + sample paths** captured, and the **cohesion-validation note** (✓ tight cluster / ⚠
pulls in disconnected files). The user **accepts / edits globs / renames / rejects each
concept independently**, separately reviews the **coverage summary**, and only then does the
skill write skeleton + accepted concepts to `scribe.config.json`.

## delete-concept — the safety valve (CLI)

Deletion needs no judgment, so it is a **deterministic CLI command**, not a skill:
`code-graph delete-concept <name>` (interactive confirm + `--yes` for scripts; a thin
`/delete-concept` slash command may wrap it for in-session use). Without delete, a wrong first
init is unfixable — this is what makes "init-only, no re-pass" tenable.

- **Archive, never hard-delete** — mandated by the existing model (`status: "live" |
  "archived"`; hard-delete / `code-graph gc` are out of scope). Marks every vertex of the
  concept `status: "archived"` (same path `apply` uses for missing vertices), archives its
  edges, and archives the `docs/<concept>::skill` vertex.
- **Config + artifacts** — removes the `concepts.<name>` key from `scribe.config.json` and the
  regenerable `scribe-output/<concept>.{ast,enriched}.json`.
- **Overlap is clean by construction** — a file in two concepts has two distinct vertices;
  delete archives only *this* concept's copy. No special handling.
- **Dangling cross-concept refs — leave + report.** Other concepts' `cross_concept_refs` /
  agent-authored edges may point into the deleted concept; after archive those targets are
  archived (retrieval already filters to live). The command **reports** them ("3 refs from
  `web/billing` now point into deleted `web/scheduling`") so the user knows where enrichment
  elsewhere may be stale — it does not auto-fix.

Update-by-composition: delete a stale concept → its files become uncovered → declare a
replacement via `add-concept`. One operation at a time, never a merge.

## add-concept — the single-domain echo of init (skill)

add-concept is **`code-graph-init` scoped to one domain**: the only thing it automates beyond
hand-editing config is the *judgment* — proposing globs for a domain from a **seed** — plus
the zero-token structural build. It is also the **remediation for phase-9 gap (c)**: phase 9
deliberately surfaces "uncovered code" but never fixes it because it "needs a config edit" —
add-concept *is* that edit, so a whiff that finds its answer in uncovered files routes straight
into add-concept with those files as the seed.

A skill, not a CLI: the value is *proposing globs*. The "I already know the exact globs" case
needs no tool — hand-edit `concepts` + run the existing pipeline.

### Input — seed-required, with import-graph expansion

- **Primary: a seed** — a file, directory, or symbol the domain centers on. Best when the seed
  is the **concept root** (e.g. `workorder.store.ts` for `workorder-store`): a domain root is
  the high-cohesion *center* of the cluster, distinct from a global infra **hub** (which is
  excluded). The skill may *suggest* likely roots; the user names one.
- **Fallback: description-only** — no seed; the skill runs a repo-wide digest + name-match to
  *locate* candidate files, then proceeds. Explicitly more expensive (full pass + fuzzy
  locate); not the design center.
- **Scoped scan** — unlike init's repo-wide pass, add-concept runs the digest **scoped to the
  seed's import-graph neighborhood** (N hops), since it is invoked ad hoc and repeatedly.

### Expansion from the root — bidirectional, asymmetric, cohesion-gated

From the root the import graph runs two ways, meaning different things:

- **Dependents (fan-in)** — who imports the root (hooks, components using a store). This mostly
  *defines* a store/service domain — its consumers. Include tight wrappers; **stop** at a file
  that is mostly about something else, already belongs to another concept (→ surface as
  overlap, don't auto-absorb), or is a generic consumer with no domain cohesion.
- **Dependencies (fan-out)** — what the root imports (domain types: include; hubs/shared infra:
  exclude; files already in another concept: stop).
- **Bounds** — small default hop depth (1–2), extended only while cohesion stays high; plus the
  inherited caps (30-file read budget, per-concept count). Signal for "belongs" = naming +
  directory locality + import-graph cohesion, not reading every candidate.
- **Borderline files** (import the root but ~half about another domain) → **excluded by
  default**, listed as "borderline — add?" suggestions in the review. Curation > coverage; the
  review lets the user opt them in.

### After approval — declare + structural build, defer enrichment

Mirrors phase-9 option C: the skill detects + proposes + writes the **one config key**, then
returns; the **outer agent** orchestrates the build.

- **Auto-run structural build** — `code-graph extract <c> → code-graph apply <c>` immediately.
  Zero-token, deterministic, makes the concept queryable at once.
- **Enrichment is deferred, not auto-run** — a brand-new concept has no SKILL.md, so
  `/scribe-enrich` would hard-fail anyway, and (per "enrichment is incremental") we do *not*
  want to spend tokens up front. The agent surfaces: *"Added and built `web/billing`
  structurally. Enrich it (with a SKILL.md) when you're working in it."* Enrichment happens
  later via explicit `/scribe-enrich <c>` or by accepting the phase-9 completeness offer.
- **SKILL.md is not auto-scaffolded** — an empty stub only pollutes the graph with an empty
  `docs/<concept>::skill` vertex. It is authored *at enrich time*, alongside the feature work
  (when the user actually has the domain knowledge).

### Naming, namespacing, review

- **Name** proposed from the root seed (`workorder.store.ts` → `workorder-store`), user
  confirms/edits.
- **Namespace** (unit) derived from the seed's location (seed in `apps/web/...` → `web/<name>`),
  consistent with init's namespaced keys without asking.
- **Review** is the single-concept version of init's per-concept gate (name, rationale, globs,
  captured-set + samples, cohesion note, overlaps surfaced); write the one key on approval.

## Invocation & discovery

- **Initialization-only trigger** — the `code-graph-init` skill is run via **`/code-graph-init`,
  once**, at onboarding. It is **not** model-auto-triggered (writing `scribe.config.json` is
  too consequential for a probabilistic trigger) and has no re-run mode.
- **Discovery pointer (skill-side only).** When `code-graph-retrieval` (or an in-session path)
  hits a project with **no `scribe.config.json`**, it surfaces: *"This project isn't
  initialized — run `/code-graph-init` to set up the graph."* Same answer-first/suggest-don't-
  act pattern as phase 9. The **CLI's exit-5 stays terse** ("create `scribe.config.json`") —
  the CLI runs standalone without the plugin, so it must not advertise a plugin-only slash
  command.
- **`add-concept` trigger** — explicit `/add-concept [seed]` (seed = file/dir/symbol), **plus
  the phase-9 gap-(c) auto-offer**: on a whiff whose answer lives in uncovered files, the agent
  offers "declare a concept for these?" and routes into add-concept with those files as the
  seed. Answer-first/non-blocking, same as the rest of phase 9.

## Naming

- **Skill / slash command: `code-graph-init`** (matches the `code-graph-retrieval` family).
  *Not* `code-graph-install` — "install" already means putting the tool on the machine
  (`installation.md`), which by definition happened before any skill can run. *Not*
  `scribe-catalog` — that names the internal mechanism and uses the older `scribe-*` prefix.
- **CLI digest command: `code-graph catalog --json`** — the CLI pass genuinely *is* a
  cataloging pass, so "catalog" fits the CLI verb even while the user-facing skill is "init."

## Testing

- **Pure-function core (CLI digest)** — DB-free, deterministic, exhaustively unit-tested:
  workspace-unit detection (each manifest type + convention fallback), glob→captured-set
  coverage, fan-in/fan-out + hub flagging, overlap detection.
- **delete-concept** — unit-test the config mutation (key removal), the archive marking
  (vertices/edges/skill-doc → `archived`, never deleted), artifact cleanup, and the
  dangling-ref report.
- **One integration test** against a small seeded throwaway DB for the delete archive path +
  the `--json` digest contract shape.
- **Pilot DB untouched** — no pilot mutation; fixtures live in dedicated unit tests.

## Deferred (tunable / out of scope)

- **Chunked enrichment within a concept** — the incremental model assumes a single concept is
  small enough to enrich in one `/scribe-enrich` pass. A genuinely huge concept could still
  blow a session's token budget on its own. That's the enrich skill's problem, not
  add-concept's (and curation keeps concepts small) — but if it bites, the fix is splitting a
  concept's enrichment into chunks. Out of scope here.
- **Tunables** — per-app / per-package count caps; the cohesion/confidence bar; the 30-file
  read budget; add-concept's expansion hop depth.
- **Merge / incremental re-catalog** — explicitly excluded; superseded by add + delete.
- **Overlap conflict resolution** — overlap is allowed and only surfaced, never resolved.
- **Embedding-based clustering** — names + import graph only, consistent with the BM25-first
  stance.
- **`code-graph init` as a separate CLI command** — unnecessary; the skill scaffolds the
  config, and the CLI can't launch a skill anyway.
