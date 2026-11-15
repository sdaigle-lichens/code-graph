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
//   node maestro-epic.cjs ready <slug> [--cap <n>] [--json]
//       `125`: the manager's spawn list. The epic's tasks that are ready (tracker `ready`, every
//       blocker done) and that no live session has claimed, oldest first, each with the worker
//       session name to give it and the exact `claude -n <name> '/maestro <task.md>'` command, run
//       from the main checkout it prints. Also the running tasks (live claim) and the pending ones (a
//       worker is recorded for the task with add-worker but has not claimed it yet), which are never
//       listed as ready, and how many slots the cap (default 5) leaves free.
//   node maestro-epic.cjs set-manager <slug> [<session name>]
//   node maestro-epic.cjs add-worker <slug> <session name> [--task <NNN-task.md>] [--pane <herdr pane id>]
//       `176`: --pane records the worker's herdr pane id; `show` lists it. A containerized worker
//       cannot be reached with SendMessage: the manager replies with `herdr pane run <pane> "<text>"`.
//       Output wording: with MAESTRO_WORKER_RUNTIME=docker set (a containerized worker), `report`, `note`
//       and `review-request` say no SendMessage or ListAgents is needed (the manager watches the inbox)
//       and a recorded manager is enough for a manager review.
//       `113`: every name the caller records about ITSELF (create --manager, set-manager,
//       report --from, note --from, ack --by) is filled in from the name the session-name hook
//       stored for this session (`maestro-<id8>`, `maestro-mgr-<id8>`, or the user's custom title),
//       in preference to a passed one; the passed name is only the fallback. add-worker, which a
//       manager runs FOR a worker, prefers the name recorded on the --task claim instead (and the
//       caller's own stored name only when the caller is a worker that is not the epic's manager).
//   node maestro-epic.cjs remove-worker <slug> <session name>
//   node maestro-epic.cjs finish-worker <slug> <session name>
//       `180`: run after the USER confirmed the worker's session was stopped. Marks the worker
//       finished and drops its pane id, so `show` no longer lists it or its pane as active.
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
//       `170`: a report for a task that is done (tracker status `done`, or an `Outcome: done` /
//       `Status: done` line in the body) is REFUSED, exit 1 and nothing written, unless it names a
//       commit SHA that exists and is on the task branch task-NNN (and not already on the default
//       branch while task-NNN is unmerged) or, with no task-NNN branch, on the default branch.
//       The refusal names what is missing: no SHA, no such commit, or not on the branch.
//   node maestro-epic.cjs note <to-slug> --from-epic <slug> [--from "<session name>"] [--subject "<text>"] --file <path>|-
//       A manager's cross-epic note (`085`). Writes the body (a file, or stdin for "-") into the
//       OTHER epic's inbox as nNNN-from-<slug>.md and logs it, both before printing. Prints the
//       note path and the receiving manager's session name to message, or says none is recorded
//       and a resumed manager will list it. Refuses an unknown epic on either side, a note to the
//       sender's own epic, and an empty body. A note is a teammate's request, never the user's approval.
//   node maestro-epic.cjs review-request --task <NNN-task.md> --file <review file> [--from "<session name>"]
//       `132`: a worker at a `manager review` stop records its direction brief (the round's review
//       file, which must already exist) as a review request mNNN, numbered as the ticket's next
//       round, and prints the one line to send the manager plus the redirects recorded so far. A
//       re-run with the same file while the request waits is a re-send, not a new round. A task in
//       no epic, or an epic with no manager recorded, prints the fallback: a human review.
//   node maestro-epic.cjs review-verdict --task <NNN-task.md> <on-track|redirect|escalate> [--by "<session name>"]
//       `132`: records the verdict on the ticket's latest review request. The manager runs it when it
//       decides, the worker when it receives the reply; the second caller gets the recorded verdict
//       back. Manager redirects are counted per ticket here (not plan.loopbacks): with 1 already
//       recorded (`150`), a second redirect is recorded and printed as escalate.
//   node maestro-epic.cjs reports <slug>
//       the unacknowledged reports and notes, and the review requests waiting for a verdict, oldest first
//   node maestro-epic.cjs watch <slug> [--for <seconds>] [--interval <seconds>]
//       `176`: the manager's inbox watcher, meant to run under Monitor. Prints one line per unacknowledged
//       report, note and unanswered review request, in the words of a worker's SendMessage line
//       ("report r003 for 087-x.md is in <file>"): those already waiting when it starts, then each new
//       arrival, each once per run. It reads the ack and verdict state and writes nothing, so an acked
//       entry is never announced and a restarted watcher loses nothing. Exits 0 after --for seconds
//       (default 1500, capped at 1740, below Monitor's 30-minute limit): the manager re-arms it.
//   node maestro-epic.cjs ack <slug> <id>... [--by "<session name>"]
//       Record that the manager received a report (rNNN) or a note (nNNN). Cross-session messages
//       have no delivery receipt, so the acknowledgement lives in the epic's state.
//       `171`: each ack addresses exactly one entry. An id two entries share (an inbox written
//       before `171`) is refused with each entry's handle (`r009-167`); `reports` prints that handle
//       in place of the id, and `ack` takes it, or the report's file name, like an id.
//   node maestro-epic.cjs approve --task <NNN-task.md> --stop "<human review|commit|merge>" --commit <sha> --decision <approved|rejected>
//                          [--note "<text>"] [--suite <green|red|partial>] [--escalation <reason,...>] [--op "<git command>"] [--paths <a,b>]
//       `177`: the manager's own decision on a containerized worker's stop, written to the approvals
//       directory (~/.config/maestro/approvals, outside the repo, mounted read-only into workers).
//       Needs `manager_approval: true` in maestro.json. An approval is REFUSED when the suite is not
//       green or any escalation reason applies (scope change, decision conflict, a push or other
//       outward/destructive git operation, a change to agents/skills/workflows/rules/settings, a
//       security finding, a second redirect), or while an escalation awaits the user. A rejection is
//       always recorded (with --note). Refused inside a worker container.
//   node maestro-epic.cjs approval-escalate --task <NNN-task.md> --stop "<stop>" --commit <sha> --reason <reason>
//       `177`: marks the stop as needing the user and prints the AskUserQuestion to ask in THIS
//       (manager) session. The user's answer is recorded by the AskUserQuestion hook, never by the
//       manager.
//   node maestro-epic.cjs approval-check --task <NNN-task.md> --stop "<stop>" [--commit <sha>]
//       `177`: a containerized worker's gate. Exit 0 and `APPROVED` only when a record exists for
//       exactly this task, stop and commit (default: HEAD); otherwise the reason and exit 2, or
//       `NOT-APPLICABLE` (exit 4) when manager approval is off or this is a host worker (ask the user).
//   node maestro-epic.cjs boundary <slug> start|end [--force]
//       Decides whether the epic's start or end step is due, claims it and writes its scope, then
//       prints one line: nothing configured, not due with the reason, already ran, or the skills to
//       run (start_skills.maestro_manager / end_skills.maestro_manager) with the absolute path of
//       the scope file, whose lines are relative to the git root, and its path count. The run is
//       claimed when the line is printed, so a boundary runs at most once; --force re-runs a claimed
//       boundary (never one that was not due) and keeps the recorded base commit. Exit 1 on an
//       unknown epic or a bad phase, otherwise 0.
//
// Every write reads the file immediately before writing and changes only its own entries, so the
// manager and the workers can write at the same time without losing each other's work.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const epics = require("./lib/maestro-epic.cjs");
const os = require("os");
const { resolveSessionId, storedSessionName, mainCheckoutRoot } = require("./lib/maestro-session.cjs");

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
    else if (args[i] === "--force") flags.force = true;
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

