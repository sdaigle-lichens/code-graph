#!/usr/bin/env node
// SessionStart hook: tells the agent that this project has a code graph.
//
// Inert by contract: with no scribe.config.json in the cwd it prints nothing. Otherwise it prints one
// short context line naming the code-graph-retrieval skill. It never blocks (always exits 0), never
// writes files, never runs the CLI and never reads anything but the existence of the config.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LINE =
  "This project has a code graph (scribe.config.json): for \"how does X work\", \"what calls or breaks if I change Y\" and " +
  "\"where is X\" questions, load the code-graph:code-graph-retrieval skill before grepping.";

try {
  if (fs.existsSync(path.join(process.cwd(), "scribe.config.json"))) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: LINE } }) + "\n",
    );
  }
} catch {
  // Never fail a session over a hint.
}
process.exit(0);
