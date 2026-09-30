#!/bin/bash

# Blocks Bash commands that read .env secret files. Only .env.example is allowed.
# Installed into a project's .claude/scripts/ by maestro-install.js and
# wired as a PreToolUse hook (matcher "Bash") in the project's .claude/settings.json.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

deny() {
    jq -n --arg reason "$1" \
        '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
    exit 0
}

# Extract every .env file reference in the command. The trailing boundary class
# (a non-filename char or end-of-line) prevents false positives like ".environment";
# it is stripped back off before comparison.
MATCHES=$(echo "$COMMAND" | grep -oE '\.env(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9._-]|$)' | sed -E 's/[^A-Za-z0-9._-]$//')

while IFS= read -r match; do
    [ -z "$match" ] && continue
    if [ "$match" != ".env.example" ]; then
        deny "Reading '$match' is not allowed — .env files contain secrets. Only .env.example may be read."
    fi
done <<< "$MATCHES"

exit 0
