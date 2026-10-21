#!/usr/bin/env node
// Fails when developer-only files ship inside the published plugin dir: any CLAUDE.md or any
// .claude/ directory under plugin/ (the plugin's own .claude-plugin/ is fine). Developer rules
// live in the repo's .claude/rules/. Run by `pnpm check`.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

/** Repo-relative paths under `dir` that must not ship in the plugin. */
export function findForbidden(dir, rel = "plugin") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const childRel = `${rel}/${entry.name}`;
    if (entry.name === "CLAUDE.md" || entry.name === ".claude") found.push(childRel);
    else if (entry.isDirectory()) found.push(...findForbidden(path.join(dir, entry.name), childRel));
  }
  return found;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = findForbidden(path.join(repoRoot, "plugin"));
  if (found.length > 0) {
    console.error(
      `error: developer files must not ship in plugin/ (move them to .claude/rules/):\n${found.map((f) => `  ${f}`).join("\n")}`
    );
    process.exit(1);
  }
}
