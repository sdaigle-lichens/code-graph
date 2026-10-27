# Benchmark whether code-graph saves cost on maestro

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The 032 suite can't tell whether code-graph saves cost.
- Its fixture is about 15 files, so Grep is already cheap.
- Only the final answer is graded, and every case scores 1.00 in both arms.
- The 034 pilot measured the plugin at about 27% more cost overall (about 35% in positive cases), with
  no accuracy gain.

This ticket measures, on a real repo, whether **concept skills plus code-graph** answer code questions
more cheaply than **concept skills alone**, and where any overhead goes. It measures and recommends; it
doesn't change retrieval.

**Target: maestro (`~/gits/maestro`) at a pinned commit.** It has about 200 tracked TS/TSX files, a
`scribe.config.json` with 16 concepts, committed `.ast.json` files, concept SKILL.md files, and no
enrichment. It is the consumer this epic serves.
- **Read only.** Never commit or write in `~/gits/maestro`. Pin a commit (current HEAD at the start is
  fine, e.g. `b323aa7`) and record its sha.
- **Where it lives.** Everything goes in this repo under `evals/bench-maestro/`, at the root and outside
  `plugin/` so it doesn't ship:
  - questions, graders, scaffold, proxy script;
  - the re-extracted `.ast.json` for the pinned sha.
- **Gitignore.** Add `evals/bench-maestro/results/` to `.gitignore`. `**/evals/results/` doesn't cover it.
- **Re-extract once.** Maestro's committed `.ast.json` files predate 0.3.27 and have no cross-concept
  edges.
  - `git archive` the pinned sha into `$TMPDIR` and run `extract` there, never inside `~/gits/maestro`.
  - Store the 16 resulting files in `evals/bench-maestro/`.
- **Scaffold.**
  - Unpack `git -C ~/gits/maestro archive <sha>` into the workspace, then drop in the stored
    `.ast.json` and run only `apply`, as `plugin/evals/scaffold-lib.sh` does. 120 s limit.
  - Fail fast with a clear line if the sha isn't in the local clone.
  - Strip `CLAUDE.md`, `AGENTS.md` and any other always-loaded project docs in every arm, so only the
    concept skills and the graph differ between arms.

### Stage 0: offline proxy, no agents, $0

A node script (`evals/bench-maestro/proxy.mjs`, no new deps). For each of 6–8 candidate questions:
- **Graph route.** Run the code-graph command the retrieval skill would pick (`search`, `impact`,
  `cross`, `vertex`). Record its output tokens (chars/4 is fine, stated), its exit code, and whether it
  names the expected answer.
- **Grep route.** Run a scripted Grep/ripgrep a careful agent would start with. Record the matched
  files and lines, and the token cost of reading what's needed to reach the answer.

Questions follow the skill's shapes: who calls X, what breaks if I change Y, where is Z handled, how do
A and B interact. Include at least two multi-hop ones (callers of callers, or across concepts), and one
control where Grep should clearly win (a literal string). Every question needs a known, checkable
answer: a list of symbols or files written down beforehand.

Keep the 4–5 questions where the graph plausibly helps, plus the control. Report the proxy table and
which questions survive, then stop for the user before stage 1.

### Stage 1: user-run agent benchmark, about $4–6, capped at $8

The surviving questions as a `claude plugin eval` suite:
- **Arms.** Concept skills alone vs concept skills plus the code-graph plugin. There is no plain-Grep
  arm, since maestro always has its skills.
- **Check first whether the eval workspace loads project `.claude/skills`.** 033 found that no project
  CLAUDE.md or `.claude/` loads there. If skills don't load as skills, say so: the "skills alone" arm
  is then "SKILL.md files on disk". Propose the closest realistic setup (for example
  `--plugin-dir` on a plugin that carries maestro's skills) before building the cases.
- **Deterministic graders** (regex on the expected symbols or files) gate correctness. No LLM judge,
  unless a question can't be checked any other way, and say which.
- **Metrics per run:** cost, turns, input/output tokens, file reads (Read calls), Skill and Bash calls,
  and code-graph exit codes (0/6/7). Run with `--keep-temp` (and `--verbose` if needed) so transcripts
  survive. Extract the metrics from them with a script, not by hand.
- **Model.** Check whether `claude plugin eval` can set the agent model. If it can, use the model
  maestro's subagents run on (ask maestro's manager through the user if unsure) and record it.
- **Runs:** 2 per arm, `--max-cost-usd 8`. The user runs it with `!`; give the exact command.

### Stage 2 (not in this ticket)

The report recommends whether more runs on close questions, or an enrichment arm, are worth the money.
The user decides.

### Report

Per question and arm: correctness, cost, turns, tokens, reads, Skill/Bash use and exit codes. Then:
- **Verdict:** does the graph save cost at equal correctness, on which question shapes, and by how
  much?
- **Overhead breakdown:** SKILL.md and SessionStart tokens, CLI output size, reading files after the
  CLI anyway, falling back to Grep after exit 7 or missing edges, and the skill firing on cheap lookups.
- **Ranked levers,** each worded as a candidate ticket. The manager writes the tickets.

### Also in this ticket

- Fix the `says-no-graph` grader in `plugin/evals/06-neg-no-config`. It fails every judge vote although
  the agent behaves correctly (032/033/034 pilots). Make it deterministic, or reword it so a correct run
  passes.
- Record in `docs/evals.md` that `claude plugin eval` runs the main session only. Maestro's subagents
  don't get the SessionStart line, so for them triggering depends on the skill description alone, which
  this benchmark doesn't measure.

Docs: `docs/evals.md` gets a "Maestro benchmark" section: setup, how to re-run, results. No version
bump unless something under `plugin/` changes (the grader fix does: then the next free patch in all
three files, bundle regenerated).

Out of scope: changing search ranking, exit-7 thresholds, the skill, the hook or CLI output (those are
the levers to recommend), enriching maestro, and committing anything in `~/gits/maestro`.

## Acceptance criteria

- [ ] `evals/bench-maestro/` holds the questions with written expected answers, the scaffold (pinned sha, fails fast without it, strips always-loaded docs), the 16 re-extracted `.ast.json` files and `proxy.mjs`. Results are gitignored
- [ ] Stage 0 proxy table (graph tokens, exit code and hit; Grep files, lines and read tokens) for 6–8 questions, including 2+ multi-hop and 1 Grep-wins control; the surviving set was shown to the user before stage 1
- [ ] The report says whether eval workspaces load project `.claude/skills`, with evidence, and how the "skills alone" arm was made realistic
- [ ] Stage 1 suite with deterministic graders; a user-run 2-run pilot under $8; metrics per question and arm extracted from `--keep-temp` transcripts by a script
- [ ] The report gives the verdict, the overhead breakdown and ranked levers, and recommends whether stage 2 is worth it
- [ ] The `says-no-graph` grader passes a correct run; `docs/evals.md` documents the benchmark and the subagent limit
- [ ] pnpm check, package tests and just eval (7/7) green; `claude plugin validate` passes; versions bumped together if `plugin/` changed

## Blocked by

- `034-record-cross-concept-calls-at-extract-time.md` (the cross-concept edges this measures)
