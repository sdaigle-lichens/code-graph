# Epic: absorb-concept-skills

## Goal

code-graph absorbs what maestro's `concept-skills` plugin does well (versioned, marker-stamped
concept SKILL.md files; create/update/scribe flows; install lifecycle; design skills), so maestro
can drop concept-skills and point its scribe and subagents at `code-graph:*` skills. Source plan:
`plan.md` at the repo root.

## Status: closed (2026-10-28)

Closed after 043 (committed in 6d685fa). Follow-up epic: `haiku-subagents-with-graph`, which
takes these findings as its starting point.

Findings from the measurement tickets (039, 041, 042, 043; details in `docs/evals.md`):
- **Opus 5.5, read-only questions on maestro:** neither the graph nor concept skills cut cost.
  Opus scores about 94% with Grep alone and re-checks a pasted graph answer (oracle +3%).
- **Haiku 5.5, same questions:**
  - nograph 91/108 (84%), oracle 108/108, graph plugin 107/108;
  - about 3% of Opus's cost;
  - Haiku loaded the retrieval skill and called the CLI in 14 of 14 runs.
- **What's left between the plugin and the oracle is cost, not accuracy:** +24% overall, +62% on
  cross-concept questions, where the CLI output is 10–15k chars.
- **Keep** the retrieval skill and its SessionStart hint; on Haiku they're the part that works.
- **Not yet measured:** edit-style work (tests, docs). maestro already runs scribe and test on
  Haiku.

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
- Committed: d161a48 (021, by the user/worker), cfc481d (bookkeeping), a1628e6 (maestro runtime
  0.11.27), 234c409 (README install line). Not pushed.
- maestro's request: a sandboxed session can't read `~/.cache/code-graph/deps`, so `extract`
  says "run deps install" even though ts-morph is installed.
  - Verified: `resolveDependency` uses `existsSync`, which is false for EACCES too. Sandboxed
    commands carry `SANDBOX_RUNTIME=1`. A denied home path may show as ENOENT, so errno alone isn't
    enough.
  - Ticketed as one task, 022 (0.3.15): sandbox-aware error and status text, plus the install skill
    offering a consented `sandbox.filesystem.allowRead` entry.
  - The user chose to keep `~/.cache` as the target. The plugin data dir is used only if the CLI can
    locate it from the user's shell through something Claude Code documents; guessing its internal
    layout is ruled out.
- 022 (0.3.15, not committed). Worker maestro-905d8964 finished before 022 was linked: I wrote the
  ticket without `maestro-epic link`, so `done` printed no report command. Linked it and recorded the
  worker afterwards. Always `link` a new ticket.
  - Worker results: 329/329 package tests, `pnpm check` green, eval 7/7.
  - Not run: `claude plugin validate`, and the step 7 consent flow end to end.
  - Verified:
    - `probeDepsDir` (project-deps.ts:56) counts EACCES/EPERM, or ENOENT under `SANDBOX_RUNTIME=1`,
      as unreadable.
    - The sandboxed error names `sandbox.filesystem.allowRead` and the absolute cache dir, and still
      says to run `deps install` in your own shell if it isn't installed anywhere.
    - The non-sandboxed text is unchanged, and versions are 0.3.15 in lockstep.
  - The install target stays `~/.cache`: Claude Code documents no way to find `CLAUDE_PLUGIN_DATA`
    from the user's shell, as the user decided.
  - Report r020 was filed late, after the link, and matches what I verified. Acked.
  - Recurring, both raised again:
    - The scribe's free-text HANDOFF line (`HANDOFF: scribe complete`) is maestro's 114.
    - Root `pnpm test` fails in the sandbox until turbo passes TMPDIR through.
- maestro's merge review (`~/gits/maestro/.claude/epics/code-graph-cutover/merge-review.md`, sent by
  manager-code-graph-merge with the user's approval). It reported regressions R1–R9.
  - R2 (the committed 491 KB bundle) is accepted: no task.
  - The user decided lazy enrichment is the intended steady state, so R1 is structural.
  - The reviewer's 8-task eval is copied to `maestro-eval-tasks.json` in this epic dir.
  - Verified in code before ticketing:
    - R1, a correction: SKILL.md text is indexed. `search_fts` covers `docs(body_md)` with
      `FTS_WEIGHTS` body_md 1.0 (name 3, purpose 2). The cause is ranking or expansion, not
      indexing, so 023 asks for a diagnosis first.
    - R3: confirmed. `graphFreshness` compares `.ast.json` with the store only.
    - R4: confirmed. `cli.ts` passes `gaps` as `extra`, which `budgetSearchJson` never trims. Scribe
      SKILL.md is 16 666 B.
    - R5: confirmed. `db.ts` imports `node:sqlite` statically behind lazy CLI imports.
    - The reviewer's ask that `deps status` report ENOENT as "absent" inside the sandbox would break
      the 0.3.15 case, because bubblewrap hides denied paths as ENOENT. 026 says "absent" only when
      the cache root is visible, and "not visible" otherwise.
    - R6: confirmed. The uninstall skill names none of the install-added artefacts.
    - R7: confirmed. `skill_gaps` appears only in markdown.
    - R8: `plugin/skills/CLAUDE.md` exists, added in 6ee80fe.
    - R9: confirmed. The retrieval skill still says it "spins up the enrichment subagent". The stale
      stamps are maestro's to fix.
  - Ticketed and linked:
    - 023 (0.3.16): R1 + R9 wording. Search ranking plus a `low_confidence` flag and a new exit code.
    - 024 (0.3.17): R3. Detects unextracted source changes by file hash, with no ts-morph in
      layer 1.
    - 025 (0.3.18): R4. Scribe enrichment moves to a reference file (≤ 9 KB), `gaps` is budgeted,
      and `skills status` gets a compact form. Blocked by 023.
    - 026 (0.3.19): R5 + R6. Node-sqlite exit code, three-way `deps status`, and an uninstall that
      lists install artefacts. Blocked by 023.
    - 027 (0.3.20): R7 + R8. Fixture at `plugin/contracts/skill-gaps.example.json`, and the rules file
      moves to `.claude/rules/`. Blocked by 025.
  - `maestro-epic link` doesn't re-parse `## Blocked by`, so I set `blockedBy` in `status.json` by
    hand.
  - Versions are a plan only: each task takes the next free patch if another ships first.
- 023 (0.3.16, not committed): worker maestro-5b4ae740, report r021. Acked, worker recorded.
  - Cause found: `unicode61` doesn't split camelCase, so `parseGapsHandled` was the single token
    `parsegapshandled`. Enriched purposes also crowded the 10 seeds. The fix indexes names plus
    their words (`nameIndexText`); `FTS_WEIGHTS` is unchanged. Low confidence uses exit 7,
    `low_confidence` in JSON and a fallback line. Exact symbol hits and docs-only concepts are
    exempt.
  - Worker results: maestro eval 2/8 → 7/8. `ma-design-check` still fails because nothing ties
    "design check" to `seedSkillsFor`.
  - Verified by me: 364/364 package tests, `just eval` 7/7. Ran four queries against maestro's
    store: gap-ack, install-runtime and fork now surface the right concept and vertex, all with
    exit 7 and the fallback line. "design check" lands in log-view and is flagged low.
  - Not run: `claude plugin validate` (no `claude` on PATH in the sandbox; the user runs it).
  - Gap found: a store indexed before 0.3.16 keeps its old FTS rows until `reindex`/`apply`, and
    nothing says so. Added as item 4 to 025: an FTS format stamp, and search reindexes once.
  - Unrelated in the worktree: a maestro runtime update to 0.12.2 (`.claude/scripts/*`,
    `settings.json` hooks for `maestro-session-name.cjs`, `maestro.json`). Kept out of the 023
    commit.
