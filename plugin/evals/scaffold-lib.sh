#!/usr/bin/env bash
# Shared scaffold logic, sourced by each case's scaffold.sh.
# Usage: scaffold_workspace <graph|nograph>   (cwd = the empty eval workspace)
# Builds the graph with `apply` only. Never runs extract (no ts-morph in the workspace).

scaffold_workspace() {
  local mode="$1"
  local root="$2"   # plugin/ directory (resolved by the calling scaffold.sh)
  local fixture="$root/evals/fixture"

  echo "scaffold: CLAUDE_PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-<empty>}"
  echo "scaffold: ROOT=$root"
  echo "scaffold: PWD=$(pwd)"
  echo "scaffold: node $(node --version 2>&1)"

  if [ ! -d "$fixture" ]; then
    echo "scaffold: fixture not found at $fixture (script was not run from plugin/evals/<case>/?)" >&2
    exit 1
  fi

  if [ "$mode" = "nograph" ]; then
    cp -R "$fixture/src" ./src
    cp "$fixture/tsconfig.json" ./tsconfig.json
    echo "scaffold: copied sources only (no scribe.config.json, no skills, no graph)"
    return 0
  fi

  if ! node -e 'require("node:sqlite")' >/dev/null 2>&1; then
    echo "scaffold: node:sqlite unavailable; need Node >= 22.5 (found $(node --version 2>&1)); apply would exit 8" >&2
    exit 1
  fi

  cp -R "$fixture/." .
  for concept in task-store board-ui reminders; do
    node "$root/scripts/code-graph.cjs" apply "$concept" || {
      echo "scaffold: apply $concept failed with exit $?" >&2
      exit 1
    }
  done
  echo "scaffold: graph built at scribe-output/graph.db"
}
