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

- The project has no `scribe.config.json` → fall back to Grep/Glob/Read.
- You need a literal text/regex match (a string, an import path, a TODO) → use Grep.
- The graph returns exit code `6` (no results) → fall back to a raw search.
- You are editing/enriching the graph itself → that is `/scribe-enrich`, not this skill.

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
   | `2`  | Server offline | Tell the user to run `code-graph up` |
   | `3`  | DB missing | Tell the user to run `code-graph bootstrap` |
   | `4`  | Ambiguous symbol | Re-run with `concept::name` or `filepath:name` |
   | `5`  | No config | No graph here — fall back to Grep/Glob |
   | `6`  | Zero results | Rephrase once, else fall back to Grep/Glob |

4. **Read the pointed-at slices** with `Read` (`offset`/`limit`) to confirm details before
   acting. The graph reflects the last `code-graph apply`, so treat it as a fast index, not
   ground truth — if a pointer looks stale, verify against the file.

## Examples

```sh
code-graph search "how does drag and drop reorder work"
code-graph query impact useWorkorderActions --direction in
code-graph query cross scheduler-store workorder-store
code-graph query vertex src/store/workorder.store.ts:42
```