- manager-code-graph-merge acked 0.3.16, 023–027 and both corrections.
  - No maestro hook maps search exit codes, so exit 7 needs no change there.
  - maestro's own tasks: R6 install command is 115; R9 re-stamp and the "design check" keyword are
    in 116 (needs 0.3.16 + `reindex`). Uninstalling concept-skills@maestro is the user's.
  - Flagged back: 116's "exits 0" criterion can't pass while maestro-architecture is un-enriched,
    because 0.3.16 exits 7 for an under-enriched top concept unless the hit is an exact symbol name.
  - They are waiting on 027 for the R7 fixture path.
  - Resolved: 116 now reads "`seedSkillsFor` in the top 5, exit 0 or 7". There's no enrichment to
    reach 50%, because lazy enrichment is the steady state.
- 023 committed as e47e776 (not by me).
- 024 (0.3.17, not committed): worker maestro-898f8113, report r022. Acked, worker recorded.
  - `extract` records a sha256 per code file in `.ast.json` `meta.files`. `scribe/unextracted.ts`
    (fs/crypto/minimatch only) rescans and reports `unextracted: { changed, new, removed }` in files,
    in `skills status` and `drift`. The update flows extract + apply when it's non-zero. Layer 1 is
    guarded by `skills/unextracted-imports.test.ts`.
  - Verified by me:
    - 377/377 package tests and `just eval` 7/7.
    - I ran the pending extract + apply for scribe-pipeline and concept-skills-layer (ts-morph
      resolves from this repo's own install); the new ast.json has `meta.files`.
    - End to end, a throwaway new file under `src/scribe/` showed as "1 new" in both `skills status`
      and `drift` (with the extract + apply hint). Deleted afterwards.
  - Known limits from the reviewer, accepted for now: `SKIP_DIRS` is hard-coded (a concept globbing
    `dist`/`build` isn't scanned), and every status call hashes every matched file.
  - An ast.json written before 0.3.17 reports no `unextracted` until its next extract. Consumers with
    committed ast.json see each one change once.
  - Root `pnpm test` through turbo still fails in the sandbox (TMPDIR). The worker also saw 4 failures
    with `--env-mode=loose` that it calls sandbox-only; I haven't checked them. The turbo
    `globalPassThroughEnv` fix is still the user's call.
  - maestro's 116 now needs 0.3.17 and extracts and applies every concept. I corrected its check:
    docs-only ast.json carries no `meta.files` by design (`extractDocsOnly`; confirmed on
    concept-skills-layer), and stamped-only skills with no `concepts` entry get no ast.json.
    Suggested: `meta.files` only where vertices > 0. Accepted: 116 now uses that wording, and checks
    marked skills with no `concepts` entry only through their git window.
- 025 (0.3.18): worker maestro-27239325, report r023. Acked, worker recorded. It was built in the
  worktree `../code-graph-task-025` (branch `task-025`, from e47e776), uncommitted.
  - Built: scribe SKILL.md 16 666 → 8 958 B, with the procedure in `scribe/enrichment.md`; `gaps`
    compacted and trimmed before hits, with `dropped.gaps` and a floor of ~150 tokens;
    `skills status --summary`; `FTS_FORMAT=2` in a meta table, so search reindexes once.
  - Verified by me in the worktree: 383/383, scribe 8 958 B, gap-contract text unchanged.
  - Findings, not ticketed yet:
    - a truly read-only `graph.db` fails earlier, in `bootstrapStore` (same on HEAD), so the reindex
      hint only shows on lock/busy;
    - "unwritable" is also returned on a busy lock.
  - Blocker: it overlaps the uncommitted 024 in skills/commands.ts, report.ts, the update skill,
    usage.md, CLAUDE.md, the versions and the bundle. The order is to commit 024, then the worker
    rebases task-025, keeps `unextracted` in `--summary`, and regenerates the bundle. Told the worker
    to hold.
  - Lesson: a worker in a separate worktree branches from HEAD and misses uncommitted sibling work.
    Commit each finished task before the next one starts.
  - Unblocked: 024 + bookkeeping committed as b12e082, then maestro runtime 0.12.2 as 824165f
    (user-approved, two commits). Told maestro-27239325 to rebase task-025 onto the branch, keep
    `unextracted` in `--summary`, regenerate the bundle at 0.3.18, re-run tests/check/eval and
    report back without committing.
  - Rebased onto 824165f (stash/reset/pop; stash@{0} "task-025-wip" kept). `summarizeStatus` carries
    `unextracted` as counts only. Re-verified by me in the worktree: 396/396, `pnpm check` 6/6,
    `just eval` 7/7, bundle reproducible (no diff after `pnpm bundle`), scribe 8 958 B.
  - Landed (user-approved) as 90f7b24 on task-025, branch fast-forwarded. `git merge --ff-only` hit the
    sandbox on `.claude/skills/*` (read-only), so the ref was moved with `update-ref` + `reset --mixed`
    and the three skill files written with Edit; tree verified equal to task-025.
  - Doc nit, not fixed: concept-skills-layer's `--summary` line omits the optional `unextracted` counts.
  - maestro ack: 116 now requires 0.3.18 and drops the manual reindex (only on the lock/busy hint);
    the enrichment move has no maestro impact. Waiting on 027's fixture path.
- 026 (0.3.19): worker maestro-fef84d2f, report r024. Acked, worker recorded. Built uncommitted in the
  main checkout.
  - Built: `sqlite-guard.ts` + one commander preAction hook (`STORE_COMMANDS`) exit 8 with one line
    naming Node >=22.5; `deps status` gains `not-visible` (sandboxed ENOENT where neither the cache root
    nor its parent lists); uninstall skill lists each artefact, one consent per item, default no.
  - Verified by me: 435/435, `pnpm check` 6/6, `just eval` 7/7, bundle a cache hit (reproducible).
    `node --no-experimental-sqlite code-graph.cjs status` exits 8 with the fix line; `skills list`
    still works without sqlite.
  - Worker reports `claude plugin validate` and full `pnpm test` passed outside the sandbox (user-run).
  - Overlap: 027 is in progress in `../code-graph-task-027` from e6c35b8 (already at 0.3.20) and lacks
    026; it touches the version files and the bundle. Commit 026, then 027 rebases.
  - Landed (user-approved) as e876d55. Asked maestro-195f90c4 (presumed 027 worker) to rebase.
  - maestro ack: maestro never runs `deps status` or maps code-graph exit codes, so exit 8 and
    `not-visible` need no maestro change. Still waiting on 027's fixture path.
- 027 (0.3.20): worker maestro-195f90c4, interim note (no report yet). Rebased onto e876d55: 440/440,
  check green, eval 7/7; fixture `plugin/contracts/skill-gaps.example.json`. Reviewer/scribe pending,
  so not landed. The worktree also has a turbo.json `globalPassThroughEnv: ["TMPDIR"]` change, out of
  scope: kept out of the 027 commit, user decision pending.
  - Report r025 acked, worker recorded. Built: `plugin/contracts/skill-gaps.{example,schema}.json`;
    `gap-contract.test.ts` parses the skill_gaps examples in scribe + retrieval SKILL.md against the
    fixture; scribe says how gaps arrive without maestro; `plugin/skills/CLAUDE.md` moved to
    `.claude/rules/plugin-skills.md` (paths `plugin/skills/**`); `check-plugin-clean.mjs` in `pnpm check`.
  - Verified by me in the worktree: 440/440, `pnpm check` 6/6 (incl. check-plugin-clean), `just eval`
    7/7; bundle rebuilt differs from e876d55 only in the version string. Contract path/format unchanged.
  - Follow-up suggested by the worker: a test for check-plugin-clean's exit code.
  - Landed (user-approved) as 82a46ab, plus turbo.json `globalPassThroughEnv: ["TMPDIR"]` as its own
    commit 5b19298 (user chose a separate commit); branch fast-forwarded cleanly. Fixture path sent to
    manager-code-graph-merge. All tickets 003-027 done.
  - maestro ack: R7 is maestro task 117. It vendors `skill-gaps.{example,schema}.json` (source path +
    0.3.20 noted) into maestro's test fixtures, no cross-repo reads. **Standing obligation:** any change
    to the gap-file contract must be sent to maestro's manager so the fixtures get re-copied.
- 028 (0.3.21) ticketed from maestro's request (task 116 / maestro r010): sandboxed `skills stamp`
  hit EROFS on `.claude/skills/**` and the scribe hand-set the markers. Verified: stamp is one skill
  per call, and the write error goes to `die()` (exit 1), losing the computed values. Rescoped from
  "stamp what it can": the batch form doesn't exist; per call, print the exact lines and exit 9. Adds
  `--print`; the flow skills apply the lines with Edit and confirm with `skills status`. Not blocked.
  - maestro ack: accepts the per-call design with exit 9. Maestro never runs `skills stamp` and never
    maps its exit codes, so it needs no change. Notify when 0.3.21 ships.
- 029 (0.3.22) ticketed from maestro's request (task 116 follow-up, user-approved per maestro): make
  "stamp only" a checked decision. The scribe stamped 13 concepts without reading them against the
  changed code. Verified: `gitWindow` already puts `filesChanged` (names only) in `status --json`;
  the text view shows counts only; there is no `status <skill>` form and no per-file commit counts;
  `stamp` checks nothing. Scope: `skills status <skill>` with per-file counts; `stamp` warns (never
  refuses) when mapped files changed but SKILL.md didn't (committed or uncommitted), and `--reviewed`
  suppresses it; the flows need a one-line reason per stamp-only. Blocked by 028 (same stamp action,
  flow skills and usage.md); one worker can take both in sequence.
  - 028 report r026 acked; worker maestro-6dfd54fc recorded. The worker built in the main tree (no
    worktree). Delivered: `planStamp` (compute) and `isWriteBlocked`; stamp exits 9 with the exact lines
    (`--json` gives `written:false, blocked`); `--print`; four flow skills; usage.md, CLAUDE.md and
    concept-skills-layer docs; 0.3.21.
  - My fix: `EXIT_STAMP_NOT_WRITTEN` was declared between imports; moved below them and rebuilt.
  - Verified by me: build plus bundle, 446/446, `pnpm check` 6/6, `just eval` 7/7; skill diffs read.
  - Open nits: the scribe SKILL.md is 9058 B (target ~8958, under the 9216 cap); exit 9 on a CRLF
    SKILL.md is untested. `claude plugin validate` is for the user to run. No contract change.
- 030 ticketed from a maestro bug report: a bare repo-level `skills stamp` wrote 1.0 over 1.30.
  Verified: the repo-level branch falls back to `opts.bump ?? "initial"`, and `nextVersion(_, "initial")`
  is always 1.0. The per-skill form is already safe: a marked skill dies without `--bump`, and an
  unmarked one correctly gets 1.0. Fix: with an existing version, refuse instead of defaulting to minor.
  Docs to update in five places. Blocked by 028 (same action, uncommitted). Maestro restored its file.
  - 028 landed (user-approved) as 55a23a7 (0.3.21); maestro notified. The CRLF exit-9 test from 028's
    review was folded into 030. `claude plugin validate` is now excluded from the sandbox (the user
    asked; edit in settings.local.json), so I run it myself. It passes; directory-only notes say the
    LICENSE and icon are missing, user's call.
  - 030 report r027 acked; worker maestro-8cdc5b46 recorded. Built in the main tree: a guard in the
    repo-level stamp branch (exit 1 naming the current version and the `--bump` options), the five docs
    now say "refuses", tests for both sources, the first stamp, the explicit reset, never-decrease at
    both levels, and the CRLF exit-9/`--print` case. 0.3.22.
  - Verified by me: build (bundle identical to the worker's), 458/458, `pnpm check` 6/6, `just eval`
    7/7, `claude plugin validate` passed. Diff read: minimal, correct.
- Contract rule (maestro request, user-approved here): `.claude/rules/plugin-skills.md` now requires
  any `plugin/contracts/` change to be called out in that version's release note to maestro, with the
  old and new shape. A breaking change keeps accepting the old shape for one version.
- 030 landed as 7011b96 (0.3.22) plus bc663f7 (records), committed outside this session; maestro notified.
- 029 report r028 acked; worker maestro-61c322e9 recorded. Built in the main tree on top of 030, as 0.3.23:
  - `skills status [skill]` with `filesChangedCounts` (one `git log --name-only` pass) and, in the
    single-skill form, `filesUnchanged`; the text list is capped at 10, then `+N more`;
  - `blindStampWarning`: mapped files changed while SKILL.md was untouched in the window and in the
    working tree; changed `version:`/`last-update:` lines don't count as an edit. It writes to stderr
    plus `warning` in the JSON, `--reviewed` suppresses it, and it rides along with exit 9;
  - the update flows require the file list and a one-line reason per stamp-only; scribe has one line.
  - Verified by me: build, 470/470, `pnpm check` 6/6, `just eval` 7/7, `claude plugin validate` passed;
    code and skill diffs read.
  - Open nits:
    - the marker-line filter matches `version:` anywhere in the file, not only in `metadata:`;
    - a stamp commit that adds a whole new SKILL.md counts as an edit once, so there is no warning on
      the first re-stamp after creation;
    - the `+N more` cap is untested;
    - scribe SKILL.md is 9090 B (cap 9216).
    None blocks.
  - Follow-up sent to the worker (user-approved), done in the same tree:
    - `blindStampWarning` now compares the SKILL.md at `last-update` against HEAD, stripping only the
      `version`/`last-update` lines inside the frontmatter `metadata:` block. A body `version:` counts
      as an edit, and so does an added or removed SKILL.md;
    - tests for both the marker filter and the `+N more` caps;
    - usage.md states the first-re-stamp-after-creation limit.
    Verified by me: build, 474/474, `pnpm check` 6/6, `just eval` 7/7, `claude plugin validate` passed.
    Size left as is.
  - Landed as bc86d8c (0.3.23); maestro notified. All tickets 003-030 done.
- Maestro's second merge review (0.3.23): R1, R3-R5 and R7-R9 verified fixed. Search eval is 8/8,
  scribe load 17.7 KB, `--max-tokens 400` = 835 B, vendored contract files byte-identical. R2 (bundle)
  accepted but growing: 503 KB, 29 blobs, 14 MB raw in history.
  - N2 → ticket 031. `skills status <skill>` contradicts itself: its list is git since the stamp, its
    header is working tree vs. extract. `UnextractedChanges.files` already has the per-file kinds;
    the list never reads it.
  - N3 (`--summary` without `--json` prints JSON): not ticketed. Both `--help` ("implies --json") and
    usage.md say so. Unlike `enrich targets --summary`, which has a text form, but the flows read the
    JSON.
  - maestro ack: 031 is fine as scoped and `--summary` stays as is. Maestro's manager is asking the user
    about a bundle size budget and will come back only if they want one.
- r029 (maestro-a22a5a6e) → 031 done, uncommitted, 0.3.24:
  - The text view of `skills status <skill>` and the full view label the git list
    `since stamp <sha8> (git):`. They add an `unextracted (working tree vs last extract):` section with
    changed/new/removed, capped at 10 with `+N more`.
  - Decision: those paths are dropped from the text `unchanged` list, and the JSON `filesUnchanged`
    stays the raw git list. `unextracted.files` was already emitted in the single-skill and full
    `--json`, and `--summary` is unchanged.
  - Three new tests: the reviewer's repro (including the json/full/summary forms), the cap of 10, and
    the case with no ast.json. docs/usage.md and concept-skills-layer were updated.
  - Not tested: the text `removed` row (judged immaterial).
  - Verified by me: build (bundle stable), 480/480, `pnpm check` 6/6, `just eval` 7/7, `claude plugin
    validate` passed (with the known LICENSE/icon directory notes).
  - Landed as 4197383 (0.3.24), bookkeeping b7b64d3. Maestro acked: nothing changes on its side (it
    doesn't parse `skills status` output, and the contracts are untouched). All tickets 003-031 done.
- Maestro's manager handed over a `claude plugin eval` suite for code-graph-retrieval, which the user
  wants. A free-standing `plugin-eval` session did step 0 and was then closed. It had been started in
  `plugin/`, which created `plugin/.claude/.cc-writes` and broke check-plugin-clean; I deleted it after
  checking it held only that file.
  - Answered from code: `apply` loads no ts-morph and needs no tsconfig, only node:sqlite; it
    validates the .ast.json with `AstDocSchema.parse`. So the fixture commits .ast.json files made by a
    real `extract`, and setup runs only `apply`.
  - Pre-staged, uncommitted (user-approved): version 0.3.25 in all three files, bundle rebuilt;
    `.gitignore` gains `**/evals/results/`, `!plugin/evals/**/scribe-output/` and
    `plugin/evals/**/scribe-output/graph.db*`.
  - Ticket 032: the eval suite as a worker, picking up at interview step 1. The user answers the
    interview's gates; I review against the code.
  - 032 setup confirmed: `case.yaml` with `context.scaffold_script` (with `--scaffold`, 120 s, as the
    user) beside `prompt.md` + `graders/*.md`. Runs need `--allow-tools Bash` in both arms.
  - 032 pilot (2 runs, 7 cases, ~$1.86): all pass, Δ 0. The retrieval skill never fired: 0 Skill and 0
    Bash calls in every with-plugin run.
    - The fresh graph has no cross-concept edges, confirmed in code: `buildEdges` sets
      `crosses_concept: false`, so `impact` misses callers in other concepts and `cross` exits 6.
    - Every search exits 7 (fixture un-enriched).
  - The user chose (b): 032 finishes as the harness, with the pilot as the before baseline.
    - 033: make the skill trigger, measured with a 032 pilot. Blocked by 032.
    - 034: record cross-concept calls at extract, then the user runs the full suite. Blocked by 033
      (shared tree/version).
    - The user agreed the 032 fixture ships `enriched.json`, made with real `enrich merge`. 034 checks
      it with `enrich targets` after re-extracting.
    - Decision: no automatic enrichment at query time. It would turn a read-only question into
      scribe work and file writes; exit 7 already falls back to grep or SKILL.md, and gaps are reported.
      034 adds an enriched vs un-enriched pilot, to decide whether setup-time enrichment is worth a ticket.
- r030 (absorb-concept-skills-032) → 032 done as the harness, uncommitted, 0.3.25:
  - The suite is `plugin/evals/`: 7 cases, a 3-concept task-board fixture, `.ast.json` from a real
    `extract` and `.enriched.json` from a real `enrich merge`.
  - `scaffold-lib.sh` copies the fixture and runs only `apply`, failing fast without node:sqlite. The plugin
    root is derived from the script's path, because `CLAUDE_PLUGIN_ROOT` is empty in the scaffold.
  - New `docs/evals.md` and a README index line.
  - Pilot command: `claude plugin eval . --eval-dir plugin/evals --scaffold --allow-tools Bash
    --judge-model sonnet --ablation with-without --no-publish --trust-plugin --runs 1 --max-cost-usd 5`
  - Baseline (enriched, 1 run): 7/7 pass, Δ +0.21 (noise). Skill fired only in neg-no-config, the case
    where it shouldn't; 0 Bash calls anywhere. That goes to 033.
  - Verified by me: `pnpm check`, typecheck, `just eval` 7/7, `claude plugin validate` passed. The
    fixture `.ast.json` is current (`skills status --summary`: 0 unextracted). This repo's concept
    globs don't reach `plugin/evals/`, and `plugin/evals/results/` is ignored.
- r031 (absorb-concept-skills-033) → 033 implemented, uncommitted, 0.3.26; the pilot criterion is still open:
  - Cause, from the 032 traces: the agent's first call is Grep or `git ls-files`, and it never checks the
    skill list. Runs that saw `scribe.config.json` read `skills/<concept>/SKILL.md` directly.
  - Fix: the retrieval description now leads with the question shapes and the config signal. A new
    SessionStart hook, `plugin/hooks/graph-context.cjs`, adds one `additionalContext` line only when
    `scribe.config.json` is in the cwd. It always exits 0, writes nothing and never calls the CLI.
    `graph-context-hook.test.ts` guards that, and `.claude/rules/plugin-skills.md` records the rule.
  - Verified by me: `pnpm check`, 483/483 tests, `just eval` 7/7, `claude plugin validate` passed
    (still only the LICENSE and icon notes).
  - Not met: the user-run 2-run pilot (Skill and Bash counts per case vs the 0/7 baseline, and
    06-neg-no-config) hasn't been run.
  - Finding: some Bash calls inside eval sessions fail with
    `apply-seccomp: write /proc/self/setgroups (nested userns ...)`. The eval sandbox can't run the
    CLI, so Bash counts may stay at 0 whatever the wording says. 034's measurements depend on that too.
- r032 (absorb-concept-skills-033) → 033's pilot criterion met (user-run, 2 runs per arm, $4.09, 755 s):
  - Skill: 2/2 in smoke, impact, cross-store and locate (baseline 0). Bash CLI: 1 per run, except
    cross-store with 0 (the 034 gap). Both negatives pass without the skill firing.
  - The seccomp errors didn't block Bash.
  - Every case scores 1.00 in both arms (Δ 0.00), so the suite shows the skill fires, not that it helps.
    034's full run needs cases that separate the arms (impact and cross after the edge fix). A case
    or grader change would need its own ticket.
  - 06's `says-no-graph` grader fails every judge vote despite correct behaviour. It isn't scored;
    left as a finding.
  - I checked the result file (`plugin/evals/results/2026-10-26T00-10-42-208Z`): $4.09, 755 s, 7 cases,
    not partial. The table is in `docs/evals.md`.
- 0.3.26 committed (ec90f21). Maestro's manager acked it and checked the hook against its constraint.
  Their limit: SessionStart context reaches only the main session, so subagents (maestro's builders) get
  only the skill description. A future pilot run through a subagent is the case to check.
- r033 (absorb-concept-skills-034) → 034 done, uncommitted, 0.3.27:
  - `extract` emits edges into other concepts' vertices (`makeForeignResolver`, deterministic `vKey`,
    no read of their ast.json) with `crosses_concept: true`. `apply` keeps that flag.
  - A file matched by several concepts belongs to the first in config order, excluding the concept
    being extracted. Docs-only concepts are skipped.
  - Behaviour change: `oneHop`, `twoHops`, `oneHopAnyTable`, `queryCross` and `queryConcept` now require
    the far vertex to be live, so edges to archived or not-yet-applied vertices are hidden everywhere.
  - Fixture `.ast.json` x3 re-extracted. `.enriched.json` unchanged (`enrich targets`: 0 stale).
  - Verified by me: `pnpm check`, 492/492 tests, `just eval` 7/7, `claude plugin validate` passed. On a
    temp copy of the fixture with board-ui applied alone, `query cross board-ui task-store` exits 6
    with a "not built" note, without crashing. After all three concepts are applied,
    `impact moveTask --direction in` lists notifyOverdue and useDragReorder, and both crosses exit 0
    (2 and 4 edges).
  - Pilot (user-run): enriched, 3 runs, $6.19; un-enriched, 2 runs, $4.05. Every case 1.00 in both arms
    of both pilots. cross-store-reminders fires the skill but never runs the CLI, even with the edges.
    The plugin costs about 27% more overall (about 35% more in positive cases) with no accuracy gain.
  - Partly met: the on/off comparison lacks search exit codes (traces deleted), and nothing
    confirms the no-enrichment switch took effect. The worker's recommendation (don't prioritize
    setup-time enrichment) therefore rests on weak evidence. The switch has been removed.
  - Open question: the suite can't show whether code-graph saves cost (fixture too small, only final
    answers graded). The worker proposes a benchmark ticket on a realistic repo, with
    cost/turns/tokens/reads metrics, `--keep-temp` traces, exit codes and an enrichment on/off arm.
- 0.3.27 committed by the user (9aa13af); maestro's manager told about the one-time `.ast.json` rewrite.
- Ticket 035, benchmark whether code-graph saves cost on maestro. Decisions with the user:
  - Target: maestro at a pinned sha (read only), not this repo. It is bigger, already graphed, and the
    consumer this epic serves. Bench files live in `evals/bench-maestro/`, outside `plugin/`.
  - Staged to keep cost down. Stage 0 is an offline proxy (graph output vs scripted Grep, $0).
    Stage 1 is a user-run 2-run pilot capped at $8, on the questions that survive stage 0.
  - Stage 1 arms: concept skills alone vs concept skills plus graph; no plain-Grep arm.
  - Deterministic graders; the agent model is checked. Enrichment and extra runs go to stage 2, which
    the user decides after stage 1.
  - Also in 035: fix the `says-no-graph` grader, and document that subagents don't get the SessionStart line.
- Maestro re-extracted its 16 concepts with 0.3.27 (uncommitted there, awaiting the user): every file
  gained cross-concept edges, no vertex contentHash changed, and apply shows 0 new/changed/missing.
- Maestro's manager's input to 035, forwarded to the worker:
  - Model: benchmark Opus 5.5 first (builders and reviewer inherit it). Haiku 5.5 (test, scribe) is an
    optional second arm.
  - Seven real lookup questions from maestro tasks 121–124.
  - The worker may pin maestro's re-extract commit instead of b323aa7, if the user commits it first.
- r034 (absorb-concept-skills-035) → 035 built up to the user-run Stage 1, uncommitted, 0.3.28:
  - Stage 0 (b323aa7, un-enriched, tokens = chars/4): Grep reached the full answer on all 8 questions,
    graph output alone on none. Search exits 7 almost everywhere (nothing enriched). The graph was
    cheaper only on q5 (205 vs 2887 tokens) and covered 1/4 of that answer.
  - The user kept q2, q5 and q6 as graph candidates and q3 and q8 as Grep-wins controls. Dropped q1, q4
    and q7 (no graph hits, or outside every concept). Snapshot stays at b323aa7.
  - The skills arm ships maestro's 16 concept skills as a generated bench plugin
    (`evals/bench-maestro`), since eval workspaces don't load project `.claude/skills`.
  - Also done: the `says-no-graph` grader is a regex check now, the subagent limit is in `docs/evals.md`,
    and the version is bumped. Worker ran `pnpm check`, 492/492 package tests and `just eval` 7/7.
  - Verified by me: `claude plugin validate plugin` passes, and `projectOwnsHook` exists at b323aa7
    (`hook-arbitration.ts:126`), so maestro's manager's correction was wrong and q2 stays.
  - Blocker found by me: `claude plugin validate evals/bench-maestro` fails. Maestro's own
    `apps/maestro/.claude/skills/agents-view/SKILL.md` at b323aa7 has invalid YAML frontmatter (an
    unescaped `"Copy into the project"` inside a double-quoted description). `make-suite.mjs` copies it
    byte for byte, so that skill would load without a description and skew the skills arm. Stage 1
    waits until the generator repairs it and the bench plugin validates. The bug is maestro's too.
  - Regression from 034, missed by me (I ran only the package tests):
    `apps/desktop/test/graph-canvas-real-store.test.ts` expects 1 skipped edge and gets 23, because the
    local store now holds cross-concept edges. Proposed as ticket 036.
  - Maestro's dirty tree (16 `.ast.json`, graph.db, its EPIC.md) is its manager's 0.3.27 re-extract, as expected.
  - Open: `metrics.mjs` is untested on a real trace, and the eval frontmatter keys come from the docs.
- Maestro's manager confirmed both findings. They fixed agents-view on their side (escaped quotes, stamped
  1.16, uncommitted) and withdrew the `projectOwnsHook` correction. The bench still reads b323aa7, so
  the generator repair is still needed.
- 035 worker repaired it: `make-suite.mjs` `repairFrontmatter()` re-emits a broken one-line quoted value
  as a `>-` block scalar. Only agents-view changed; the other 15 skills are byte-identical, and a rerun
  gives the same output. I ran `claude plugin validate evals/bench-maestro` and it passes (warnings
  only: author, license, icon). Stage 1 is unblocked and up to the user.
- Stage 1 ran (user-run, $4.96, Opus 5.5, 2 runs): correctness 1.00 in both arms, graph arm +10% cost.
  The worker's verdict was "no saving", with five ranked levers in `docs/evals.md`.
  **Invalid, found by me:** the `1,1` exits are failures. Every Bash call in the traces I checked
  failed on `apply-seccomp: ... nested userns is capability-restricted`, so the graph arm never got
  any code-graph output and the run measured only the retrieval skill's overhead. Still valid: q3 and
  q6 show the skill fires even when concept skills already locate the answer (lever 1). The worker is
  rewriting the verdict, flagging seccomp failures in `metrics.mjs`, and finding a way to run eval Bash
  without the nested sandbox before any rerun.
- The user set 035 aside ("I don't like where the session of 035 went"). Its 0.3.28 changes stay
  uncommitted in the tree, and the worker session is gone. No rerun is planned.
- Ticket 036: fix the desktop canvas test, taking the expected skipped count from the store (describes
  plus cross-concept and non-live endpoints). Test only, no canvas change and no version bump. Drawing
  cross-concept edges on the canvas is out of scope. Linked to the epic.
- 035 cleanup, with the user: kept its findings (a "Maestro benchmark findings" section in
  `docs/evals.md`) and the `says-no-graph` regex grader. Dropped `evals/bench-maestro/`, the 0.3.28 bump
  and its bundle (reverted to 0.3.27, bundle regenerated, identical), and the README/.gitignore lines.
  The 0.3.28 version number is free again.
- Ticket 037: stop `code-graph-retrieval` loading when a loaded concept skill already locates the answer
  (the one valid 035 result), and measure the plugin's fixed per-session size offline. It includes a
  new eval case and a user pilot capped at $5, with a seccomp check. 0.3.28. Blocked by 036.
- Committed by me at the user's request: 696789c (035 cleanup, tickets 036 and 037, bookkeeping).
- r035 (absorb-concept-skills-036) → 036 done, uncommitted, test only (no version bump):
  - `truth()` now counts skipped edges from the store: endpoints that are neither a live vertex of the
    concept nor its doc, plus how many of them cross concepts.
  - `l.skipped` is asserted against that count, and the `describes` assertions are kept.
  - A new test needs at least one skipped cross-concept edge and points to `just regraph` if the store
    has none.
  - Verified by me: the desktop file passes uncached (7/7), and `pnpm test --force` from the root is
    green.
  - Note: the test depends on the local gitignored graph.db, as before.
- 036 committed by me at the user's request (f35d141). 037 is running.
- Diagnosis given to the user: there's no evidence yet that the graph saves cost. There is a consistent
  fixed overhead, and the graph's possible strength (impact and cross on a big repo, with working Bash)
  was never measured.
- Tickets 038 and 039, with the user (who chose `claude -p` over the eval harness for step 2):
  - 038 is a small `bench/` runner on `claude -p`. The user starts it from a plain terminal, so the
    sandbox isn't nested. It uses the user's normal login, checks plugin isolation from the init event,
    and marks runs with a Bash failure invalid. The check costs under $1, on the fixture's impact
    question. No plugin change and no version bump. Blocked by 036 (done), so it can run beside 037.
  - 039 measures 4 or 5 impact and cross questions on maestro at a pinned sha. Both arms use maestro's
    real `.claude/skills`; the graph arm adds code-graph. The question set goes through an offline proxy
    and the user's approval, then a paid run of 2 runs per arm, capped at $6. A plain verdict follows;
    the user decides whether to add enrichment or Haiku. Blocked by 037 and 038.
- r036 (absorb-concept-skills-037) → 037 done, uncommitted, 0.3.28:
  - The retrieval skill's description and "When NOT to use" now skip the skill when a loaded concept
    skill already names the file or symbol. It stays for impact, cross and unknown-location questions.
    The SessionStart line has the same qualifier, and the hook stays inert.
  - New eval case `plugin/evals/08-skill-has-answer`: prompt.md quotes the reminders concept skill, and
    an LLM grader checks the answer is `isOverdue` in `src/reminders/overdue.ts`. A display-only
    `skill-fired` grader is included, so whether the skill stayed out is read from the trace.
  - Offline sizes (chars/4): description 130 → 127, body 2422 → 2485, SessionStart line 51 → 65.
  - Verified by me: `pnpm check` green (versions in lockstep at 0.3.28), `pnpm test --force` green,
    `just eval` 7/7, `claude plugin validate plugin` passes. Its only directory-profile findings are
    the missing LICENSE and icon, which predate this ticket.
  - Not done: the user-run pilot (2 runs, cap $5). `docs/evals.md` has a PENDING block for it.
  - Risk: "Use before Grep or Read" (with "first" dropped) may make smoke and locate load the skill
    less often; the pilot must confirm.
  - Possible follow-up: split the SKILL.md body (about 1k tokens, unmeasured).
- 037 pilot (user-run, 2 runs per arm, $4.47), written into `docs/evals.md`:
  - Bash failed with seccomp again, even from a plain terminal: `claude plugin eval` nests the sandbox
    itself. CLI and cost columns are invalid. The 0.3.26 and 0.3.27 Bash columns are suspect too.
    This confirms 038 is needed.
  - Skill loading came out as intended: case 08 loaded it 0/2 times ($0.081 against $0.077, about +4%,
    down from +34–51%). The four positive cases still loaded it 2/2, so the risk from dropping "first"
    did not show.
  - The plugin arm still costs about 28% more overall.
  - The two failures (impact run 2, neg-literal run 1) come from strict graders and a reworded answer,
    not from the plugin.
- 037 committed by me at the user's request (c4267f6), together with tickets 038 and 039 and the
  bookkeeping. The maestro runtime files stay out of the commit. `manager-code-graph-merge` was told
  about 0.3.28.
- Ticket 040, with the user: loosen two answer graders.
  - impact: extra real stale-doc mentions are allowed.
  - literal: paraphrased TODO text at the right locations is allowed.
  - Reasoned against the kept pilot answers; no paid run. Eval files only, no version bump. Not
    blocked.
- Workers `absorb-concept-skills-038` and `absorb-concept-skills-040` were started by the user and
  recorded. The user removed the leftover `evals/`.
- r037 (absorb-concept-skills-040) → 040 done in worktree `code-graph-task-040` (branch task-040),
  uncommitted and unmerged:
  - Both `graders/answer.md` files were changed as the ticket asked, plus a `docs/evals.md` note.
  - By reasoning, the two failing pilot answers would now pass and a passing one still passes.
  - Verified by me: the diff matches the ticket. `/plugin/` and `docs/` are in `.prettierignore`, so
    `pnpm check` doesn't format these files. A bare prettier call would turn the impact grader's
    `skills/*/SKILL.md` into italics, which is harmless because the judge reads the raw text.
  - The worker couldn't run `pnpm check` (no node_modules in the worktree); run it after the merge.
- 040 merged by the user (151aa7b, merge ffa0a82), and the user ran `pnpm check` after the merge.
  The 040 ticket file, the r037 report and this bookkeeping are still uncommitted, waiting for the
  next commit together with 038's work.
- r038 (absorb-concept-skills-038) → 038 done in the main tree, uncommitted:
  - `bench/` holds `run.mjs`, `lib.mjs`, `lib.test.mjs`, `cases.json` and `README.md`.
  - `bench/results/` is gitignored, linked from `docs/evals.md`, plus one CLAUDE.md bullet.
  - Flags checked against the user's `claude -p --help`.
  - The user-run fixture check (02-impact-movetask, Sonnet by default, $0.113) passed. Bash worked:
    the first paid run with a code-graph call that returned output (exit 0, 197 chars). Both arms
    scored 2/2.
  - On this question no-graph was cheaper: $0.048 against $0.066, with 72k cache read against 44k.
  - Verified by me: the 16 bench unit tests pass, `pnpm check` is green, and I reviewed the report
    and the code.
  - `bench/lib.test.mjs` isn't in `pnpm test`; it runs with `node --test bench/lib.test.mjs`.
  - Ticket 039 amended (it isn't running yet): first tighten `isCg` and pass Opus explicitly. Whether
    maestro's project skills load under `--setting-sources local` remains its init check.
  - 039 is now unblocked and needs the pinned maestro sha from the user.
- 038 committed from its own session as e2c8927: `bench/`, `.gitignore`, CLAUDE.md and
  `docs/evals.md`. Still uncommitted: the 040 ticket, the 039 amendment, reports r037 and r038, and
  this bookkeeping.
- Bookkeeping committed by me at the user's request (238bce0). The user started 039, and I recorded
  `absorb-concept-skills-039`.
- 039 pin: maestro's committed HEAD (b323aa7) has no `crosses_concept: true` edges, so its graph is
  from before 0.3.27. Maestro's working tree has the 0.3.27 re-extract, with true edges in 15 of 16
  `.ast.json` files. The user chose option 1 and will commit that re-extract in maestro. 039 then
  pins the new sha.
- Maestro's manager made the commits, with the user's approval: 32add96 (14 concepts) and 3814a30
  (agents-view graph file plus its SKILL.md fix). 163f4ac after them is only maestro's epic log.
  Verified by me: at 3814a30, all 15 changed `.ast.json` files have `crosses_concept: true` edges.
  `global-stores` has none and is byte-identical. **039 pins 3814a30.**
- 039, my review of the backend's proposal before the user approves the question set (m1–m5: three
  impact, two cross):
  - Run the $0 init preflight first; whether the project skills load is still unverified.
  - The no-graph arm must have no `scribe-output/` at all. Its committed `.ast.json` files would show
    up in Grep results and inflate the baseline.
  - Raise `--run-budget` (about $0.75) so no run is cut off mid-answer. The user picks the total cap.
  - The report must state the selection bias: 7 candidate questions were dropped for graph coverage
    gaps (callers in files outside any concept, `--max 20` truncation). Those gaps are a finding too.
  - Keep m2 (the exit-4 retry is realistic) and m4 (the skill names the functions but not their
    callers).
- 039 init preflight (user-run): maestro's project skills load in neither arm under
  `--setting-sources local`. That's the ticket's stop condition. The plugin isolation itself is fine:
  code-graph shows only in the graph arm.
  - Fix proposed to the user: add `project` to the setting sources, and delete the workspace's
    `.claude/settings.json` in both arms.
  - Deleting it matters. Maestro's settings at 3814a30 enable `code-graph@code-graph` (a leak into the
    no-graph arm, and a version other than ours), plus about a dozen maestro hooks on every tool call.
  - Then rerun the preflight.
