# The refresh-skills hook

Loaded from the scribe skill's "After writing a SKILL.md: extract + apply" section, only when the
hook's `code-graph:` system message names a concept it left unapplied.

**The plugin's Stop/SubagentStop hook enforces the extract + apply rule** (`refresh-skills --hook`):
when a session or subagent stops, every already-applied concept whose SKILL.md changed is extracted and
applied. Running the two commands yourself still works and makes the doc searchable before the stop.

**The hook never decides a rename.** A concept with rename candidates is left unapplied and named in a
`code-graph:` system message. Have the user run `code-graph apply <concept>` in a terminal to answer
the rename prompts; never `--approve-drift` (it records a rename as an insert plus an archive and loses
enrichment). Such a concept is re-reported at every stop until it is applied by hand: hooks never block
and always exit 0.
