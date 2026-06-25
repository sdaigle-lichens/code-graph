---
description: One-time initialization — scan the project, propose concept slices, write scribe.config.json
argument-hint: (no arguments)
---

# /code-graph-init

Initialize code-graph for this project by scanning the codebase, proposing concept slices,
and writing `scribe.config.json` under per-concept approval.

## When to run

Run **once**, at project onboarding, before any other code-graph commands. This is the
starting point of the pipeline:

```
/code-graph-init              ← you are here
  → code-graph bootstrap
  → per concept: code-graph extract → /scribe-enrich → code-graph apply
```

If `scribe.config.json` already exists, this command will refuse to run — use
`/add-concept [seed]` to add a new concept and `code-graph delete-concept <name>` to
remove one.

## Procedure

1. Confirm you are at the project root (check for `package.json`, `tsconfig.json`, or
   `pnpm-workspace.yaml`). If not, ask the user to `cd` to the project root first.

2. Invoke the `code-graph-init` skill. The skill will:
   - Run `code-graph catalog --json` to produce a repo-wide digest
   - Infer domain candidates from file names, exports, and directory structure
   - Validate candidates against the import graph
   - Present each proposed concept for per-concept approval
   - Write `scribe.config.json` after all concepts are reviewed

3. When the skill finishes, remind the user of the next steps:
   ```
   code-graph bootstrap
   # then per concept:
   code-graph extract <concept>
   code-graph apply <concept>
   # enrichment comes later, when you're working in that domain:
   # /scribe-enrich <concept>   (after you've written its SKILL.md)
   ```

## Exit conditions

- `scribe.config.json` already exists → stop, tell the user what to use instead
- `code-graph catalog --json` fails → surface the error; check `--tsconfig` if tsconfig not found
- User rejects all proposed concepts → stop; suggest `/add-concept` as an alternative