- 039 preflight rerun passed: the concept skills load in both arms, and code-graph loads only in the
  graph arm. The user approved m1–m5 and asked 039 to add a `--group` filter, so the fixture case
  stays out of the paid run.
- r039 acked: 039 is done. 20 valid counted runs on Opus 5.5, $5.378 of the $6 cap. The m4/m5 run-2
  runs hit a 429 usage limit and were rerun with `--only -cross-`.
  - **Verdict: the graph doesn't save cost.**
    - All five questions: $2.577 graph vs $2.580 no-graph.
    - Impact m1–m3: the graph arm costs 7% more.
    - Cross m4/m5: the graph arm costs 8% less, but no code-graph CLI call was made in any of the 4
      graph runs. The saving is a concept-skill effect.
    - The retrieval skill fired in 5 of 10 graph runs.
    - Pass rate: 67/72 graph vs 66/72 no-graph.
    - Confidence is low: n=2, and selection bias favours the graph.
  - Verified by me:
    - bench tests 26/26 pass;
    - per-run costs in the transcripts add up to $5.378;
    - in the m4/m5 graph transcripts, `code-graph` appears only in the init event and the
      SessionStart hook output, never in a tool call.
  - No ticket changes. Stage 2 is the user's choice: an enrichment arm, a Haiku 5.5 arm, or stop
    investing in retrieval.
