#!/usr/bin/env bash
# Scaffold for impact-movetask: fixture + graph built with apply only.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/evals/scaffold-lib.sh"
scaffold_workspace graph "$ROOT"
