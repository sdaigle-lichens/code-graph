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
- r009 (011 done, uncommitted, code-graph-ce): plain text groups edges by (other vertex, type),
  showing (line N), (lines a, b, c) or ×N, plus every distinct reason; --json is unchanged. The
  totals line was stale (counted before trimming) and is now restated after it; --max-tokens was
  already honoured. The enrichment warning cli.ts appends runs ~14 tokens over budget (documented;
  follow-up offered, not ticketed). Published as 0.3.4, a version-only bump so the plugin update
  picks it up.
- maestro-0c verified 0.3.4 (edges grouped, totals ~3004). New finding → task 012: every plugin
  release rewrites every .ast.json, because extractor_version is on each vertex and meta's
  timestamp comparison includes the version. maestro is holding its 0.3.4 re-extract uncommitted:
  with 012 shipped it gets one rewrite instead of two.
- r010 (012 done, code-graph-d6, in worktree code-graph-task-012, uncommitted and unmerged): 0.3.5.
  The extractor version is recorded only in meta; apply stamps the store's per-vertex copy from it,
  and a per-vertex value from an older file wins. meta is kept whole when vertices, edges and skill
  are unchanged, so an upgrade alone is byte-identical; meta.extractor_version = the version that
  last changed the content. The skill block is in the comparison too (the user approved). Unchanged
  vertices keep their first-written store extractor_version. No test covers a change to the skill
  or edges alone. Send maestro-0c one line after the merge: commit only the first 0.3.5 rewrite.
- Gaps closed before the merge (the user approved): code-graph-d6 added skill-only and edge-only
  meta tests (275/275). The stale TOKENS/PHRASE line in the code-graph-search skill was fixed and
  re-applied. The rest was left on purpose: the ~14-token overrun, mid-heading truncation, the
  stale store extractor_version (nothing reads it), and the networked deps CI.
- task-012 merged in 8113777 (0.3.5); maestro-0c was told to discard the held 0.3.4 re-extract
  and commit only the first 0.3.5 rewrite.
- maestro-0c verified 0.3.5: after the one-time rewrite, two re-extracts in a row were
  byte-identical. Feature request (the user's): enrich incrementally as tasks touch code, not in a
  bulk pass; maestro dropped its bulk-enrichment task. The user chose 2 tasks. 013 (CLI, 0.3.6):
  `enrich targets` and `enrich merge`, stale on contentHash (hash_seen; old entries keep the
  signature rule), and gaps ignore stale descriptions. 014 (skills, 0.3.7, blocked by 013):
  retrieval writes skill_gaps to the scribe channel; the update flows enrich only targets via Haiku
  fan-out from the caller plus a spot-check. Send maestro the task numbers and versions when they
  ship.
- maestro-0c's constraints on the gap file, added to 014: exactly one json block, merged in
  place; a leading run_id line kept untouched; no run_id written (SubagentStop stamps it); the
  file named after the agent's bare name; main-session gaps aren't promised to be inlined. maestro
  queues its end-to-end check after 0.3.7.
- r011 (013 done, uncommitted, code-graph-16): 0.3.6, 285/285, eval 7/7. `enrich targets` and
  `enrich merge` were chosen over `apply --merge`. merge stamps hash_seen; legacy sig_seen-only
  entries keep the signature rule; a new vertex with a mismatched hash_seen starts stale. enrich.ts
  is imported lazily in cli.ts, so layer 1 stays sqlite-free. Added to 014: the scribe skill stops
  hand-stamping sig_seen. Committed in 892b871.
- r012 (014 done, uncommitted, code-graph-db): 0.3.7; pnpm check, eval 7/7 and plugin validate pass.
  Retrieval: subagents append skill_gaps after answering, following maestro-0c's rules (one block,
  run_id line kept, bare agent name, per-session dedupe, main-session gaps not promised). The update
  flows enrich only targets: batches of about 10 fanned out to Haiku subagents by the caller, then
  `enrich merge`, a spot-check and `apply`. A revised SKILL.md re-enriches the whole concept
  through the same merge. The scribe skill no longer hand-stamps sig_seen/hash_seen. Committed in
  f9b7b6d and pushed; the 0.3.7 line went to maestro-0c, whose end-to-end check is the first live run.