- 039 committed by me at the user's request (c40eb3e).
- Retrieval direction. The user's intent is "grep on steroids". My diagnosis: the delivery causes
  friction (choose a skill, load its body, call a Bash CLI, read exit codes), and on one-level
  impact questions Grep has little left for the graph to save.
  - Delivery options, held until the measurements are in:
    - a PostToolUse hook on Grep that appends the enclosing function and callers;
    - native tools through an MCP server (out of scope in `CLAUDE.md` unless the user asks);
    - a slimmer skill.
  - Tickets written and linked:
    - **041:** an oracle arm (graph output pasted into the prompt) to find the best-case saving, plus
      2–3 deep-impact questions. Cap $7, 20% decision rule.
    - **042:** concept skills vs no concept skills. Cap $7. Blocked by 041: both edit the bench, and
      the paid runs must not overlap on the usage limit.
- The user started 041 (`absorb-concept-skills-041`).
- 041 incident: the agent ran `bench/maestro-setup.sh` with the repo root as cwd.
  - What happened: maestro's tree was extracted over the repo. The script's
    `rm .claude/settings.json` was blocked by the sandbox (the file is write-denied).
  - The agent's cleanup reset `.claude/maestro-tasks/status.json` and `.claude/maestro.json` to HEAD.
  - Checked by me:
    - no maestro files are left, tracked or ignored (`.mcp.json` and `.claude/agents` are sandbox
      device nodes, not overwritten);
    - this repo's `scribe-output` is intact, with no maestro concept in the store.
  - Restored by me: task status re-synced, 041/042 re-linked, `runtimeVersion` back to 0.12.11.
  - 041 now shows `ready` in `status.json` while it runs. The claim's status write was lost; its
    end-of-task write sets it.
  - Asked 041 to add a guard to `maestro-setup.sh`: refuse unless the cwd is an empty directory
    outside any git work tree. With a test.
  - 041 confirmed: the guard is being added (exit 2, one stderr line, unit test). It reports the user
    approved the question set m1–m7 and the run plan.
  - Next steps: test, review, scribe, then the user's paid run.
