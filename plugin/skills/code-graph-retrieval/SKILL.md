---
name: code-graph-retrieval
description: Query the code-graph database to understand a TypeScript/React codebase before reading files. Use when you need to learn how a feature works, find what calls or is impacted by a function/hook/store, locate where functionality lives, or trace cross-concept relationships. Prefer this over raw Grep/Glob for "how does X work" / "what breaks if I change Y" questions in a project that has a scribe.config.json.
allowed-tools: Bash, Read
---

## When to use

Reach for this **before** grep/glob-ing whenever the task is to *understand* code in
a project that has a `scribe.config.json` at its root — for example:

- "How does <feature> work?" → `code-graph search`
- "What calls / depends on / breaks if I change <symbol>?" → `code-graph query impact`
- "Where is <concept> / <functionality>?" → `code-graph search` then `query concept`
- "How do <concept A> and <concept B> interact?" → `code-graph query cross`
- Resolving a stack-trace line or editor cursor to its vertex → `code-graph query vertex`

The graph returns `@filepath:line` pointers with semantic context (purpose, tags,
callers/callees, cross-concept refs). Use those pointers as your `Read` targets — the
graph tells you *where* and *why*; you still read the source for exact detail.

## When NOT to use

- The project has no `scribe.config.json` → fall back to Grep/Glob/Read and surface:
  *"This project isn't initialized — run `create-concept-skills` to set up the graph."*
  (Do NOT run init yourself — it is user-triggered.)
- You need a literal text/regex match (a string, an import path, a TODO) → use Grep.
- The graph returns exit code `6` (no results) → fall back to a raw search.
- You are editing/enriching the graph itself → that is the `scribe` skill's enrichment, not this skill.

## Procedure

1. **Pick the command** by question shape:

   | Need | Command |
   |------|---------|
   | Natural-language "how does X work" | `code-graph search "<question>"` |
   | Impact / callers / dependents of a symbol | `code-graph query impact <symbol>` |
   | Everything in a named concept | `code-graph query concept <name>` |
   | How two concepts relate | `code-graph query cross <a> <b>` |
   | Vertex at a file:line, name, or `concept::name` | `code-graph query vertex <location>` |
   | All vertices + edges in one file | `code-graph query file <filepath>` |

2. **Run it via Bash** from the project root. Add `--max-tokens <n>` to widen/narrow the
   budget (default 3000); `--direction in|out|both` for impact.

3. **Handle the exit code:**

   | Code | Meaning | Next step |
   |------|---------|-----------|
   | `0`  | OK | Use the `@filepath:line` pointers as `Read` targets |
   | `2`  | Retired — never emitted (the store is a local file, not a server) | Nothing to do; fall back to Grep/Glob if you somehow see it |
   | `3`  | Store written by a newer code-graph | Tell the user to upgrade the CLI |
   | `4`  | Ambiguous symbol | Re-run with `concept::name` or `filepath:name` |
   | `5`  | No config | No graph here — fall back to Grep/Glob |
   | `6`  | Zero results | Rephrase once, else fall back to Grep/Glob |
   | `7`  | Low confidence (`search` only): results are printed, but the top cluster is a weak match or its concept is un-enriched. JSON has `low_confidence: true` plus `low_confidence_reason` | Do not treat the results as authoritative. Grep for the terms, or read the concept's SKILL.md (the `> Low confidence:` line names its path), then use the graph hits only as leads |
   | `8`  | `node:sqlite` unavailable: this Node is older than 22.5 or runs with `--no-experimental-sqlite`; the one stderr line says so | Tell the user to run `node --version` and use Node >=22.5; meanwhile fall back to Grep/Glob. `skills *` still works |

4. **Read the pointed-at slices** with `Read` (`offset`/`limit`) to confirm details before
   acting. The graph reflects the last `code-graph apply`, so treat it as a fast index, not
   ground truth — if a pointer looks stale, verify against the file.

## Graph completeness & gaps

The graph is built one concept at a time, so a project's graph is routinely incomplete.
The CLI surfaces this; your job is to interpret it without over-reacting.

**The completeness note (on a successful search).** A line like
`> ⚠ graph 4/6 concepts enriched — results may be partial` only appears when results were
*thin*. It is **status for the user, not a cue for you to act**. Treat a confident result
(exit `0`) as authoritative for what is in the graph. **Do not** fall back to grep, re-run, or
second-guess a good answer because of this line. Only act on it if the user asks to improve
coverage. This rule covers exit `0` only: on exit `7` (low confidence) grep or the concept's
SKILL.md is the fallback, because most concepts stay un-enriched and a plain-language query can
rank the wrong concept first.

