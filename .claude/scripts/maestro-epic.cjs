#!/usr/bin/env node
// Maestro epics (`084`): create an epic, link or unlink tasks, show an epic with its tasks'
// statuses, and the durable inbox: reports from a worker session's done step to the manager, and
// cross-epic notes from one epic's manager to another's (`085`).
// The mechanics live in lib/maestro-epic.cjs (generated from apps/maestro/src/core/epics.ts); this
// script is argument parsing and output. Project root: $CLAUDE_PROJECT_DIR, then the cwd.
//
//   node maestro-epic.cjs create <slug> [--goal "<text>"] [--manager "<session name>"]
//   node maestro-epic.cjs list [--json]
//       Every epic with its manager session NAME ("(none recorded)" if none) and how many reports
//       and notes wait for its acknowledgement: how one manager finds the others (`085`).
//   node maestro-epic.cjs link <slug> <NNN-task.md>...      writes `epic` on each task's tracker entry
//   node maestro-epic.cjs unlink <NNN-task.md>...           removes it again
//       Both are all or nothing: a task that does not exist is named and NOTHING is written (exit 1).
//   node maestro-epic.cjs show <slug> [--json]
//       The epic's manager and worker session NAMES, its tasks with their statuses and, for a
//       running task, the NAME of the session that claimed it (or "(unnamed)"), every
//       unacknowledged report and cross-epic note with its file path, and the cross-epic
//       dependencies: blockedBy edges between this epic's tasks and tasks of another epic (or of
//       none) whose blocker is not done yet. Task membership is read from the tracker.
//   node maestro-epic.cjs set-manager <slug> [<session name>]
//   node maestro-epic.cjs add-worker <slug> <session name> [--task <NNN-task.md>]
//       `113`: every name the caller records about ITSELF (create --manager, set-manager,
//       report --from, note --from, ack --by) is filled in from the name the session-name hook
//       stored for this session (`maestro-<id8>`, `maestro-mgr-<id8>`, or the user's custom title),
//       in preference to a passed one; the passed name is only the fallback. add-worker, which a
//       manager runs FOR a worker, prefers the name recorded on the --task claim instead (and the
//       caller's own stored name only when the caller is a worker that is not the epic's manager).
//   node maestro-epic.cjs remove-worker <slug> <session name>
//   node maestro-epic.cjs of <NNN-task.md>
//       Prints the slug of the epic the task belongs to, or nothing (exit 0) when it belongs to none.
//       The orchestrator runs it once, when it builds the task list, to word the last node.
//   node maestro-epic.cjs report --task <NNN-task.md> [--file <path>|-] [--from "<session name>"]
//       The orchestrator's report step. `--from` defaults to the session name recorded on the task's
//       claim, when that claim still exists (`done` deletes it, so the command it prints carries --from).
//       Writes the report body (a file, or stdin when --file is "-" or
//       omitted) into the inbox of the epic the task belongs to and logs it. Prints the report file
//       path and, when the epic has a manager recorded, the name to message. A task that belongs
//       to no epic prints a single line and exits 0: nothing else happens.
//   node maestro-epic.cjs note <to-slug> --from-epic <slug> [--from "<session name>"] [--subject "<text>"] --file <path>|-
//       A manager's cross-epic note (`085`). Writes the body (a file, or stdin for "-") into the
//       OTHER epic's inbox as nNNN-from-<slug>.md and logs it, both before printing. Prints the
//       note path and the receiving manager's session name to message, or says none is recorded
//       and a resumed manager will list it. Refuses an unknown epic on either side, a note to the
//       sender's own epic, and an empty body. A note is a teammate's request, never the user's approval.
//   node maestro-epic.cjs reports <slug>             the unacknowledged reports and notes, oldest first
//   node maestro-epic.cjs ack <slug> <id>... [--by "<session name>"]
//       Record that the manager received a report (rNNN) or a note (nNNN). Cross-session messages
//       have no delivery receipt, so the acknowledgement lives in the epic's state.
//
// Every write reads the file immediately before writing and changes only its own entries, so the
// manager and the workers can write at the same time without losing each other's work.

const fs = require("fs");
const path = require("path");
const epics = require("./lib/maestro-epic.cjs");
const { resolveSessionId, storedSessionName } = require("./lib/maestro-session.cjs");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// `113`: the name the session-name hook stored for THIS session (`maestro-<id8>`,
// `maestro-mgr-<id8>`, or the user's custom title), with the role that recorded it, or null. The
// commands that record the caller's own name prefer it over the one passed in, so a name typed from
// a stale agent listing can no longer be recorded.
function ownName() {
  try {
    return storedSessionName(path.join(projectDir, ".claude"), resolveSessionId(null));
  } catch {
    return null;
  }
}

