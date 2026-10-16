# Epic: absorb-concept-skills

## Goal

code-graph absorbs what maestro's `concept-skills` plugin does well (versioned, marker-stamped
concept SKILL.md files; create/update/scribe flows; install lifecycle; design skills), so maestro
can drop concept-skills and point its scribe and subagents at `code-graph:*` skills. Source plan:
`plan.md` at the repo root.

## Scope

In: tasks 003–006 — layer-1 skills CLI + bundled `plugin/scripts/code-graph.cjs`, graph-layer
freshness and docs-only concepts, the ported plugin skills, dogfood/parity/publish.

Out: anything in `~/gits/maestro` (its cutover is maestro tasks 105–107, epic
`code-graph-cutover`, managed by the maestro session `maestro-ca`); an HCL extractor.

## Decisions

- Autonomous repos: port and inline, no dependency on maestro code; code-graph keeps its own
  marketplace.
- Two layers: concept skills work in any repo (Terraform included); the graph lights up only
  where a tsconfig exists. Docs-only concepts are still searchable.
- Concept = `scribe.config.json` globs + byte-compatible concept-skills marker in SKILL.md.
- Small bundle: `typescript`/`ts-morph` external, resolved from the target project. Layer 1 never
  loads `node:sqlite`.
- One scribe skill; the gap-channel contract (`.claude/channels/scribe/`) is kept verbatim.
- On publish (end of 006), send the published version in one line to the session named
  maestro-ca (resolve via ListAgents); it unblocks maestro task 105.
- r001 (003 done): repo-level `skills stamp` without `--bump` resets to 1.0; 005's update flows pass
  `--bump minor` and install's migration keeps the legacy version. 004 also guards the stored sha in
  `skills status` and tests mixed LF/CRLF stamping. maestro-ca declined upstreaming the CRLF fix (107 deletes concept-skills; no maestro SKILL.md is CRLF).
- r002 (005 done, in worktree code-graph-task-005 / branch task-005, uncommitted): plugin.json and
  marketplace.json already at 0.3.0, so 006 publishes 0.3.0 without a double bump; 006 also runs
  the create/update/install flows end to end in Claude (005 didn't). code-graph-init and
  scribe-code-graph were merged away. task-005 merged in d110335.
- r003 (004 done, uncommitted in the main checkout): `just eval` is now 6/6. `drift --json` compares
  ast.json to the store, so `extract` runs before `drift`. 004 committed in eb68ef2.
- r004 (006 done, uncommitted): version 0.3.0, eval 7/7, maestro-copy parity byte-identical,
  Terraform search hit, docs-only `search`/`concept` defect fixed. Not verified live: the
  create/update/install flows inside Claude and a real Node <22.5 — maestro task 106 (switch maestro
  to code-graph, dogfood the scribe) is the natural live run. The version goes to code-graph-cutover
  as a note once 0.3.0 is committed and pushed (maestro-ca, its recorded manager, is not running).
- 0.3.0 committed (6b97d5d) and installed locally from the repo dir; maestro-1c now manages
  code-graph-cutover. Its finding: 0.3.0 still ships superseded commands. Decision (task 007): drop
  /scribe-enrich, /code-graph-init and the /add-concept command (skill stays), keep /graph, list the
  full surface in docs, publish 0.3.1 and tell maestro-1c.
- r005 (007 done, committed 7e3118b): 0.3.1 published locally. Post-mortem on the scribe/source
  boundary filed as maestro ticket 108 (A: ticket wording, B: Documentation workflow route).
- maestro-1c's 106 dogfood findings → task 008, ships as 0.3.2: no concepts = exit 0 no-op;
  typescript/ts-morph resolve from a plugin-owned dir first (filled by an explicit
  `code-graph deps install`, never a silent download), project install as fallback. maestro's
  graph-concepts follow-up (maestro task 109) waits on it; send maestro-1c one line when 0.3.2 is
  published.
- r006 (008 done, uncommitted): 0.3.2. Only ts-morph is installed (it carries its own compiler);
  deps dir = $CLAUDE_PLUGIN_DATA/deps, then the XDG cache, then the project. Not automated: the
  real-npm monorepo run (verified by hand) and .gitignore idempotency (skill prose). A networked CI
  check of `deps install` was suggested; not ticketed unless the user asks.
- 0.3.2 committed (ae504c7) and installed locally. maestro-de (formerly maestro-1c) now manages
  code-graph-cutover and recorded 0.3.2; maestro 109 is unblocked. Other machines see 0.3.x only
  after feat/integrate-concept-skills is pushed and merged (maestro uses the GitHub marketplace).
- maestro-de's first real graph (0.3.2, 16 concepts) → task 009: doc-seeded search drops to 0
  concepts in plain text and returns no edges in --json, plus a pre-enrichment hint. Task 010:
  package.json still says 0.1.0 (the version baked into the bundle), and per-run `extracted_at` stamps make
  ast.json churn on every extract. maestro keeps ast.json uncommitted until 010 ships.
- r007 (009 done, uncommitted, code-graph-4c): doc-seeded vertices get one-hop edges (cap 20 per
  concept), the cluster survives the token budget, plus a scribe hint. The cause was confirmed by
  reading the code, not on a real store; maestro's graph is the live check. `collectEdges` runs for
  every vertex in the concept before the cap is applied. A cleanup of code-graph-search SKILL.md
  (stale ArangoDB invariant, Phase 1 reference) was offered but not ticketed. Committed in ffc15aa.
- r008 (010 done, uncommitted, code-graph-8f): 0.3.3. The three version files are aligned and
  `check-versions.mjs` (run in pnpm check and bundle) fails on drift. ast.json no longer carries
  per-vertex or per-edge extracted_at; apply stamps the store, and meta.extracted_at advances only
  on a content change. No schema change. Existing ast.json files get rewritten once on the next
  extract, and each version bump rewrites extractor_version once. Committed in 9f166c0. One line
  covering 009 and 010 went to maestro-0c, the only live maestro session (maestro-de is the
  recorded cutover manager).
- maestro-0c (now the cutover manager) verified 0.3.3: --version is right, the second extract was
  byte-identical, and the ast.json files are now committed in maestro. New non-blocking finding →
  task 011: plain-text search prints one line per call-site edge, using the caller's start line, so
  lines repeat. The ~14.7k token total vs the 3000 default budget also needs a check.