- Deps friction (the user's, after updating to 0.3.7): the cache folder is named after the
  code-graph version, so every release needs `deps install` again from a terminal. Task 015
  (0.3.8): name it after PINNED_DEPS (`ts-morph@28.0.0`), also under $CLAUDE_PLUGIN_DATA/deps; no
  automatic download; one last reinstall after upgrading. Must work on macOS (the home .cache
  folder, no Library/Caches path).
- maestro-0c's end-to-end prep, checked in the code. First, maestro runs the update flows inside its
  scribe subagent, which can't launch 0.3.7's Haiku fan-out. Second, with nothing enriched,
  `enrich targets` lists every vertex (274 on claude-session-bridge). Third, `search --json` ignores
  --max-tokens (459 KB); the eval harness calls search() directly, so trimming is safe. The user
  chose 3 tasks, run in order after 015:
  - 016 (CLI, 0.3.9): `enrich targets --core`; core = vertices named in SKILL.md plus in-concept
    hubs with 3 or more inbound calls/mounts. gaps' 90% is measured over the core (all vertices
    when the core is empty). A thin core (50+ live vertices, fewer than 5 core) is reported.
  - 017 (skills, 0.3.10): a subagent enriches up to 20 targets inline; above that it reports them
    as "left to enrich". First touch uses --core. The main-session fan-out is unchanged.
  - 018 (0.3.11): search --json honours --max-tokens.
  maestro-0c gets the task numbers and versions now; its plugin cache is at 0.3.4.
- r013 (015 done, code-graph-a7, uncommitted): 0.3.8, 289 tests, eval 7/7. `depsKey()` = sorted
  `name@version` pairs joined with `+`, used under both the .cache and $CLAUDE_PLUGIN_DATA deps
  folders. Old deps/<version> folders are ignored (tested). A real deps status/install/extract run
  used a temp cache; checked here that the bundle searches deps/ts-morph@28.0.0. Not run on macOS.
  A scoped pin (`@scope/pkg`) would put a `/` in the key, which is harmless today because ts-morph
  is the only pin. 016 is unblocked. Committed in 1e0c9a6.
- r014 (016 done, code-graph-6b, uncommitted): 0.3.9, 306 tests, eval 7/7. New pure scribe/core.ts
  is shared by enrich and gaps. `enrich targets --core` --json gives core.size, leftOut, thin and
  message; gaps reports thinCores. Added to 017: the thin-core message says "SKILL.md names N" but
  gets the whole core size, and the scribe-pipeline skill map needs a core.ts row. Left on
  purpose: addCoreCounts is O(concepts x rows), negligible at 16 concepts. 017 is unblocked.
  Committed in fe54a57.
- r015 (017 done, code-graph-18, uncommitted): 0.3.10, 306 tests, eval 7/7, plugin validate green.
  The subagent path is in the scribe and both update skills: 20 or fewer targets are enriched
  inline, more give a "left to enrich" list. --core is used on first touch, and a thin core goes to
  update-single-concept-skill. The thin-core message was reworded and the scribe-pipeline map has
  its core.ts row. Post-mortem: the worker routed the task as Documentation (@scribe only), got
  HANDOFF: partial and had to dispatch @backend. That is the same scribe/source boundary as maestro
  ticket 108, so it's maestro's to handle, not a code-graph ticket. 018 is unblocked. The user had it
  added to 108 (still uncommitted in maestro), with a new criterion: the ticket named the code work
  and was still misrouted, so fix A alone doesn't cover it. 017 committed in 4c818ec.
- r016 (018 done, code-graph-bf): 0.3.11, 309 tests, eval 7/7. budgetSearchJson trims hits, then
  skill bodies, edges and vertex fields, and adds truncated + dropped. strength and gaps are always
  kept. Checked here: "design check" --json on this repo is ~3000 tokens with truncated:true.
  Also left open: budgets under ~405 tokens can't be met (documented), and the best hit is dropped
  at 600 tokens. Committed in 4cbc905 and pushed; the 0.3.8-0.3.11 ready line went to maestro-0c.