**The gap diagnostic (on a whiff, exit 6).** When a search finds nothing, the CLI prints a
`## Graph completeness` block listing: declared concepts not fully built, concepts with no
SKILL.md, and source files covered by no concept. Handle it **answer-first, non-blocking**:

1. **Answer the user's question now** via your normal exit-6 fallback (Explore/Grep). Never
   make the user wait on a build to get their answer.
2. If the block lists **source files covered by no concept**, grep *those files* for the
   query. Hits there are strong evidence the relevant code simply isn't in the graph —
   point the user at it and suggest declaring a concept for it.
3. *Then* add a one-line, non-blocking **offer** for any fixable concept, e.g.:
   "Answered via grep. Concept `X` is declared but not built — want me to build it so future
   queries hit the graph?" Framed as an investment for next time, never a prerequisite.

**A subagent cannot ask.** If you have no `AskUserQuestion` (you are a subagent), the offer in
step 3 goes nowhere. After answering, report the gap to the scribe instead; see
[Reporting the gap](#reporting-the-gap-subagents). A main session may do both: offer and report.

**On "yes" — build the concept** (uniform pipeline, safe to re-run; agent fields are
preserved across re-extract):

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" extract <concept>
```
then enrich `<concept>` with the `scribe` skill's whole-concept enrichment procedure. Only the main session can do that. If you are a subagent you cannot spawn agents: report the need through the gap channel ([Reporting the gap](#reporting-the-gap-subagents)) or hand it off to the scribe. Then:
```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" apply <concept>
```

**Guards:**
- If the diagnostic says a concept **has no SKILL.md**, do **not** offer the pipeline (it
  will fail) — tell the user to add `concepts.<name>.skill` or set `skillsDir`.
- For **uncovered files**, never edit `scribe.config.json` yourself — only suggest it.
- **Nag control:** if the user already declined building/enriching a given concept this
  session, do not re-offer it — proceed silently.

### Reporting the gap (subagents)

After you have answered, on a weak or empty search append one entry to
`.claude/channels/scribe/<agent>.1.md`, where `<agent>` is your own bare agent name (`backend`, not
`maestro:backend`). The shape is the scribe skill's gap contract, unchanged:

```json
{ "skill_gaps": [{ "skill": "<the concept's skill id>", "missing": "<query that failed + the vertices or files you expected>" }] }
```

- **One fenced `json` block per file.** If the file exists, read it, add your entry to the
  `skill_gaps` array of that block (you may have written one for your own gaps) and rewrite the file.
  Never add a second block.
- **Keep a leading `<!-- maestro:run_id=... -->` line** as the first line, untouched. Never write a
  `run_id` yourself; maestro stamps it when you finish.
- **Nag control:** do not write the same gap (same skill and query) twice in a session.
- Write nothing when the search answered the question; a gap is never written to fill the file.
  The one exception is the "enrich only" entry below.
- A gap written from the **main session** is never stamped, so the scribe only sees a mention of it,
  not the file inlined. Do not promise the user otherwise.

**Un-enriched hits your answer used ("enrich only").** In plain-text output a hit with no purpose
ends in ` — _not enriched_` (`--json`: `purpose` absent or null). Code a search finds and you rely on
is worth enriching, so after answering, if your answer **actually used** such hits, append one entry
to the same file, under the same rules above (one block merged in place, the leading `run_id` line
kept, no `run_id` written, your bare agent name):

```json
{ "skill_gaps": [{ "skill": "<the hit's concept skill id>", "missing": "enrich only: <name> (<filepath>), <name> (<filepath>) — found by search \"<query>\"" }] }
```

- `missing` **starts with `enrich only:`**. This is not a weak-search gap and not a request to revise
  the SKILL.md: the scribe only enriches the named vertices and leaves the skill text alone.
- Only hits the answer used, not every un-enriched hit in the output. Group them by concept skill:
  one entry per skill, **at most 5 vertices per entry** (more used hits: keep the 5 you leaned on most).
- **Dedupe per session by (skill, vertex):** never name a vertex again for the same skill, even
  from a different query; drop it from the entry, and skip the entry when nothing is left.
- With no graph (no tsconfig, no `scribe.config.json` concepts) there are no hits to mark: nothing
  to report.

`/graph concept <name>` and `/graph cross <a> <b>` emit the same diagnostic on exit 6 when a
named concept is declared-but-not-built — same answer-first handling applies.

## Examples

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" search "how does drag and drop reorder work"
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query impact useWorkorderActions --direction in
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query cross scheduler-store workorder-store
node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query vertex src/store/workorder.store.ts:42
```
