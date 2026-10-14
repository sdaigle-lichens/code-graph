---
name: cleanup-skill
description: "Trims a skill down to what a session actually needs: cuts bloat and repetition from its SKILL.md, and splits growing content into sub-concepts/ or references/ files. Use after writing or deepening a skill, when a SKILL.md has grown long or repetitive, or when asked to clean up a skill."
---

# Cleanup Skill

A skill's body is not documentation for a human who can flip back a page — it is prompt context
loaded into every session whose task matches its `description`, so every unnecessary line and every
repeated idea is a cost every one of those sessions pays.

## Input

`$ARGUMENTS` is the skill's directory path. If it's missing, ask the caller (or the user) which skill.

## 1. Which kind of skill this is

Check the `SKILL.md` frontmatter for a `metadata.type` marking it as a project-internal explainer
(e.g. `type: concept-skill`), or an existing `sub-concepts/` directory beside it. If either is
present, it's an **explainer skill** and split content goes to `sub-concepts/*.md`. If neither is, it's a **normal
(published) skill** and split content goes to `references/*.md`.

## 2. Cut bloat and repetition

Read the whole `SKILL.md`, and every file it already links to (`sub-concepts/*.md`,
`references/*.md`, `agents/*.md`) — a repeated idea often lives across files, not just within one.

Remove:

- Two sections saying the same thing in different words. Keep the sharper one.
- A sentence that only restates the frontmatter `description` or an earlier heading.
- Prose that narrates what the code already makes obvious — a file map plus one clause beats a
  paragraph walking through it.
- A caveat, trap, or step that is speculative rather than something that actually happened or that
  you can point to in the code.

This is a volume cut, not a style rewrite. Keep every trap, invariant, and hard-won detail — a
warning said three ways is waste, but a warning said once is the reason the skill exists.

## 3. Split what's outgrowing the top-level file

A section is a candidate to move out when it:

- Describes one coherent sub-part with its own mechanism, files, and traps that the top-level file
  doesn't need in order to make its own case — one line and a link is enough there.
- Or, for a normal skill, covers a specific case, a variant path, or an edge case that most
  invocations of the skill never hit.

**Explainer skill** → extract to `sub-concepts/<name>.md`; replace the section in `SKILL.md` with one
line and a link.

**Normal skill** → extract to `references/<name>.md`; replace the section with a pointer that names
the case it covers ("for `<case>`, see `references/<name>.md`"), not a bare link — the reader of a
published skill doesn't open every reference by default, so the trigger to open it has to be in the
main file.

Don't extract just to shorten the file. Splitting a section that isn't a genuine sub-part or edge
case — or whose extracted file would be thinner than the link replacing it — costs a future reader
two loads for content that fit in one. Inline it instead.

## 4. Re-read what's left

Read the trimmed `SKILL.md` as the agent that will load it cold would: does it still open with what
this is and when it applies? Does every remaining section earn its place? A section that now reads
thin is the point of this pass; a section that now reads incomplete means you cut something that
should have stayed — put it back.

## Report

What shrank, what moved to `sub-concepts/` or `references/` and why, and anything you deliberately
left alone because splitting it would have cost more than it saved.