- r040 acked: 041 is done.
  - Scope was cut by the user: the full plan didn't fit the $7 cap, so only the deep questions m6 and
    m7 ran, in three arms (nograph, oracle, graph). m1–m5 have no oracle verdict.
  - 12 of 12 runs valid, $2.467 spent, no usage limit hit.
  - **Deep group: oracle vs nograph, +3% ($0.861 vs $0.836).**
    - The decision rule needed at least 20% cheaper, so the ceiling is too low to justify a delivery
      rework.
    - Even with the answer in its prompt, Opus still grepped to check it (13 Greps over 4 runs). The
      larger prompt raised cache-create tokens: fewer turns (21 vs 28), the same cost.
  - The "Grep is expensive" questions weren't: nograph took 6–8 turns at about $0.20 a run.
  - The graph arm never used the CLI or the skill (I confirmed 0 hits in the transcripts), so
    graph vs oracle (-11%) measures nothing.
  - Verified by me:
    - bench tests 43/43 and `pnpm check` green;
    - the guard is at the top of `maestro-setup.sh`;
    - the report matches.
  - Suggestions from 041, held:
    - the m1–m5 oracle run (about $4);
    - a `packages/` ticket to remove duplicate caller lines in the impact output.
  - Conclusion for the retrieval direction: with Opus on a maestro-sized repo, even a free graph
    answer doesn't cut cost. Delivery rework isn't justified on this evidence. 042 goes ahead
    unchanged.