// `170`: the git runner the report guard is given (a core module never spawns git itself).
function gitRunner(cwd, args) {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { ok: true, out: out.trim() };
  } catch (err) {
    return { ok: false, out: String((err && err.stdout) || "").trim() };
  }
}

function readBody(file) {
  if (file && file !== "-") return fs.readFileSync(path.resolve(file), "utf8");
  return fs.readFileSync(0, "utf8");
}

// `177`: the project's maestro.json (a worker in a worktree falls back to the main checkout's), or null.
function readProjectConfig() {
  for (const dir of [projectDir, mainCheckoutRoot(projectDir)]) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, ".claude", "maestro.json"), "utf8"));
    } catch {
      /* try the next */
    }
  }
  return null;
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
    case "ready": {
      const usage = "ready <slug> [--cap <n>] [--json]";
      const slug = need(positional[0], usage);
      let cap = epics.DEFAULT_SPAWN_CAP;
      if (flags.cap !== undefined) {
        cap = /^\d+$/.test(flags.cap) ? Number(flags.cap) : NaN;
        if (!(cap >= 1)) fail(`--cap must be a whole number of at least 1, not "${flags.cap}". Usage: ${usage}`);
      }
      const view = epics.readyTasks(projectDir, slug, cap);
      process.stdout.write(flags.json ? `${JSON.stringify(view)}\n` : `${epics.formatReady(view)}\n`);
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
      epics.addWorker(projectDir, slug, name, flags.task, flags.pane);
      process.stdout.write(
        `Maestro epic: recorded worker "${name}" on "${slug}"` +
          (flags.pane ? ` (herdr pane ${flags.pane.trim()})` : "") +
          (typed && typed !== name ? ` (the session's recorded name, not "${typed}")` : "") +
          "\n"
      );
      break;
    }
    case "finish-worker": {
      // `180`: the user confirmed this worker's session was stopped; its pane is no longer active.
      const slug = need(positional[0], "finish-worker <slug> <name>");
      const name = need(positional[1], "finish-worker <slug> <name>");
      epics.finishWorker(projectDir, slug, name);
      process.stdout.write(`Maestro epic: worker "${name}" on "${slug}" is finished; its pane is no longer active\n`);
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
      const body = readBody(flags.file);
      // `170`: a report for a done task must name a commit that exists and holds the task's work.
      const guard = epics.checkReportCommit(gitRunner, projectDir, {
        task,
        body,
        trackerDone: epics.taskStatusOf(projectDir, task) === "done",
      });
      if (!guard.ok) fail(guard.message);
      // The reporting session's stored name wins over --from (`113`).
      const r = epics.writeReport(projectDir, task, body, preferOwn(flags.from));
      process.stdout.write(
        `Maestro epic: report ${r.id} for "${path.basename(task)}" written to ${r.file}\n` +
          epics.deliveryWords("report", r, { task: path.basename(task) }, epics.isContainerWorker())
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
          epics.deliveryWords("note", r, { fromEpic }, epics.isContainerWorker())
      );
      break;
    }
    case "review-request": {
      const usage = 'review-request --task <NNN-task.md> --file <review file> [--from "<session name>"]';
      const task = need(flags.task, usage);
      const file = need(flags.file, usage);
      const base = path.basename(task);
      if (!epics.epicOfTask(projectDir, task)) {
        process.stdout.write(
          `Maestro epic: "${base}" belongs to no epic — no review request recorded. Fall back to a human review at this stop, with ${file} as its summary.\n`
        );
        break;
      }
      const r = epics.writeReviewRequest(projectDir, task, file, preferOwn(flags.from));
      const capLine =
        r.redirects >= r.cap
          ? `  The cap is reached (${r.redirects} redirects of ${r.cap}): if the manager's verdict on this round is redirect, it escalates to human review.\n`
          : `  Manager redirects on this ticket so far: ${r.redirects} of ${r.cap}.\n`;
      process.stdout.write(
        `Maestro epic: ${r.already ? "review request already recorded, still waiting for a verdict" : "review request recorded"}: ${r.id}, round ${r.round}, "${base}", epic "${r.epic}"\n` +
          capLine +
          epics.reviewDeliveryWords(r, epics.isContainerWorker())
      );
      break;
    }
    case "review-verdict": {
      const usage = 'review-verdict --task <NNN-task.md> <on-track|redirect|escalate> [--by "<session name>"]';
      const task = need(flags.task, usage);
      const verdict = need(positional[0], usage);
      if (!epics.isReviewVerdict(verdict))
        fail(`"${verdict}" is not a verdict (one of ${epics.REVIEW_VERDICTS.join(", ")}). Usage: ${usage}`);
      const r = epics.recordReviewVerdict(projectDir, task, verdict, preferOwn(flags.by));
      const head = `Maestro epic: verdict on ${r.id} (round ${r.round}, "${r.task}")`;
      const capped = r.capped
        ? ` (asked: redirect; ${r.cap} redirects were already recorded on this ticket, so it escalates to human review)`
        : "";
      process.stdout.write(
        (r.already
          ? `${head} was already recorded: ${r.effective}${capped}. Act on the recorded verdict.\n`
          : `${head}: ${r.effective}${capped}\n`) + `  Manager redirects on this ticket: ${r.redirects} of ${r.cap}.\n`
      );
      break;
    }
    case "reports": {
      const view = epics.showEpic(projectDir, need(positional[0], "reports <slug>"));
      process.stdout.write(
        view.unacknowledged.length
          ? `${view.unacknowledged.map((r) => epics.formatInboxEntry(r)).join("\n")}\n`
          : "Maestro epic: no unacknowledged reports, notes or review requests\n"
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
    case "watch": {
      // `176`: meant to run under Monitor. One stdout line per inbox entry the manager has not yet
      // acknowledged or answered, the ones already waiting included, then one per new arrival. Reads
      // the ack/verdict state; moves and writes nothing. Ends after a bounded time so it can be re-armed.
      const usage = "watch <slug> [--for <seconds>] [--interval <seconds>]";
      const slug = need(positional[0], usage);
      const seconds = (flag, fallback, max) => {
        if (flags[flag] === undefined) return fallback;
        const n = Number(flags[flag]);
        if (!(n > 0)) fail(`--${flag} must be a positive number of seconds, not "${flags[flag]}". Usage: ${usage}`);
        return Math.min(n, max);
      };
      const forSeconds = seconds("for", epics.WATCH_DEFAULT_SECONDS, epics.WATCH_MAX_SECONDS);
      const everySeconds = seconds("interval", epics.WATCH_DEFAULT_INTERVAL_SECONDS, forSeconds);
      const seen = new Set();
      const poll = () => {
        try {
          for (const line of epics.newInboxAnnouncements(projectDir, slug, seen)) process.stdout.write(`${line}\n`);
        } catch (err) {
          fail(err.message);
        }
      };
      poll(); // an unknown epic fails here, before anything waits
      const timer = setInterval(poll, everySeconds * 1000);
      setTimeout(() => {
        clearInterval(timer);
        process.exit(0);
      }, forSeconds * 1000);
      break;
    }
    case "approve":
    case "approval-escalate":
    case "approval-check": {
      const usage = `${command} --task <NNN-task.md> --stop "<human review|commit|merge>" --commit <sha>${command === "approve" ? " --decision <approved|rejected>" : command === "approval-escalate" ? " --reason <reason>" : ""}`;
      const task = need(flags.task, usage);
      const stop = need(flags.stop, usage);
      const cfg = readProjectConfig();
      const epic = epics.epicOfTask(projectDir, task);
      const project = epics.projectKeyFor(projectDir);
      const root = epics.approvalsDir(os.homedir());
      if (command === "approval-check") {
        // `181`: the value recorded for this worker at launch decides, not the live maestro.json.
        if (!epic || !epics.managerApprovalForTask(projectDir, task, cfg, epics.isContainerWorker())) {
          process.stdout.write(
            `NOT-APPLICABLE: ${!epic ? "this task belongs to no epic" : "manager approval is off, or this is not a containerized worker"}; ask the user as before.\n`
          );
          process.exitCode = 4;
          break;
        }
        const normalized = epics.normalizeStop(stop);
        if (!normalized) fail(`"${stop}" is not a stop (one of ${epics.APPROVAL_STOPS.join(", ")})`);
        const head = flags.commit || gitRunner(projectDir, ["rev-parse", "HEAD"]).out || null;
        const verdict = epics.findApproval(root, { project, epic, task, stop: normalized }, head);
        const words = epics.approvalGuidance(verdict, task, normalized);
        process.stdout.write(verdict.ok ? `APPROVED: ${words}\n` : `NOT APPROVED (${verdict.code}): ${words}\n`);
        process.exitCode = verdict.ok ? 0 : 2;
        break;
      }
      // approve / approval-escalate write: the manager's session on the host, never a worker container.
      if (epics.isContainerWorker())
        fail("approval records are written by the manager on the host, never from a worker container");
      if (!epics.managerApprovalForTask(projectDir, task, cfg, true))
        fail(
          "manager_approval is not enabled for this task's worker (the value in .claude/maestro.json when the worker was launched): the user approves these stops"
        );
      if (!epic) fail(`"${path.basename(task)}" belongs to no epic: there is no manager to approve it`);
      if (command === "approval-escalate") {
        const r = epics.escalateStop(root, { project, epic, task, stop, commit: flags.commit, reason: flags.reason });
        if (!r.ok) fail(r.message);
        process.stdout.write(
          `Maestro epic: escalation recorded for the user (${r.file}).\n` +
            `Ask the user with AskUserQuestion, options "Approve" and "Reject" (their reason through the free-text option), keeping this marker in the question text:\n  ${r.question}\n` +
            "The user's answer is recorded by a hook; never record it yourself.\n"
        );
        break;
      }
      const decision = need(flags.decision, usage);
      if (decision !== "approved" && decision !== "rejected")
        fail(`--decision must be approved or rejected, not "${decision}"`);
      const csv = (v) =>
        typeof v === "string"
          ? v
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : [];
      const flagged = csv(flags.escalation);
      const bad = flagged.filter((r) => !epics.isEscalationReason(r));
      if (bad.length)
        fail(`unknown escalation reason: ${bad.join(", ")} (one of ${epics.ESCALATION_REASONS.join(", ")})`);
      const r = epics.approveStop(root, {
        project,
        epic,
        task,
        stop,
        commit: flags.commit,
        decision,
        note: flags.note,
        facts: {
          suite: flags.suite,
          operations: flags.op ? [flags.op] : [],
          changedPaths: csv(flags.paths),
          scopeChange: flagged.includes("scope-change"),
          decisionConflict: flagged.includes("decision-conflict"),
          securityFinding: flagged.includes("security-finding"),
          redirects: flagged.includes("second-redirect") ? 2 : 0,
        },
      });
      if (!r.ok) fail(r.message);
      process.stdout.write(
        `Maestro epic: ${decision} recorded for ${path.basename(task)} / ${r.record.stop} at ${r.record.commit} (${r.file})\n`
      );
      break;
    }
    case "boundary": {
      const usage = "boundary <slug> start|end [--force]";
      const slug = need(positional[0], usage);
      const phase = need(positional[1], usage);
      if (phase !== "start" && phase !== "end") fail(`"${phase}" is not a boundary. Usage: ${usage}`);
      const result = epics.runEpicBoundary(projectDir, slug, phase, { force: flags.force === true });
      process.stdout.write(`${epics.formatBoundary(result)}\n`);
      break;
    }
    default:
      fail(
        "unknown command. Usage:\n  create <slug>\n  list [--json]\n  link <slug> <task.md>...\n  unlink <task.md>...\n  show <slug> [--json]\n  ready <slug> [--cap <n>] [--json]\n" +
          "  set-manager <slug> <name>\n  add-worker <slug> <name>\n  remove-worker <slug> <name>\n  finish-worker <slug> <name>\n  report --task <task.md> [--file <path>|-]\n" +
          "  note <to-slug> --from-epic <slug> [--from <name>] [--subject <text>] --file <path>|-\n" +
          "  review-request --task <task.md> --file <review file> [--from <name>]\n" +
          "  review-verdict --task <task.md> <on-track|redirect|escalate> [--by <name>]\n  reports <slug>\n  watch <slug> [--for <seconds>] [--interval <seconds>]\n  ack <slug> <id>...\n" +
          "  approve --task <task.md> --stop <stop> --commit <sha> --decision <approved|rejected>\n" +
          "  approval-escalate --task <task.md> --stop <stop> --commit <sha> --reason <reason>\n" +
          "  approval-check --task <task.md> --stop <stop> [--commit <sha>]\n" +
          "  boundary <slug> start|end [--force]"
      );
  }
} catch (err) {
  fail(err.message);
}
