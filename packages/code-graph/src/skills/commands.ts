// The `code-graph skills` command group — layer 1, the concept-skill index.
//
// The deterministic half of the concept-skill flows: finding the skills, the version arithmetic,
// rewriting the frontmatter markers, and the repo-level `skills` block of scribe.config.json. It
// runs in any repo — no graph, no TypeScript, no node_modules — so this module and everything it
// imports must never load `node:sqlite`, `typescript` or `ts-morph`. That keeps `skills *` working
// on any supported Node and keeps the experimental-sqlite warning out of `!` skill injections.
//
// Every command takes `--root <dir>`; see `resolveProjectRoot` for the fallback order.

import { writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import {
  discoverConceptSkills,
  findConceptSkill,
  isWriteBlocked,
  nextVersion,
  planStamp,
  resolveSkillPath,
  type StampPlan,
} from "./concept-skills.js";
import { formatUnextracted } from "../scribe/unextracted.js";
import {
  blindStampWarning,
  checkConceptSkills,
  conceptSkillsStatus,
  findConceptStatus,
  headSha,
  mappedFiles,
  summarizeStatus,
} from "./report.js";
import {
  configPath,
  discoverProjectAgents,
  readAgentsList,
  readConceptSkillsState,
  resolveProjectRoot,
  writeAgentsList,
  writeConceptSkillsState,
} from "./state.js";

/** `skills stamp <skill>`: the stamp was computed but the SKILL.md write was blocked (read-only or
 *  sandboxed filesystem); the lines to apply by hand were printed. */
export const EXIT_STAMP_NOT_WRITTEN = 9;

/** Cap on files listed per concept in the text status view. */
const MAX_LISTED_FILES = 10;

interface RootOpts {
  root?: string;
}

function out(line: string): void {
  process.stdout.write(line + "\n");
}

function json(value: unknown): void {
  out(JSON.stringify(value));
}

function die(msg: string): never {
  process.stderr.write(`code-graph skills: ${msg}\n`);
  process.exit(1);
}

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command("skills")
    .description("concept skills: versioned SKILL.md markers and repo-level state (no graph needed)");

  const rootOption = "--root <dir>";
  const rootHelp = "project to act on (default: $CLAUDE_PROJECT_DIR, then the nearest scribe.config.json, then cwd)";

  skills
    .command("list")
    .description("every concept skill in the tree, from every nested .claude/skills")
    .option("--json", "one line of machine-readable output")
    .option(rootOption, rootHelp)
    .action(async (opts: RootOpts & { json?: boolean }) => {
      const projectRoot = resolveProjectRoot(opts.root);
      const rows = (await discoverConceptSkills(projectRoot)).map((s) => ({
        id: s.id,
        path: s.skillPath,
        version: s.version,
        lastUpdate: s.lastUpdate,
        subConcepts: s.subConcepts.length,
        agentNotes: s.agentNotes.length,
      }));
      if (opts.json) return json({ count: rows.length, skills: rows });
      if (rows.length === 0) return out("No concept skills found.");
      out(`${rows.length} concept skill(s):`);
      for (const r of rows) {
        const sha = r.lastUpdate ? r.lastUpdate.slice(0, 8) : "unstamped";
        out(`  ${r.id}  v${r.version}  @${sha}  ${r.subConcepts} sub-concept(s), ${r.agentNotes} agent note(s)`);
        out(`    ${r.path}`);
      }
    });

  skills
    .command("state")
    .description('the repo-level list record ({"present": false} when no list exists yet)')
    .option(rootOption, rootHelp)
    .action((opts: RootOpts) => {
      const state = readConceptSkillsState(resolveProjectRoot(opts.root));
      json(state ? { present: true, ...state } : { present: false });
    });

  skills
    .command("stamp [skill]")
    .description(
      "stamp one skill's marker (id, directory or SKILL.md path); with no skill, stamp the repo-level " +
        "`skills` block of scribe.config.json"
    )
    .option("--bump <kind>", "minor | major | initial")
    .option("--sha <sha>", "commit to record (default: HEAD)")
    .option("--print", "compute and print the lines to set without writing the SKILL.md (exit 0)")
    .option("--json", "with a blocked write or --print: machine-readable output")
    .option(
      "--reviewed",
      "silence the blind-stamp warning: only after reading the SKILL.md against the changed mapped files"
    )
    .option(rootOption, rootHelp)
    .action(
      async (
        target: string | undefined,
        opts: RootOpts & { bump?: string; sha?: string; print?: boolean; json?: boolean; reviewed?: boolean }
      ) => {
        const projectRoot = resolveProjectRoot(opts.root);
        const lastUpdate = opts.sha || headSha(projectRoot);

        if (!target) {
          const current = readConceptSkillsState(projectRoot);
          // No version yet: the first stamp is `initial`. An existing one is never reset implicitly;
          // create (initial), update (minor) and deepen (major) differ, so the caller must say which.
          if (!opts.bump && current?.version) {
            die(
              `stamp needs --bump minor|major (current repo-level version is ${current.version}); ` +
                "use --bump initial to reset it to 1.0 deliberately"
            );
          }
          const version = nextVersion(current?.version, opts.bump ?? "initial");
          if (!version) die("stamp needs --bump minor|major|initial");
          let written: boolean;
          try {
            written = writeConceptSkillsState(projectRoot, { version, last_update: lastUpdate });
          } catch (err) {
            die((err as Error).message);
          }
          return json({ written, version, last_update: lastUpdate, path: configPath(projectRoot) });
        }

        const skill = await findConceptSkill(projectRoot, target);
        // An unmarked skill has no version to bump — marking it IS the initial stamp.
        const version = nextVersion(skill?.version, opts.bump ?? (skill ? null : "initial"));
        if (!version) die("stamp needs --bump minor|major|initial");
        // A skill not marked YET is the create flow's normal case: fall back to a whole-tree lookup.
        const skillPath = skill ? skill.skillPath : await resolveSkillPath(projectRoot, target);
        if (!skillPath) die(`no skill "${target}" found under ${projectRoot}`);
        let plan: StampPlan;
        try {
          plan = planStamp(skillPath, { version, lastUpdate });
        } catch (err) {
          die((err as Error).message);
        }
        // A blind stamp (mapped files changed, SKILL.md untouched) is warned about, never refused.
        const warning = skill && !opts.reviewed ? blindStampWarning(projectRoot, skill) : null;
        if (warning) {
          const shown = warning.files.slice(0, MAX_LISTED_FILES * 2);
          process.stderr.write(
            `code-graph skills: warning: ${warning.files.length} mapped file(s) changed since the last stamp but ` +
              `${relative(process.cwd(), skillPath)} did not (committed or uncommitted). Compare them with the SKILL.md, ` +
              `then pass --reviewed if it still holds:\n${shown.map((f) => `  ${f}\n`).join("")}` +
              (shown.length < warning.files.length ? `  +${warning.files.length - shown.length} more\n` : "")
          );
        }
        const warn = warning ? { warning } : {};
        // Reports a stamp that was computed but not written: the lines to apply by hand with Edit.
        const report = (reason: string, exitCode: number): never => {
          const blocked = { reason, lines: plan.lines };
          if (opts.json) json({ stamped: skillPath, version, lastUpdate, written: false, blocked, ...warn });
          else {
            out(`stamp computed, not written: ${skillPath}`);
            out(`reason: ${reason}`);
            out(
              plan.lines === plan.metadata
                ? "replace the metadata block (or add it to the frontmatter) with exactly:"
                : "set exactly these lines in its metadata block:"
            );
            for (const l of plan.lines) out(l);
          }
          process.exit(exitCode);
        };
        if (opts.print) return report("--print: write skipped", 0);
        let written = false;
        if (plan.changed) {
          try {
            writeFileSync(skillPath, plan.content);
            written = true;
          } catch (err) {
            if (isWriteBlocked(err)) return report(err.message, EXIT_STAMP_NOT_WRITTEN);
            die((err as Error).message);
          }
        }
        json({ stamped: skillPath, version, lastUpdate, written, ...warn });
      }
    );

  skills
    .command("check")
    .description("concepts without a SKILL.md, path mismatches, unmarked skills, and docs-only skills")
    .option("--json", "machine-readable output")
    .option("--strict", "exit 1 when a concept is missing its skill or has a path mismatch")
    .option(rootOption, rootHelp)
    .action(async (opts: RootOpts & { json?: boolean; strict?: boolean }) => {
      const report = await checkConceptSkills(resolveProjectRoot(opts.root));
      if (opts.json) json(report);
      else {
        out(report.ok ? "concept skills: ok" : "concept skills: problems found");
        for (const m of report.missing) {
          out(`  missing   ${m.concept}${m.declared ? ` (declared ${m.declared} does not exist)` : ""}`);
        }
        for (const m of report.mismatches) {
          out(`  mismatch  ${m.concept}: declared ${m.declared}, marked skill found at ${m.found}`);
        }
        for (const u of report.unmarked) out(`  unmarked  ${u.concept}: ${u.path} has no concept-skill marker`);
        for (const d of report.docsOnly) out(`  docs-only ${d.id}: ${d.path}`);
      }
      if (opts.strict && !report.ok) process.exit(1);
    });

  skills
    .command("status [skill]")
    .description(
      "git freshness per concept: version, last-update, commits since last-update over its globs; " +
        "with a skill (id, directory or SKILL.md path) only that concept, naming each changed file and its commit count"
    )
    .option("--json", "machine-readable output")
    .option("--summary", "compact JSON: id, version, last-update, commits/files since, graph counts (implies --json)")
    .option(rootOption, rootHelp)
    .action(async (target: string | undefined, opts: RootOpts & { json?: boolean; summary?: boolean }) => {
      const projectRoot = resolveProjectRoot(opts.root);
      const report = await conceptSkillsStatus(projectRoot);
      let unchangedFiles: string[] | null = null;
      if (target) {
        const skillPath =
          (await findConceptSkill(projectRoot, target))?.skillPath ?? (await resolveSkillPath(projectRoot, target));
        const one = findConceptStatus(projectRoot, report, skillPath, target);
        if (!one) die(`no skill or concept "${target}" found under ${projectRoot}`);
        report.concepts = [one];
        const changed = new Set(one.filesChanged);
        unchangedFiles = mappedFiles(projectRoot, one.globs).filter((f) => !changed.has(f));
      }
      // Layer 1 stays graph-free: the store is only touched (lazily) when its file exists, and any
      // failure to read it leaves the git-only report untouched.
      try {
        const { existsSync } = await import("node:fs");
        const { tryLoadConfig } = await import("../config.js");
        const config = tryLoadConfig(projectRoot);
        const dbFile = config
          ? config.dbPath
            ? resolve(config.configRoot, config.dbPath)
            : join(config.configRoot, "scribe-output", "graph.db")
          : null;
        if (config && dbFile && existsSync(dbFile)) {
          const { graphFreshness } = await import("../scribe/freshness.js");
          const fresh = graphFreshness(
            projectRoot,
            report.concepts.flatMap((c) => (c.concept ? [c.concept] : []))
          );
          for (const c of report.concepts) if (c.concept && fresh?.[c.concept]) c.graph = fresh[c.concept];
        }
      } catch {
        // git-only output
      }
      if (opts.summary) return json(summarizeStatus(report));
      if (opts.json) {
        if (unchangedFiles)
          return json({ ...report, concepts: [{ ...report.concepts[0], filesUnchanged: unchangedFiles }] });
        return json(report);
      }
      if (report.list) {
        const n = report.list.unknownFreshness ? "unknown freshness" : (report.list.commitsSince ?? report.list.reason);
        out(`list v${report.list.version} @${report.list.lastUpdate.slice(0, 8)}  ${n} commit(s) since`);
      } else out("list: not created yet");
      for (const c of report.concepts) {
        const name = c.concept ?? `${c.skill} (docs-only)`;
        const v = c.version ? `v${c.version}` : "no skill";
        const since = c.unknownFreshness
          ? "unknown freshness"
          : c.commitsSince === null
            ? c.reason
            : `${c.commitsSince} commit(s), ${c.filesChanged.length} file(s)`;
        const g = c.graph ? `  graph: ${c.graph.changed} changed, ${c.graph.stale} stale` : "";
        const u = c.unextracted && (c.unextracted.files.length > 0 ? `  ${formatUnextracted(c.unextracted)}` : "");
        out(
          `  ${name}  ${v}  ${since}${g}${u ?? ""}${c.path ? `  ${relative(process.cwd(), join(projectRoot, c.path))}` : ""}`
        );
        const counts = c.filesChangedCounts ?? [];
        const show = unchangedFiles ? counts : counts.slice(0, MAX_LISTED_FILES);
        for (const f of show) out(`    changed  ${f.path}  (${f.commits} commit${f.commits === 1 ? "" : "s"})`);
        if (show.length < counts.length) out(`    +${counts.length - show.length} more changed file(s)`);
        if (unchangedFiles) {
          for (const f of unchangedFiles.slice(0, MAX_LISTED_FILES)) out(`    unchanged  ${f}`);
          if (unchangedFiles.length > MAX_LISTED_FILES) {
            out(`    +${unchangedFiles.length - MAX_LISTED_FILES} more unchanged file(s)`);
          }
        }
      }
    });

  skills
    .command("agents")
    .description("the agents list (JSON array) agent notes may be written for")
    .option(rootOption, rootHelp)
    .action((opts: RootOpts) => json(readAgentsList(resolveProjectRoot(opts.root))));

  skills
    .command("agents-discover")
    .description("the agents the project has: .claude/agents plus maestro.json agents_available (read-only)")
    .option(rootOption, rootHelp)
    .action((opts: RootOpts) => json(discoverProjectAgents(resolveProjectRoot(opts.root))));

  skills
    .command("agents-set [names...]")
    .description("replace the agents list in the skills block (no names empties it)")
    .option(rootOption, rootHelp)
    .action((names: string[] | undefined, opts: RootOpts) => {
      const projectRoot = resolveProjectRoot(opts.root);
      let written: boolean;
      try {
        written = writeAgentsList(projectRoot, names ?? []);
      } catch (err) {
        die((err as Error).message);
      }
      json({ written, agents: readAgentsList(projectRoot) });
    });
}
