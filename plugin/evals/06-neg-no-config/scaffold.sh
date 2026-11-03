#!/usr/bin/env bash
# Scaffold for neg-no-config: sources only, no graph config.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/evals/scaffold-lib.sh"
scaffold_workspace nograph "$ROOT"
