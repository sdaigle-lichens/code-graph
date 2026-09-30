#!/usr/bin/env node
// Adds or changes one workflow in <projectDir>/.claude/maestro.json from a compact declarative
// spec — the CLI half of the `create-workflow` and `update-workflow` skills. The mechanics
// (`applyWorkflowSpec`/`workflowToSpec`) are pure — see lib/maestro-workflow-spec.cjs, generated
// from apps/maestro/src/core/workflow-spec.ts. This script is the ONLY part of that mechanism that
// touches the filesystem: read the config, apply the spec, write it back, re-render the
// orchestrator.
//
//   node maestro-workflow-spec.cjs create --spec-file <path.json> [projectDir]
//   node maestro-workflow-spec.cjs update --spec-file <path.json> [projectDir]
//       Read the WorkflowSpec JSON at <path.json> (write it to a scratch file first — a JSON blob
//       on argv would need shell-quoting a skill can't reliably produce), apply it in the named
//       mode, write .claude/maestro.json, then re-render the orchestrator's handoff table. Prints
//       one line of JSON: { ok, mode, workflow, createdInstances, issues, render }.
//
//       On any `errors` from applyWorkflowSpec (bad name for the mode, an unavailable agent, a
//       duplicate bare-agent collision, …): prints each to stderr and exits 1. WRITES NOTHING —
//       config validation issues (config-validate.ts's `duplicateAgentTypes`, run over the
//       resulting config on success) are reported in the JSON summary's `issues`, never used to
//       block or repair a write; only `errors` do that, and only before anything is written.
//
//   node maestro-workflow-spec.cjs to-spec --name <workflow> [projectDir]
//       Print the WorkflowSpec (JSON, one line) that would round-trip the named workflow as it
//       stands right now — read-only, for a skill that needs to show the CURRENT spec (e.g. so the
//       user's request to `update-workflow` reads as a diff against it).
//
// `projectDir` defaults to $CLAUDE_PROJECT_DIR, then the process's cwd — the same convention every
// other script here follows. Self-contained aside from its two `./lib/` requires, so
// maestro-install.js can copy it into a project's .claude/scripts/ like every other CLI here.

const fs = require("fs");
const path = require("path");
const { readJson } = require("./lib/maestro-session.cjs");
const { applyWorkflowSpec, workflowToSpec } = require("./lib/maestro-workflow-spec.cjs");
const { render } = require("./maestro-render-orchestrator.cjs");

function die(msg) {
  process.stderr.write(`maestro-workflow-spec: ${msg}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);
const FLAGS_WITH_VALUE = new Set(["spec-file", "name"]);

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? null : (rest[i + 1] ?? null);
}

/** The first argument that isn't a recognised `--flag` or its value — the optional projectDir. */
function positional() {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUE.has(a.slice(2))) i++;
      continue;
    }
    return a;
  }
  return null;
}

const projectDir = path.resolve(positional() || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const maestroJsonPath = path.join(projectDir, ".claude", "maestro.json");

/** A present-but-corrupt or wrong-version config is treated as "no config" here, same as config.ts's readConfig. */
function loadConfig() {
  if (!fs.existsSync(maestroJsonPath)) return null;
  const parsed = readJson(maestroJsonPath);
  if (!parsed || parsed.version !== 3) return null;
  return parsed;
}

function readSpecFile(specFilePath) {
  if (!specFilePath) die("--spec-file <path.json> is required");
  let raw;
  try {
    raw = fs.readFileSync(specFilePath, "utf8");
  } catch (err) {
    die(`cannot read spec file "${specFilePath}": ${err.message}`);
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    die(`spec file "${specFilePath}" is not valid JSON: ${err.message}`);
  }
  if (!spec || typeof spec !== "object" || typeof spec.name !== "string" || !spec.name) {
    die(`spec file "${specFilePath}" needs a non-empty string "name"`);
  }
  if (!Array.isArray(spec.steps) || !spec.steps.every((s) => typeof s === "string")) {
    die(`spec file "${specFilePath}" needs "steps" as an array of strings`);
  }
  if (spec.conditions !== undefined) {
    const ok =
      Array.isArray(spec.conditions) &&
      spec.conditions.every(
        (c) => c && typeof c.from === "string" && typeof c.to === "string" && typeof c.label === "string"
      );
    if (!ok) die(`spec file "${specFilePath}"'s "conditions" must be an array of { from, to, label } strings`);
  }
  return spec;
}

function runApply(mode) {
  const spec = readSpecFile(flag("spec-file"));

  // Re-read the config as the very first thing before computing or writing anything — this slice
  // has three writers (the app's /workflows and /agents routes, and this CLI), so a config read
  // earlier in some other step of the calling skill's own run must never be trusted here.
  const cfg = loadConfig();
  if (!cfg) die(`no valid .claude/maestro.json (v3) found under ${projectDir} — run /maestro-install first.`);

  const result = applyWorkflowSpec(cfg, spec, mode);
  if (result.errors.length > 0) {
    for (const e of result.errors) process.stderr.write(`maestro-workflow-spec: ${e}\n`);
    process.exit(1);
  }

  // Slice-merge discipline, same four fields config.ts's mergeSlice writes for sliceType
  // "workflows" — every other field of the freshly-read config (rules, gates, reports, handoffs,
  // runtimeVersion, project_tags, use_maestro_tasks) is carried over untouched.
  const toWrite = {
    ...cfg,
    agents_available: result.config.agents_available,
    skills_available: result.config.skills_available,
    workflow_instances: result.config.workflow_instances,
    workflows: result.config.workflows,
  };
  const text = JSON.stringify(toWrite, null, 2); // NO trailing newline — byte-format is load-bearing.
  const tmp = maestroJsonPath + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, maestroJsonPath);

  const renderResult = render(projectDir);

  process.stdout.write(
    JSON.stringify({
      ok: true,
      mode,
      workflow: spec.name,
      createdInstances: result.createdInstances,
      issues: result.issues,
      render: renderResult.ok ? { ok: true, issues: renderResult.issues } : { ok: false, reason: renderResult.reason },
    }) + "\n"
  );
}

function runToSpec() {
  const name = flag("name");
  if (!name) die("--name <workflow> is required");
  const cfg = loadConfig();
  if (!cfg) die(`no valid .claude/maestro.json (v3) found under ${projectDir}.`);
  const wf = (cfg.workflows || []).find((w) => w.name === name);
  if (!wf) {
    const available = (cfg.workflows || []).map((w) => w.name);
    die(`no workflow named "${name}". Available: ${available.length > 0 ? available.join(", ") : "(none)"}.`);
  }
  const spec = workflowToSpec(wf, cfg.workflow_instances || []);
  process.stdout.write(JSON.stringify(spec) + "\n");
}

if (command === "create" || command === "update") {
  runApply(command);
} else if (command === "to-spec") {
  runToSpec();
} else {
  process.stderr.write(
    "maestro-workflow-spec: unknown command. Usage:\n" +
      "  maestro-workflow-spec.cjs create --spec-file <path.json> [projectDir]\n" +
      "  maestro-workflow-spec.cjs update --spec-file <path.json> [projectDir]\n" +
      "  maestro-workflow-spec.cjs to-spec --name <workflow> [projectDir]\n"
  );
  process.exit(1);
}
