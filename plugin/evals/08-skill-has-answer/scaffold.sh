#!/usr/bin/env bash
# Scaffold for skill-has-answer: fixture + graph, so the retrieval skill is available but not needed.
# The concept skill the agent "has loaded" is quoted in prompt.md (workspaces ignore project skills).
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/evals/scaffold-lib.sh"
scaffold_workspace graph "$ROOT"
