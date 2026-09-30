```json
{
  "files_added_removed_renamed": ["<list, or 'none'>"],
  "justfile_commands_changed": ["<old → new description, or 'none'>"],
  "new_code_patterns_or_rules": ["<pattern and which agent/rule file should receive it, or 'none'>"],
  "schema_changes": ["<new tables, columns, or constraints, or 'none'>"],
  "workflow_or_process_changes": ["<changed agent handoff, new convention, or 'none'>"],
  "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell the agent>" }]
}
```