/** The caller's stored name, else the passed one (trimmed), else undefined. */
function preferOwn(passed) {
  const own = ownName();
  if (own) return own.name;
  return typeof passed === "string" && passed.trim() ? passed.trim() : undefined;
}
const argv = process.argv.slice(2);
const command = argv[0];

// Split the arguments after the command into positionals and `--flag value` pairs.
function parse(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--json") flags.json = true;
    else if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 1;
    } else positional.push(args[i]);
  }
  return { positional, flags };
}

function fail(message) {
  process.stderr.write(`maestro-epic: ${message}\n`);
  process.exit(1);
}

function need(value, usage) {
  if (!value) fail(`missing argument. Usage: ${usage}`);
  return value;
}

// What to do when the SendMessage to the recorded manager fails. The saved file is the delivery.
function sendFailedHint(kind) {
  return (
    `  If that SendMessage fails, run ListAgents. If exactly one session plausibly matches the manager, ask the user before messaging it. ` +
    `Never conclude the manager is gone from one failed send: the saved ${kind} file is the real delivery, and the manager sees it as unacknowledged on its next check.\n`
  );
}

function readBody(file) {
  if (file && file !== "-") return fs.readFileSync(path.resolve(file), "utf8");
  return fs.readFileSync(0, "utf8");
}

const { positional, flags } = parse(argv.slice(1));

