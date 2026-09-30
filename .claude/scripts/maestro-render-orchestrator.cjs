#!/usr/bin/env node
// Re-renders the generated region of the project's Maestro orchestrator skill
// (.claude/skills/maestro/SKILL.md) from .claude/maestro.json:
//   - the <!-- Maestro:HANDOFFS --> table   ← workflows + derived success paths
//
//   node maestro-render-orchestrator.cjs [projectDir]
//
// Invoked by the /maestro-install and /maestro-update skills. The desktop app does the same job
// in-process via render.ts in apps/maestro/src/core, so a save there needs no shell-out.

const fs = require("fs");
const path = require("path");
const { readJson, successPathSteps, duplicateAgentTypes } = require("./lib/maestro-session.cjs");
const { replaceRegion } = require("./lib/maestro-skill-regions.cjs");

// Derived success path (never stored in maestro.json) for a single workflow.
// The walk itself lives in lib/maestro-session.cjs (shared with the validation
// hook). This wrapper joins the array into the " → " display form used by the
// Maestro:HANDOFFS table.
function successPath(wf, instances) {
  return successPathSteps(wf, instances).join(" → ");
}

function handoffTable(cfg) {
  const instances = cfg.workflow_instances || [];
  const workflows = cfg.workflows || [];
  if (workflows.length === 0) {
    return "# No workflows configured yet. Run /maestro-install to set up.";
  }
  const rows = workflows.map((wf) => {
    const sp = successPath(wf, instances) || "(no steps configured)";
    return `| ${wf.name || "unnamed"} | ${sp} |`;
  });
  return ["| Workflow | Success path |", "| --- | --- |", ...rows].join("\n");
}

function render(projectDir) {
  const cfg = readJson(path.join(projectDir, ".claude", "maestro.json"));
  if (!cfg) return { ok: false, reason: "maestro.json not found" };
  const skillPath = path.join(projectDir, ".claude", "skills", "maestro", "SKILL.md");
  if (!fs.existsSync(skillPath)) return { ok: false, reason: "maestro/SKILL.md not found" };

  // Report before writing, never in place of writing — a config a human hand-edited (or a merge
  // conflict resolved) can carry the collision the canvas refuses to create. Refusing to render
  // over it would leave the project with a STALE orchestrator, which is worse than a rendered one
  // plus a warning. See config-validate.ts / task 041.
  const issues = duplicateAgentTypes(cfg);

  let text = fs.readFileSync(skillPath, "utf8");
  text = replaceRegion(text, "HANDOFFS", handoffTable(cfg));
  fs.writeFileSync(skillPath, text);
  return { ok: true, issues };
}

if (require.main === module) {
  const dir = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const r = render(dir);
  if (!r.ok) {
    process.stderr.write(`maestro-render-orchestrator: ${r.reason}\n`);
    process.exit(1);
  }
  for (const issue of r.issues) {
    process.stderr.write(`maestro-render-orchestrator: ${issue.detail}\n`);
  }
  process.stdout.write("Maestro orchestrator skill re-rendered from .claude/maestro.json\n");
}

module.exports = { render, successPath, handoffTable };