- Tickets 041/042 and the bookkeeping committed by me at the user's request (84a9bf2). 041's bench
  work was left uncommitted.
- r041 acked: 042 is done.
  - Run: m2, m4, s1, s2, s3 on Opus 5.5; 19 of 20 runs valid; $5.363 of $7. A 429 was rerun with
    `--rerun`.
  - The invalid run is m2 noskills run 1, where a Bash chain with `sed` exited 1. That leaves m2
    unbalanced.
  - **Verdict: concept skills don't save cost on Q&A.**
    - The 4 balanced questions: skills $2.157 vs noskills $1.992 (+8%). Pass 60/60 vs 58/60.
    - Where the covering skill loaded (s2, s3, 4 of 4 runs): +11%. The model still reads the
      source, and the skill adds cache-create tokens.
    - On m2, m4 and s1 the covering skill never loaded.
    - The 039 m4 hint (-16%) didn't reproduce: +11% here.
    - Selection bias favours skills.
  - Verified by me: bench tests 57/57; the totals recomputed from both reports match.
  - Suggestions from 042, held:
    - measure answer quality on conventions and invariants the code doesn't show (`plugin-publishing.md`
      leaked s3's key fact to both arms);
    - relax the "any Bash failure invalidates" rule for a `sed`/`grep` in a chain.
  - Combined conclusion (039 + 041 + 042): on read-only questions with Opus on maestro, neither the
    graph nor concept skills cut cost. Any value they have is untested: answer quality on
    unwritten rules, edit tasks, subagents, weaker models.
