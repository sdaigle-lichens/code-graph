#!/usr/bin/env node
// Reports how far each workflow in .claude/maestro.json has drifted from the seed.
//
//   node maestro-workflow-drift.cjs [projectDir]
//
// Run by /maestro-update. maestro-install.js seeds maestro.json only when the file is absent, so a
// project never learns that a seed workflow changed in a newer plugin version, and cannot tell
// which of its own workflows were edited. This compares each project workflow with the workflow of
// the same name (case-insensitive; the project's keys are "0", "5", ... so the key is not the
// identity) in the seed `defaultV3Config` builds, and prints what differs.
//
// READ-ONLY. It writes nothing: no change to maestro.json, no re-render. Applying a change is the
// user's decision, through the Maestro app's workflow view or the `update-workflow` skill. There is
// deliberately no --apply flag: the config is the user's graph.
//
// The seed is built with `defaultV3Config` from lib/maestro-seed.cjs (generated from
// apps/maestro/src/core/seed.ts), using the project's own implementation agents and referenced
// skills, so node ids and agent names line up and the report cannot drift from what a fresh install
// would write. Positions and label offsets are layout and are ignored.
//
// Prints ONE JSON line and exits 0 under every input, like maestro-stale-refs.cjs:
//   { "checked": true, "summary": "...", "workflows": [{ "name", "verdict", ... }], "report": ["..."], "apply": "..." }
//   { "checked": false, "summary": "...", "workflows": [], "report": [], "apply": "" }
// `verdict` is identical | differs | missing-in-project | project-only. `report` is the human text,
// one line per workflow plus the detail of those that differ, ending with how to apply.

const fs = require("fs");
const path = require("path");
const { defaultV3Config } = require("./lib/maestro-seed.cjs");

const CORE_AGENTS = new Set(["test", "reviewer", "refactor", "scribe"]);
const APPLY =
  "To apply a change, open the workflow in the Maestro app, or run the update-workflow skill with the change you want. Nothing here was changed.";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const strs = (v) => arr(v).filter((s) => typeof s === "string" && s.trim() !== "");
const norm = (name) =>
  String(name ?? "")
    .trim()
    .toLowerCase();

function workflowList(cfg) {
  const ws = cfg.workflows;
  const list = Array.isArray(ws)
    ? ws
    : isObject(ws)
      ? Object.entries(ws).map(([key, w]) => ({ ...w, __key: key }))
      : [];
  return list.filter((w) => isObject(w) && typeof w.name === "string");
}

/** The implementation agents the project's own workflows name, so the seed's node ids line up. */
function implAgentsOf(cfg, workflows) {
  const instanceAgent = new Map(
    arr(cfg.workflow_instances)
      .filter(isObject)
      .map((i) => [i.name, i.agent ?? i.name])
  );
  const fromWorkflow = (w) => {
    const out = [];
    for (const n of arr(w?.nodes)) {
      if (!isObject(n) || n.type !== "agent") continue;
      const name = n.instance ?? n.id;
      const agent = instanceAgent.get(name) ?? name;
      if (typeof name === "string" && !CORE_AGENTS.has(name) && !CORE_AGENTS.has(agent) && !out.includes(name))
        out.push(name);
    }
    return out;
  };
  const byName = (n) => workflows.find((w) => norm(w.name) === n);
  for (const w of [byName("default"), byName("tdd"), byName("tests"), ...workflows]) {
    const found = fromWorkflow(w);
    if (found.length > 0) return found;
  }
  return ["backend"];
}

function buildSeed(projectDir, cfg, workflows) {
  const skillMap = {};
  for (const i of arr(cfg.workflow_instances)) {
    if (isObject(i) && typeof i.name === "string") skillMap[i.name] = strs(i.referenced_skills);
  }
  // Whether the seed has a design-check skill node depends on whether a skill is visible when the
  // install runs (seedSkillsFor), which says nothing about the workflow's shape. So the seed takes
  // the skill from the project's own skill node (Refactor's): a fresh install is never flagged for
  // having, or not having, that node, whatever the skill's visibility is now.
  let designCheck;
  for (const w of workflows) {
    if (norm(w.name) !== "refactor") continue;
    const node = arr(w.nodes).find((n) => isObject(n) && n.type === "skill" && typeof n.skill === "string" && n.skill);
    if (node) designCheck = node.skill;
  }
  return defaultV3Config(implAgentsOf(cfg, workflows), skillMap, designCheck ? { designCheck } : {});
}

