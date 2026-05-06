---
description: Enrich a concept's AST JSON with agent-authored semantic fields (purpose/inputs/outputs/cross_concept_refs)
argument-hint: <concept>
---

# /scribe-enrich

Enrich a concept's AST JSON with semantic fields using the `scribe-code-graph` skill.

## Usage

```
/scribe-enrich <concept>
```

**Arguments:**
- `concept` — name of the concept to enrich (e.g. `workorder-store`)

## What this does

1. Finds `scribe.config.json` by walking up from the current working directory.
2. Resolves paths (all relative to the config directory, i.e. the directory containing `scribe.config.json`):
   - `astPath` = `scribe-output/<concept>.ast.json`
   - `skillPath` — resolution order:
     1. `config.concepts[<concept>].skill` if set (used verbatim).
     2. Else `<config.skillsDir>/<concept>/SKILL.md` if `skillsDir` is set.
     3. Else fail with: "set `skillsDir` in `scribe.config.json` or `concepts.<concept>.skill`".
   - `outPath` = `scribe-output/<concept>.enriched.json`
3. Invokes the `scribe-code-graph` skill with these four inputs: `concept`, `astPath`, `skillPath`, `outPath`.

## Procedure

Search for `scribe.config.json` starting at CWD, walking up until found or filesystem root reached. If not found, stop and tell the user to create `scribe.config.json`.

Once config is found, resolve the three paths above using the order specified for `skillPath`. If neither `config.concepts[<concept>].skill` nor `config.skillsDir` is set, stop and tell the user to set one of them.

Verify `astPath` exists — if not, tell the user to run `code-graph extract <concept>` first.

Then invoke the `scribe-code-graph` skill, passing:
- `concept`: the argument provided
- `astPath`: resolved path to the ast.json file
- `skillPath`: resolved path to the concept's SKILL.md
- `outPath`: resolved path where enriched.json will be written

The skill will read the AST and source files, write enriched output to `outPath`, and return. Report the output path to the user when done.