- The user committed 041 (086cc2d) and 042 (111f37f).
- New direction from the user: graph context given at the start to a **Haiku** subagent, with some
  retrieval, so it can do work otherwise given to Opus. The value would show as accuracy, not as
  Opus cost.
- Ticket 043 written and linked: Haiku 5.5 on m1–m7, arms nograph, oracle and graph, 2 runs, cap $4.
  - First it relaxes the Bash validity rule: read-only `grep`/`sed`/... failures stop invalidating
    runs.
  - The Opus reference comes from the existing 039 and 041 runs.
  - Decision rule:
    - oracle at least 3 `must` hits above nograph, with no question reversed in both runs;
    - and within 10% of Opus's pass rate at under half of Opus's cost.
  - A realistic primer (built from the task text at subagent start) follows only on a positive
    verdict.
- r042 (043) acked. Haiku 5.5, 42/42 runs valid, $0.335 of $4, no 429s.
  - Pass: nograph 91/108 (84%), oracle 108/108, graph 107/108. Cost per run: nograph $0.0092,
    oracle $0.0066, graph $0.0081.
  - **Verdict: positive on both parts of the rule.** Oracle is 17 hits above nograph and never
    below it in any of the 14 run pairs. It beats Opus's 94% at 2.7% of Opus's cost.
  - Caveats: Opus is a reference from separate invocations, not paired; Opus is near ceiling; most
    of the cost gap is the model price; n=2; selection bias favours the graph.
  - **The plugin as shipped already delivers most of it on Haiku.** The graph arm (no primer)
    scored 107/108 at 12% under nograph. Haiku loaded the retrieval skill and called the CLI in
    14 of 14 runs, against 5 of 10 on Opus.
  - Graph costs 24% more than oracle, almost all on cross questions (+62%): those CLI calls return
    10–15k chars.
  - Verified by me: bench tests 60/60, `pnpm check` green, `report.md` sums match `docs/evals.md`.
  - `stash@{0}` is a stray from 043's backend agent. Left for the user.
  - This revises the earlier idea of removing the retrieval skill and hook: on Haiku they are the
    part that works.