function nodeLabel(id, cfgs) {
  for (const cfg of cfgs) {
    const node = arr(cfg.__nodes).find((n) => n.id === id);
    if (!node) continue;
    if (node.type === "agent") {
      const inst = arr(cfg.workflow_instances).find((i) => isObject(i) && i.name === (node.instance ?? node.id));
      const agent = inst?.agent ?? node.instance ?? node.id;
      return agent === id ? id : `${id} (agent ${agent})`;
    }
    if (node.type === "skill") return `skill ${node.skill ?? id}`;
    return `${node.type} ${id}`;
  }
  return id;
}

function nodeSkills(cfg, node) {
  if (node.type === "skill") return { loaded: [], referenced: [] };
  const inst = arr(cfg.workflow_instances).find((i) => isObject(i) && i.name === (node.instance ?? node.id));
  return { loaded: strs(inst?.loaded_skills), referenced: strs(inst?.referenced_skills) };
}

const edgeKey = (e) => `${e.from}\u0000${e.to}\u0000${e.kind ?? "success"}\u0000${e.label ?? ""}`;
const slotKey = (e) => `${e.from}\u0000${e.kind ?? "success"}\u0000${e.label ?? ""}`;

/**
 * A skill node is identified by its `skill`, not its node id: the same skill can sit under a
 * namespaced id in the seed and a short one in the project. Rename such nodes (and the edges that
 * touch them) to `skill:<skill>` on both sides before comparing.
 */
function canonical(wf) {
  const rename = new Map();
  const nodes = arr(wf.nodes)
    .filter(isObject)
    .map((n) => {
      if (n.type !== "skill" || typeof n.skill !== "string" || !n.skill) return n;
      const id = `skill:${n.skill}`;
      rename.set(n.id, id);
      return { ...n, id };
    });
  const edges = arr(wf.edges)
    .filter(isObject)
    .map((e) => ({ ...e, from: rename.get(e.from) ?? e.from, to: rename.get(e.to) ?? e.to }));
  return { ...wf, nodes, edges };
}

function compare(name, seedCfg, seedRaw, projCfg, projRaw) {
  const seedWf = canonical(seedRaw);
  const projWf = canonical(projRaw);
  const view = (cfg, wf) => ({ ...cfg, __nodes: arr(wf.nodes).filter(isObject) });
  const sCfg = view(seedCfg, seedWf);
  const pCfg = view(projCfg, projWf);
  const label = (id) => nodeLabel(id, [pCfg, sCfg]);

  const sNodes = new Map(sCfg.__nodes.map((n) => [n.id, n]));
  const pNodes = new Map(pCfg.__nodes.map((n) => [n.id, n]));
  const nodesAdded = [...pNodes.keys()].filter((id) => !sNodes.has(id)).map(label);
  const nodesRemoved = [...sNodes.keys()].filter((id) => !pNodes.has(id)).map((id) => nodeLabel(id, [sCfg, pCfg]));

  // Edges: exact matches cancel; a leftover pair sharing source, kind and label is a retarget.
  const sEdges = arr(seedWf.edges).filter(isObject);
  const pEdges = arr(projWf.edges).filter(isObject);
  const sKeys = new Set(sEdges.map(edgeKey));
  const pKeys = new Set(pEdges.map(edgeKey));
  const sLeft = sEdges.filter((e) => !pKeys.has(edgeKey(e)));
  const pLeft = pEdges.filter((e) => !sKeys.has(edgeKey(e)));
  const describe = (e, cfgs) => {
    const arrow = `${nodeLabel(e.from, cfgs)} -> ${nodeLabel(e.to, cfgs)}`;
    return e.kind === "condition" || e.label ? `${arrow} [${e.label ?? "condition"}]` : arrow;
  };
  const retargeted = [];
  const sRest = [...sLeft];
  const pRest = [];
  for (const pe of pLeft) {
    const i = sRest.findIndex((se) => slotKey(se) === slotKey(pe));
    if (i === -1) {
      pRest.push(pe);
      continue;
    }
    const [se] = sRest.splice(i, 1);
    const tail = pe.label ? ` [${pe.label}]` : "";
    retargeted.push(
      `${nodeLabel(pe.from, [pCfg, sCfg])}: ${nodeLabel(se.to, [sCfg, pCfg])} -> ${nodeLabel(pe.to, [pCfg, sCfg])}${tail}`
    );
  }
  const edgesAdded = pRest.map((e) => describe(e, [pCfg, sCfg]));
  const edgesRemoved = sRest.map((e) => describe(e, [sCfg, pCfg]));

  // Skills: only nodes both sides have. The seed's referenced skills are taken from the project, so
  // they cannot differ; loaded skills and a skill node's skill id are what a user changed by hand.
  const skills = [];
  for (const [id, sn] of sNodes) {
    const pn = pNodes.get(id);
    if (!pn) continue;
    const s = nodeSkills(sCfg, sn);
    const p = nodeSkills(pCfg, pn);
    for (const kind of ["loaded", "referenced"]) {
      const added = p[kind].filter((x) => !s[kind].includes(x));
      const removed = s[kind].filter((x) => !p[kind].includes(x));
      if (added.length || removed.length) {
        skills.push({ node: label(id), kind, added, removed });
      }
    }
    if (sn.type === "skill" && pn.type === "skill" && sn.skill !== pn.skill) {
      skills.push({
        node: label(id),
        kind: "skill",
        added: [pn.skill].filter(Boolean),
        removed: [sn.skill].filter(Boolean),
      });
    }
  }

  const differs =
    nodesAdded.length +
      nodesRemoved.length +
      edgesAdded.length +
      edgesRemoved.length +
      retargeted.length +
      skills.length >
    0;
  return {
    name,
    verdict: differs ? "differs" : "identical",
    nodes: { added: nodesAdded, removed: nodesRemoved },
    edges: { added: edgesAdded, removed: edgesRemoved, retargeted },
    skills,
  };
}

