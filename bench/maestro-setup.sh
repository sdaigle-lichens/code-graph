#!/usr/bin/env bash
# Workspace for the maestro cases, run with the empty workspace as cwd.
# Usage: maestro-setup.sh <repo-root> <maestro-git-dir> <sha> <graph|nograph|noskills>
# The tree comes from `git archive` (nothing is written in the maestro checkout). Every arm:
# .claude/settings.json is deleted (it enables code-graph@code-graph and maestro's hooks). Graph arm:
# scribe-output/graph.db is built by `apply` only, from the committed .ast.json (no extract, no
# ts-morph). No-graph arm: no scribe-output/ directory at all, .claude/skills kept. Noskills arm (042):
# the no-graph workspace minus every concept skill (`metadata.type: concept-skill`) in any
# .claude/skills, removed by strip-concept-skills.mjs; other skills stay.
set -euo pipefail
# Guard: this extracts a whole repo into the cwd and deletes .claude/settings.json there, so run it
# only in an empty directory outside any git work tree (bench/run.mjs uses a fresh mkdtemp dir).
if [ -n "$(ls -A . 2>/dev/null)" ]; then
  echo "maestro-setup: refusing, cwd is not empty: $PWD (run it in a fresh empty directory)" >&2
  exit 2
fi
if env -u GIT_DIR -u GIT_WORK_TREE git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "maestro-setup: refusing, cwd is inside a git work tree: $PWD (run it in a fresh directory outside any repo)" >&2
  exit 2
fi
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
  if [ "$arm" = noskills ]; then
    node "$repo/bench/strip-concept-skills.mjs" . >/dev/null # exits 1 if it found no concept skill
  fi
fi