- Reopened (2026-10-30) by maestro-mgr-11fd3a4f for the four unepic'd open tasks 045, 048, 049
  and 050, all linked and spawned. 052 (haiku-subagents-with-graph) is held by the user.
  - m001 (050, round 1): on-track. `enrich targets --summary` with no concept is a cross-concept
    roll-up (`neverApplied`, `notExtracted`, `applied`). "Applied" = live vertices or a docs row.
    The default "incremental only" fits the lazy-enrichment decision.
  - 049 and 050 overlap in cli.ts, usage.md, update-concept-skills, the versions and the bundle.
    049's never-applied drift line reuses 050's definition. Whichever commits second rebases.
  - m002 (048), m003 (049), m004 (045), round 1: all on-track.
    - One "applied" helper: `isConceptApplied` (049, scribe/enrich.ts), used by 045, 049 and 050.
    - Versions: 045 owns 0.3.30, the only ticket that requires a bump. The rest take the next free
      patch when they land.
    - 045 reports deferred renames through `systemMessage` (non-blocking, re-reported at every stop).
      Without a tsconfig there is no auto-refresh. Docs-only refresh waits until someone asks.
    - 049: one `--bump` per stamp batch.
  - r043 (050 done, worktree code-graph-task-050 / branch task-050, uncommitted). Acked.
    - Results: 524/524 tests, `pnpm check` green, eval 7/7.
    - The roll-up form of `enrich targets --summary` is in, and step 6 asks before any fan-out.
    - It still has a private `conceptWasApplied`. At the rebase onto 049, swap it for
      `isConceptApplied` and fix the scribe-pipeline invariant text that names it.
    - After the merge, re-run extract + apply for scribe-pipeline (ts-morph wasn't loadable in the worktree).
    - All four worktrees branch from 5daadc0, so land them one at a time and rebase each later one.
    - Follow-ups, ticketed with the user's approval:
      - 055: print core.leftOut beside first-time builds. Blocked by 050.
      - 056: a `--root` option, plus perhaps a CLAUDE_PROJECT_DIR fallback. Blocked by 049.
        Likely cause: `loadConfig` walks up from the cwd, and sessions never `cd`.
    - Spawn 055 only after task-050 is committed. A worker started earlier branches from HEAD and
      misses 050's step-6 text.
  - 050 committed as 3b43b6a on branch task-050, not yet merged into feat/integrate-concept-skills.
  - r044 (048 done, worktree code-graph-task-048 / branch task-048, uncommitted, no bump). Acked.
    - Cause: on macOS Seatbelt, stat on the denied cache dir succeeds and readdir fails with EPERM.
      The probe now lists node_modules after stat.
    - `MissingProjectDependencyError` has a 4th parameter, `allowPaths`. code-graph-update now has a
      new step 4, so its later steps are renumbered.
    - Results: 522/522 tests, eval 7/7, bundle reproducible.
    - Post-mortem findings:
      - Parallel worktrees share the main checkout's `.claude/channels`, so 045's handoff payload
        reached 048's @test.
      - A fresh worktree has no graph.db, so eval scores 0/7 until `just regraph`.
      - `scribe/backend.2.md` holds 045's skill-refresh gaps.
    - The user chose to ticket the empty store as 057 (eval builds or refuses, never a fake 0/7).
      The channel scoping went to maestro-mgr-4c5a135c as a post-mortem request; it is waiting on
      its user. 045 and 049 were warned to check that a payload names their own ticket.
    - 048 committed as f7abe30 on branch task-048 at 0.3.31 (0.3.30 is reserved for 045), not merged.
  - 055 waits until task-050 is merged into feat/integrate-concept-skills, not just committed,
    because new worktrees branch from it.
  - Channel collision → maestro task 144 (scope handoff channels per task). Until it ships, parallel
    worktree workers here can still collide.
  - The user put 057 on hold for now.
  - r045 (049 done, worktree code-graph-task-049, uncommitted, no bump). Acked.
    - Results: 556/556 tests, eval 7/7.
    - Batch stamp/extract/apply/drift and a one-line drift for never-applied concepts are in. The
      flows use the batch forms.
  - r046 (045 done, committed as 32e6481 on branch task-045 at 0.3.30, unmerged). Acked.
    - Results: 540/540 tests, eval 7/7.
    - Built: `apply --defer-renames` (exit 10) and `refresh-skills` on Stop/SubagentStop with a 120 s
      timeout. Every apply write is in one transaction.
    - **Conflict with 054's rule** ("plugin/hooks/ must not exist"), which I missed at m004.
      - The user kept the hook. I amended `.claude/rules/plugin-skills.md` (uncommitted in the main
        checkout).
      - New rule: no session context or steering. Maintenance hooks are allowed if they report only
        through `systemMessage`, never inject `additionalContext`, never block and always exit 0.
  - 058 (user-approved), to run after 045, 049 and 050 are merged:
    - one applied-concept check, used everywhere;
    - an atomic, owner-checked refresh lock;
    - EXIT_RENAMES_DEFERRED moved out of the hook module;
    - one shared ReportedError helper;
    - a test for the stamp batch's failed[] path;
    - the ts-morph Project cache lifetime documented or bounded.
    The tracker already shows it as unblocked, because the tasks it waits on are marked done even
    though they aren't merged.
  - Merge state: 048 (f7abe30, 0.3.31), 050 (3b43b6a) and 045 (32e6481, 0.3.30) are committed on
    their branches, and so is 049 (ba6adf1).
  - Merges: 045 is merged, and 048 is merged as d700e14 (0.3.31, not pushed). Recommended order:
    050, then 049 (049 rebases once and folds `conceptWasApplied` into `isConceptApplied`).
  - Broken on the branch: 045 grew plugin/skills/scribe/SKILL.md to 9922 B, over the 9216 B cap
    (cli.test.ts:1034), even though r046 reported the suite green. 045's worker had exited, so the
    user routed the trim to 048's worker, on a branch from d700e14: a pointer stays in SKILL.md, the
    detail moves to a reference file, and the gap-channel text stays verbatim.
  - 048 was merged as 9f92594. The trim is on branch fix/scribe-skill-size in the main checkout,
    uncommitted.
    - SKILL.md is 9135 B. The hook detail is in `scribe/refresh-hook.md`, and the gap text is
      unchanged.
    - The worker reports 547/547 tests and `pnpm check` 6/6.
    - I asked it to restore "Do not read it otherwise." after the enrichment.md pointer (025's
      load guard).
    - Stage only the two scribe files. The rule amendment and the bookkeeping go in separate commits.
    - Merged: fast-forwarded as cbc8936. SKILL.md is 9161 B with the guard restored; 547/547 tests.
      The fix branch is deleted. Next: merge 050, then 049.
  - 050 merged as 3c94b99 (0.3.32; the worker reports 556/556 tests and eval 7/7). 049 is last: it
    rebases, folds `conceptWasApplied` into `isConceptApplied`, and takes 0.3.33. 055 also edits
    step 6 of update-concept-skills, so it waits for 049 too.
  - 049 rebased as e7d1130 on 3c94b99 (597/597, eval 7/7, 0.3.33). `isConceptApplied` is now the
    only applied check, which covers that part of 058. Two changes have no tests yet: docs-only
    concepts now count as applied, and `--defer-renames` continues through a batch. Merging is the
    user's call.
  - 049 merged as bde12b5 (commit c59ac1c, amended with 8 tests for those two changes).
    605/605, eval 7/7, 0.3.33. When a batch has both a deferred and a failed concept, it exits 1.
    All four tasks are merged. Open: a skill gap in scribe-pipeline (extract fails on a code
    concept whose globs match nothing). The worker's note about it no longer exists in the main
    checkout.
  - Post-mortem on the parallel-merge friction went to maestro's manager. It became maestro tasks
    145 (touched surfaces, overlap check, merge plan, review checks, re-test after merge) and 146
    (blocked until merged). Both are queued; 145 waits on 144 and 146 on 145. The missing graph
    store in fresh worktrees stays with 056/057.
  - Maestro task 144 (per-task channel scoping) is committed as 9250c5d on maestro's
    feat/use-code-graph, but it isn't pushed or released. Until code-graph runs a maestro plugin
    version that includes it, warn every parallel worker (055/056/058) that channel payloads can
    cross tickets. Even after it ships, two gaps remain: a worktree agent other than reviewer or
    refactor can still write into another task's channel, and claiming a task doesn't set a
    session's channel scope.