function detailLines(w) {
  const out = [];
  for (const n of w.nodes.added) out.push(`    + node ${n}`);
  for (const n of w.nodes.removed) out.push(`    - node ${n}`);
  for (const e of w.edges.added) out.push(`    + edge ${e}`);
  for (const e of w.edges.removed) out.push(`    - edge ${e}`);
  for (const e of w.edges.retargeted) out.push(`    ~ edge retargeted ${e}`);
  for (const s of w.skills) {
    const bits = [...s.added.map((x) => `+${x}`), ...s.removed.map((x) => `-${x}`)];
    out.push(`    ~ ${s.kind} skills on ${s.node}: ${bits.join(" ")}`);
  }
  return out;
}

function unchecked(reason) {
  return { checked: false, summary: `Workflow drift not checked: ${reason}.`, workflows: [], report: [], apply: "" };
}

function analyze(projectDir) {
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    return unchecked("no readable .claude/maestro.json");
  }
  if (!isObject(cfg) || cfg.version !== 3) return unchecked("maestro.json is not a version 3 config");

  const projectWfs = workflowList(cfg);
  const seed = buildSeed(projectDir, cfg, projectWfs);
  const seedWfs = workflowList(seed);
  const seedByName = new Map(seedWfs.map((w) => [norm(w.name), w]));
  const projByName = new Map();
  for (const w of projectWfs) if (!projByName.has(norm(w.name))) projByName.set(norm(w.name), w);

  const workflows = [];
  for (const pw of projectWfs) {
    if (projByName.get(norm(pw.name)) !== pw) continue;
    const sw = seedByName.get(norm(pw.name));
    workflows.push(
      sw
        ? compare(pw.name, seed, sw, cfg, pw)
        : {
            name: pw.name,
            verdict: "project-only",
            nodes: { added: [], removed: [] },
            edges: { added: [], removed: [], retargeted: [] },
            skills: [],
          }
    );
  }
  for (const sw of seedWfs) {
    if (!projByName.has(norm(sw.name))) {
      workflows.push({
        name: sw.name,
        verdict: "missing-in-project",
        nodes: { added: [], removed: [] },
        edges: { added: [], removed: [], retargeted: [] },
        skills: [],
      });
    }
  }

  const count = (v) => workflows.filter((w) => w.verdict === v).length;
  const differing = count("differs");
  const parts = [
    `${count("identical")} identical`,
    `${differing} differ`,
    `${count("missing-in-project")} missing in project`,
    `${count("project-only")} project-only`,
  ];
  const summary =
    differing === 0
      ? `Workflow drift: no differences from the seed (${parts.join(", ")}).`
      : `Workflow drift: ${differing} workflow${differing === 1 ? "" : "s"} differ from the seed (${parts.join(", ")}).`;

  const report = [];
  for (const w of workflows) {
    const note =
      w.verdict === "missing-in-project"
        ? " (a seed workflow this project does not have; information only)"
        : w.verdict === "project-only"
          ? " (no seed counterpart; information only)"
          : "";
    report.push(`${w.name}: ${w.verdict}${note}`);
    if (w.verdict === "differs") report.push(...detailLines(w));
  }
  report.push(APPLY);
  return { checked: true, summary, workflows, report, apply: APPLY };
}

let result;
try {
  result = analyze(path.resolve(process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd()));
} catch (err) {
  result = unchecked(`unexpected error (${err && err.message ? err.message : "unknown"})`);
}
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(0);