- Deferred ideas (the user agreed not to ticket them yet). Nothing reads query JSON today: the
  plugin skills and /graph use plain text, which is already budgeted, and maestro calls no
  code-graph query with --json. The 459 KB came from a hand-run query.
  1. --max-tokens on concept/impact/cross/vertex/file --json (query/run.ts prints raw JSON; each
     needs its own trim policy: cross is a bare array, impact is nested).
  2. Search JSON without duplication, so edges survive the budget. Every hit appears twice (hits
     and clusters[].hits) and gaps lists each concept in both `concepts` and `fixable`. At the
     default budget every edge is dropped. Fix: clusters refer to hit keys (a JSON shape change;
     eval calls search() directly, so it's unaffected).
  Ticket them if maestro's end-to-end check shows an agent, the scribe or maestro code reading
  query JSON, or plain-text search losing edges that matter to an answer. maestro-0c was asked to
  watch for both.
- This session is now code-graph-82 (set-manager done). maestro-cb (the cutover manager now) ran
  the end-to-end check of 0.3.11 and it passed. The inline core of 18 was enriched in a subagent.
  task-queue's core of 28 was deferred, then fanned out to 3 Haiku batches, and 6 spot-checks were
  correct. Edge reasons survive a re-extract, and search "blockedBy" went from 13th to 4th. Findings:
  (1) a plain-language search missed agents-view (before enrichment) even though its SKILL.md
  mentions avatar 15+ times; (2) no query JSON is read (the deferred ideas stay deferred), but
  `enrich targets --json` is 29 KB on task-queue; (3) the scribe's own SKILL.md edit grew the core
  from 18 to 22, past the inline limit; (4) the `"ast": {}` churn is one-time, nothing needed.
  Found here: plain `enrich targets` after the first touch lists every never-enriched vertex
  (enrich.ts:132), about 246 on task-queue, so laziness broke on the second run. The user chose:
  - 019 (CLI, 0.3.12): lazy by default (never-enriched, unchanged, non-core vertices are never
    targets), `--all`, and `--summary` with `--json --vertex` for each batch.
  - 020 (skills, 0.3.13, blocked by 019): a subagent enriches up to 20 targets (changed/stale,
    then named, then hubs) and lists the rest; the report says when the core grew; the
    whole-concept path covers enriched vertices plus the core.
  - (1): maestro-cb re-runs the search now that agents-view is enriched; ticket only if it still
    misses.
- maestro-cb's re-run: agents-view now comes first (18 vertices, ~1014 tokens) but only for the
  avatar half. The description half (agent-descriptions.ts, enriched) is missing. Not ticketed: a
  two-intent query under OR-BM25 ranks one intent's cluster, and a second search finds the other.
  Ticket it if it happens again on single-intent queries. Added to 019: inbound edges in plain-text
  search all print "← triggered by" whatever their type (search.ts:413); label them by type.
- maestro-cb confirmed the single-intent search ("how an agent's description is edited") hits
  agents-view first with the description code enriched. No ticket. setAgentDescription isn't in the
  core, so it's listed with no purpose; that's lazy enrichment working as designed. Idea, not
  ticketed: a search hit with no purpose is a natural enrichment signal, so retrieval could report
  it through the gap channel for update-single-concept-skill to enrich. Revisit if un-enriched hits
  keep showing up in answers.
- The user asked for it → task 021 (0.3.14, blocked by 020, same skills). Plain-text search marks
  hits with no purpose as not enriched. Retrieval appends one "enrich only" skill_gaps entry for
  the un-enriched hits its answer used (5 or fewer, deduped by skill and vertex, contract
  verbatim). update-single-concept-skill closes it by enriching the named vertices only: no SKILL.md
  edit, no stamp. Tell maestro-cb once 021 ships: the scribe will see "enrich only" gaps.
- Session renamed to manager-concept-skills-merge (set-manager).
- r017 (019, 0.3.12, not committed yet). Worker: 320/320 tests, `pnpm check` 6/6, eval 7/7.
  - Detection mechanism: `apply` stamps `agent.touched_at` on un-enriched vertices that are new or
    have a changed body, but never on a concept's first apply (`conceptWasApplied`). This is in
    apply.ts L273 and L462-476, verified.
  - `enrich targets` also counts these as touched: a vertex missing from the store, a hash mismatch,
    or a purpose-less `agent.stale` (for 0.3.11 stores).
  - `touched_at` stays until the vertex is enriched, so a target a subagent leaves out stays a target
    on the next run. 020's "leave the rest" relies on this.
  - Spot-check on scribe-pipeline: `--summary` lists 35 targets (core 17), 50 left out and 98 edges
    without a reason, one line per target.
  - Inbound labels come from `INBOUND_LABELS` (search.ts:73), verified.
  - Behaviour change: `--vertex` now narrows the output to the named vertices; it used to add them.
    The worker updated all three plugin skills.
  - Folded into 020: stamp `touched_at` on an approved rename of an un-enriched vertex
    (apply.ts ~434-456), and assert the exit codes in enrich.test.ts:353-355.
  - Left for the user: `just regraph` (ts-morph isn't loadable in the worker's sandbox, so the
    stored code-graph-search and scribe-pipeline doc vertices hold the old text). The root
    `pnpm test` ENOENT on /tmp/tsx-1000 is environmental.
  - Committed as 79a11a1 and the user ran `just regraph`, so 020 is ready. maestro's cutover manager
    (now manager-code-graph-merge) got the 0.3.12 changes. I asked for task-queue's target count if
    it re-runs the update flow.
  - manager-code-graph-merge ran `enrich targets --summary` with the 0.3.12 PATH CLI.
    - task-queue: 0 targets, core 28 (all enriched), 75 left out, 0 edges without a reason.
    - agents-view: 0 targets, core 18, 48 left out.
    - Lazy targeting holds in maestro. Its installed plugin is still 0.3.11 until the user updates it.
- r018 (020, 0.3.13, not committed yet). This session was down, so the report went to
  manager-code-graph-merge, which forwarded it without acking. I re-ran set-manager, acked it and
  recorded the worker.
  - Worker results: 321/321 tests, desktop 114/114, `pnpm check` green, eval 7/7.
  - Verified: the rename stamp at apply.ts:452. The three skills no longer say all-or-nothing or
    --core, and the gap-channel text is untouched in the scribe diff. Versions are in lockstep.
  - Not run: `claude plugin validate` (not on the sandbox PATH) and the scribe-pipeline regraph.
    Both are left to the user.
  - Not ticketed: tests for renaming an already-enriched vertex and for approving a rename without
    `--approve-drift` (optional, low value).
  - Not ours: "the scribe always ends with a routable `HANDOFF: success`". HANDOFF labels belong to
    maestro: its scribe agent (plugins/maestro/agents/scribe.md) has no HANDOFF rule, and the code-graph
    scribe skill stays maestro-neutral. maestro's 111 run hit the same NO ROUTE stop, so I passed it
    to manager-code-graph-merge to ticket in maestro.
  - The dotfile stubs at the repo root are sandbox artefacts. Never commit them.
  - The user committed 020 and ran `just regraph`. The stubs are now in this checkout's
    `.git/info/exclude`, and the setup-claude-guardrails skill (ai-dev-tools) learned to exclude them.
- r019 (021, 0.3.14, not committed yet). Acked.
  - Worker results: 325/325 tests, desktop 114/114, `pnpm check` and typecheck green, eval 7/7.
  - Verified: `formatSearch` ends a hit with no purpose in ` — _not enriched_` (search.ts:427), and
    `--json` is unchanged. code-graph-retrieval writes "enrich only" `skill_gaps` entries.
    update-single and scribe send an all-"enrich only" gap straight to the "Only a reported gap to
    close" branch, with no SKILL.md edit or stamp; a mixed gap runs the full pass. The scribe diff only
    adds text, so the gap-channel contract is untouched. Versions are 0.3.14 in lockstep.
  - Not run: `claude plugin validate` (not on the sandbox PATH). Left to the user.
  - Not ticketed:
    - `--vertex <name>` (scribe) vs `<key>` (update-single). Both work, and update-single already
      explains when to use a key.
    - turbo.json has no `globalPassThroughEnv` for TMPDIR, so root `pnpm test` fails in the
      sandbox (verified). It's dev environment, not epic scope; raised with the user.
    - The scribe's free-text HANDOFF line is maestro's 114.
  - manager-code-graph-merge: maestro needs no change for 0.3.14, because nothing there reads
    `missing`. Its task 112 counts an "enrich only" gap as handled after enrichment, with no stamp.
    I confirmed what the scribe report signals for such a gap:
    - It names update-single as the flow, with no changed skill and no new version.
    - Vertices past 20 appear under "left to enrich", and search re-surfaces them later.
    - A concept with no graph stops with nothing to enrich, and that also counts as handled.
