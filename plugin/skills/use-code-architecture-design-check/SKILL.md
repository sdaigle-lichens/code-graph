---
name: use-code-architecture-design-check
description: Pre-design gate. Evaluates whether the current task requires running the code-architecture-design skill before implementation.
allowed-tools: Read, Grep, Glob, Bash
user-invocable: false
---

# Design Confidence Check

Before starting any implementation, run this check to decide whether `code-architecture-design` must run first.

## 1. Concept-skill list

Run the `load-concept-skills` skill.

If it reports **NO LIST**, this project has no concept-skill list — reason about concepts directly from the codebase instead, checking the available skills list first (a project skill may already document the relevant pattern) before opening source files. If a code graph exists, `node "${CLAUDE_PLUGIN_ROOT}/scripts/code-graph.cjs" query impact <symbol>` shows how far a change to an existing symbol reaches (many dependents across concepts counts toward question 2); with no graph or no tsconfig, skip it.

## 2. Evaluate

Answer each question YES or NO:

1. **New or removed concept?** Does the task add a capability that is not an instance of any existing concept (concept skill, or an established pattern if there's no list) — or remove one that is?
2. **Concept-changing?** If the task touches an existing concept, does it change that concept's shape or contract, rather than following it as an inline instance?
3. **Ambiguous architecture?** Are there multiple valid approaches whose choice meaningfully affects codebase structure?

## Decision Gate

Any YES → **RUN** `code-architecture-design`. All NO → **SKIP**.

**Always SKIP `code-architecture-design` when:**

- The change is a straightforward instance of an existing concept (another route on an existing resource, another screen following an existing navigation pattern, another component following an existing design pattern, etc.)
- A sibling file or an existing concept skill is a direct template for the change

## Mandatory Output Format

**Decision:** RUN code-architecture-design | SKIP code-architecture-design
**Reasoning:** [1–2 sentences explaining which criteria were met or not]

## When the decision is RUN

Whoever invoked this check is not told what to do with its answer, so say it here: invoke the `code-architecture-design` skill with the Skill tool now, in this same context, and carry its Design Brief into whatever you do next, before any work is committed to the request. It is **not** `/design`, the Claude Design canvas skill,
which produces visual mockups.
