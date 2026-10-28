# Epic: haiku-subagents-with-graph

## Goal

Make code-graph context lift Haiku subagents (maestro's test and scribe already run on Haiku) toward Sonnet-quality work at Haiku cost, and get the plugin's retrieval as close to frictionless as the oracle ceiling measured in absorb-concept-skills.

## Background

This epic starts from the measurements of epic `absorb-concept-skills` (tickets 039, 041, 042
and 043). Its `EPIC.md` "Status: closed" section holds the summary, and `docs/evals.md` has the
details. Go there for more context.

- On Opus 5.5 the graph doesn't cut cost on read-only questions.
- On Haiku 5.5, on m1–m7:
  - the oracle (best-case graph output pasted in) scored 108/108;
  - the plugin as shipped scored 107/108;
  - without the graph it scored 91/108;
  - all at about 3% of Opus's cost.
- What's left between the plugin and the oracle is cost (+24%), mostly from 10–15k-char CLI output
  on cross-concept questions.
- In `~/gits/maestro`, `.claude/agents/test.md` and `scribe.md` set `model: claude-haiku-5-5`.

## Scope

In:
1. Measure whether the graph improves Haiku's test and scribe work, with Sonnet 5.5 as the
   reference.
2. Cut retrieval friction toward the oracle ceiling: trim cross-concept CLI output, then possibly a
   primer built from the task text at subagent start. Measure each step.
3. Recommend, per agent, Haiku with the graph or Sonnet.

Out: changes in `~/gits/maestro` (any model switch there is its own ticket in that repo);
embedding ranking; an MCP server.

## Decisions

- The reference model is Sonnet 5.5, not Opus (user, 2026-10-28).
- Paid bench runs are user-run from a plain terminal, each with a cap and a decision rule written
  into `docs/evals.md` before the run.
- Ticket 044 first: no friction work until edit-style tasks show a gain.