try {
  switch (command) {
    case "create": {
      const slug = need(positional[0], "create <slug> [--goal <text>] [--manager <name>]");
      // The creating session is the manager: its stored name wins over --manager (`113`).
      const manager = preferOwn(flags.manager);
      const { dir } = epics.createEpic(projectDir, slug, { goal: flags.goal, manager });
      process.stdout.write(
        `Maestro epic: created "${slug}" at ${dir}\n  edit ${path.join(dir, "EPIC.md")} for the goal, scope and decisions\n` +
          (manager ? `  manager: "${manager}"\n` : "")
      );
      break;
    }
    case "list": {
      const all = epics.listEpicSummaries(projectDir);
      if (flags.json) process.stdout.write(`${JSON.stringify(all)}\n`);
      else
        process.stdout.write(
          all.length
            ? `${all.map((e) => `${e.slug}  manager: ${e.manager ?? "(none recorded)"}  unacknowledged: ${e.unacknowledged}`).join("\n")}\n`
            : "Maestro epic: no epics\n"
        );
      break;
    }
    case "link": {
      const slug = need(positional[0], "link <slug> <task.md>...");
      const tasks = positional.slice(1);
      need(tasks[0], "link <slug> <task.md>...");
      const r = epics.linkTasks(projectDir, slug, tasks);
      if (r.missing.length) fail(`no such task file: ${r.missing.join(", ")}. Nothing was linked.`);
      process.stdout.write(`Maestro epic: linked ${r.changed.length} task(s) to "${slug}": ${r.changed.join(", ")}\n`);
      break;
    }
    case "unlink": {
      need(positional[0], "unlink <task.md>...");
      const r = epics.unlinkTasks(projectDir, positional);
      if (r.missing.length) fail(`no such task file: ${r.missing.join(", ")}. Nothing was unlinked.`);
      process.stdout.write(`Maestro epic: unlinked ${r.changed.length} task(s): ${r.changed.join(", ")}\n`);
      break;
    }
    case "show": {
      const view = epics.showEpic(projectDir, need(positional[0], "show <slug> [--json]"));
      process.stdout.write(flags.json ? `${JSON.stringify(view)}\n` : `${epics.formatEpic(view)}\n`);
      break;
    }
    case "set-manager": {
      // The calling session is the manager: its stored name wins over the passed one (`113`), and
      // with a stored name the <name> argument may be omitted.
      const slug = need(positional[0], "set-manager <slug> [<name>]");
      const name = need(preferOwn(positional[1]), "set-manager <slug> <name>");
      epics.setManager(projectDir, slug, name);
      process.stdout.write(`Maestro epic: manager of "${slug}" is now "${name}"\n`);
      break;
    }
    case "add-worker": {
      // `113`: the manager usually runs this FOR a worker, so the caller's own stored name is used
      // only when the caller is itself a worker that is not this epic's manager. Otherwise the
      // name the worker's claim on --task recorded (filled in by that worker's own CLI) wins over
      // the typed one.
      const slug = need(positional[0], "add-worker <slug> <name> [--task <task.md>]");
      const own = ownName();
      const manager = epics.readEpicState(projectDir, slug)?.manager?.name ?? null;
      const typed = typeof positional[1] === "string" && positional[1].trim() ? positional[1].trim() : null;
      const name = need(
        (own && own.role === "worker" && own.name !== manager ? own.name : null) ||
          (flags.task ? epics.taskClaimName(projectDir, flags.task) : null) ||
          typed,
        "add-worker <slug> <name> [--task <task.md>]"
      );
      epics.addWorker(projectDir, slug, name, flags.task);
      process.stdout.write(
        `Maestro epic: recorded worker "${name}" on "${slug}"` +
          (typed && typed !== name ? ` (the session's recorded name, not "${typed}")` : "") +
          "\n"
      );
      break;
    }
    case "remove-worker": {
      epics.removeWorker(
        projectDir,
        need(positional[0], "remove-worker <slug> <name>"),
        need(positional[1], "remove-worker <slug> <name>")
      );
      process.stdout.write(`Maestro epic: removed worker "${positional[1]}" from "${positional[0]}"\n`);
      break;
    }
    case "of": {
      const slug = epics.epicOfTask(projectDir, need(positional[0], "of <NNN-task.md>"));
      process.stdout.write(slug ? `${slug}\n` : "");
      break;
    }
    case "report": {
      const task = need(flags.task, 'report --task <NNN-task.md> [--file <path>|-] [--from "<session name>"]');
      // Checked before the body is read: a task outside any epic must cost nothing, not block on stdin.
      if (!epics.epicOfTask(projectDir, task)) {
        process.stdout.write(`Maestro epic: "${path.basename(task)}" belongs to no epic — no report written\n`);
        break;
      }
      // The reporting session's stored name wins over --from (`113`).
      const r = epics.writeReport(projectDir, task, readBody(flags.file), preferOwn(flags.from));
      process.stdout.write(
        `Maestro epic: report ${r.id} for "${path.basename(task)}" written to ${r.file}\n` +
          (r.manager
            ? `  Now message the manager session "${r.manager}" (SendMessage) with ONE short line: report ${r.id} for ${path.basename(task)} is in ${r.file}. The file is the report; do not paste its contents.\n` +
              sendFailedHint("report")
            : `  No manager session is recorded for "${r.epic}", so there is nobody to message. The report is saved and a resumed manager will list it as unacknowledged.\n`)
      );
      break;
    }
    case "note": {
      const usage = 'note <to-slug> --from-epic <slug> [--from "<session name>"] [--subject "<text>"] --file <path>|-';
      const to = need(positional[0], usage);
      const fromEpic = need(flags["from-epic"], usage);
      const file = need(flags.file, usage);
      // Checked before the body is read, like `report`: a refused note must not block on stdin.
      epics.checkNoteRoute(projectDir, to, fromEpic);
      const r = epics.writeNote(projectDir, to, readBody(file), {
        fromEpic,
        from: preferOwn(flags.from),
        subject: flags.subject,
      });
      process.stdout.write(
        `Maestro epic: note ${r.id} from "${fromEpic}" to "${r.epic}" written to ${r.file}\n` +
          (r.manager
            ? `  Now message the manager session "${r.manager}" (SendMessage) with ONE short line: note ${r.id} from epic ${fromEpic} is in ${r.file}. The file is the note; do not paste its contents.\n` +
              sendFailedHint("note")
            : `  No manager session is recorded for "${r.epic}", so there is nobody to message. The note is saved and a resumed manager will list it as unacknowledged.\n`)
      );
      break;
    }
    case "reports": {
      const view = epics.showEpic(projectDir, need(positional[0], "reports <slug>"));
      process.stdout.write(
        view.unacknowledged.length
          ? `${view.unacknowledged.map((r) => epics.formatInboxEntry(r)).join("\n")}\n`
          : "Maestro epic: no unacknowledged reports or notes\n"
      );
      break;
    }
    case "ack": {
      const slug = need(positional[0], "ack <slug> <id>... [--by <name>]");
      const ids = positional.slice(1);
      need(ids[0], "ack <slug> <id>... [--by <name>]");
      for (const id of ids) {
        const outcome = epics.acknowledgeReport(projectDir, slug, id, preferOwn(flags.by));
        process.stdout.write(
          `Maestro epic: ${outcome === "already" ? `${id} was already acknowledged` : `acknowledged ${id}`}\n`
        );
      }
      break;
    }
    default:
      fail(
        "unknown command. Usage:\n  create <slug>\n  list [--json]\n  link <slug> <task.md>...\n  unlink <task.md>...\n  show <slug> [--json]\n" +
          "  set-manager <slug> <name>\n  add-worker <slug> <name>\n  remove-worker <slug> <name>\n  report --task <task.md> [--file <path>|-]\n" +
          "  note <to-slug> --from-epic <slug> [--from <name>] [--subject <text>] --file <path>|-\n  reports <slug>\n  ack <slug> <id>..."
      );
  }
} catch (err) {
  fail(err.message);
}
