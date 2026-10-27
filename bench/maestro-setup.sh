#!/usr/bin/env bash
# Workspace for the maestro cases, run with the empty workspace as cwd.
# Usage: maestro-setup.sh <repo-root> <maestro-git-dir> <sha> <graph|nograph>
# The tree comes from `git archive` (nothing is written in the maestro checkout). Both arms:
# .claude/settings.json is deleted (it enables code-graph@code-graph and maestro's hooks) and
# .claude/skills is kept. Graph arm: scribe-output/graph.db is built by `apply` only, from the committed
# .ast.json (no extract, no ts-morph). No-graph arm: no scribe-output/ directory at all.
set -euo pipefail
repo="$1"; mdir="$2"; sha="$3"; arm="$4"
git -C "$mdir" archive "$sha" | tar -x
# maestro's project settings enable code-graph@code-graph and maestro's hooks: drop them in both arms so
# only the runner's flags decide what loads. .claude/skills stays.
rm -f .claude/settings.json
if [ "$arm" = graph ]; then
  export CLAUDE_PROJECT_DIR="$PWD"
  cg="$repo/plugin/scripts/code-graph.cjs"
  for c in $(node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('scribe.config.json','utf8')).concepts).join(' '))"); do
    node "$cg" apply "$c" >/dev/null
  done
  test -s scribe-output/graph.db
else
  rm -rf scribe-output # no graph.db and no .ast.json/.enriched.json either
fi
