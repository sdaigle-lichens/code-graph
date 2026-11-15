#!/usr/bin/env node
// Containerized Maestro workers (`175`): run an epic's /maestro worker sessions inside a
// per-project Docker container.
// The mechanics live in lib/maestro-worker-runtime.cjs (generated from
// apps/maestro/src/core/worker-runtime.ts); this script owns every process spawn and the output.
// Project root: $CLAUDE_PROJECT_DIR, then the cwd, resolved to the main checkout.
//
//   node maestro-worker-runtime.cjs image [--with-package <name@version>]... [--print-tag]
//       Builds the project's worker image, or reuses it when one with the same tag exists. The tag
//       is a hash of the plugins the project enables (pinned to the versions installed on this
//       host), the npm packages their hooks need, the Claude Code version, the host uid/gid and the
//       project path, so a plugin version bump builds a new image. --print-tag only prints the tag.
//       No secret is read, copied or baked.
//   node maestro-worker-runtime.cjs run --name <worker name> [--model <model>] <.claude/maestro-tasks/NNN-task.md>
//       Starts ONE worker: `docker run -it --rm` with the repo bind-mounted at its real path, the
//       settings/hook paths read-only over it, a hooks-less copy of settings.local.json, the task's
//       sibling worktree mounted at its own path, and CLAUDE_CODE_OAUTH_TOKEN read from
//       ~/.config/maestro/worker-token (passed through the environment, never printed or put in
//       argv). Stops with a setup message, before starting anything, when the token file is
//       missing. The herdr socket is never mounted.
//       `177`: with manager_approval true in maestro.json, ~/.config/maestro/approvals is also mounted
//       read-only (and named in MAESTRO_APPROVALS_DIR), so a worker can read approvals, never write one.
//   node maestro-worker-runtime.cjs prune [--dry-run]
//       `180`: removes this project's worker images except the current tag, and stopped worker
//       containers. Only an image labelled for this project is removed; an unlabelled one (built before
//       the label) is listed as skipped with its `docker rmi`, in dry-run mode too. Never an image a running container uses, another project's worker image or an
//       image that is not a Maestro worker image. Prints what it removed and the space freed;
//       --dry-run only lists. With no docker, or nothing to remove (host workers), it says so and exits 0.
//       `181`: `image` and a real `prune` take a per-project lock (~/.config/maestro/locks, outside the repo and
//       every container mount): a second build waits and then reuses the first one's image, a prune and a build
//       wait for each other, and a lock left by a dead process is taken over. `prune --dry-run` takes no lock.
//       `run` records the worker's runtime and manager_approval in its epic's worker record before starting.
//       `176`: the image carries every plugin the host session has enabled, user scope included, and
//       `run` checks that (a shell probe in the image) and refuses an image missing one, naming it.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { mainCheckoutRoot } = require("./lib/maestro-session.cjs");
const rt = require("./lib/maestro-worker-runtime.cjs");

function fail(message) {
  process.stderr.write(`maestro-worker-runtime: ${message}\n`);
  process.exit(1);
}

function parse(args) {
  const positional = [];
  const flags = {};
  const packages = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--print-tag") flags["print-tag"] = true;
    else if (args[i] === "--dry-run") flags["dry-run"] = true;
    else if (args[i] === "--with-package" && i + 1 < args.length) packages.push(args[(i += 1)]);
    else if (args[i].startsWith("--") && i + 1 < args.length) flags[args[i].slice(2)] = args[(i += 1)];
    else positional.push(args[i]);
  }
  return { positional, flags, packages };
}

function capture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.error || r.status !== 0 ? null : String(r.stdout).trim();
}

// The git-tracked files of a directory that is itself a repo root, else null (the caller then
// copies with the exclusion filter alone).
function gitTrackedFiles(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) return null;
  const r = spawnSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).split("\0").filter(Boolean);
}

function claudeVersion() {
  const out = capture("claude", ["--version"]);
  const m = out && /(\d+\.\d+\.\d+[^\s]*)/.exec(out);
  if (!m) fail("cannot read the Claude Code version: `claude --version` did not answer");
  return m[1];
}

function requireDocker() {
  const r = spawnSync("docker", ["--version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) fail("docker is not available on this machine's PATH");
}

function imageExists(tag) {
  return spawnSync("docker", ["image", "inspect", tag], { stdio: "ignore" }).status === 0;
}

// `179`: the project's own verify command, so the image can carry what it needs.
function verifyCommandOf(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8")).verify_command;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function specFor(root, extraPackages) {
  const { spec, missing } = rt.gatherImageSpec(root, {
    verifyCommand: verifyCommandOf(root),
    home: os.homedir(),
    uid: process.getuid(),
    gid: process.getgid(),
    claudeVersion: claudeVersion(),
    extraPackages,
  });
  if (missing.length)
    fail(`these enabled plugins have no install on this host: ${missing.join(", ")}. Install them with /plugin first.`);
  return spec;
}

// `181`: run `fn` holding the project's worker-image lock (outside the repository and every container
// mount: ~/.config/maestro/locks). Waits for a live holder, takes over one left by a dead process.
function withWorkerLock(kind, fn) {
  const lock = rt.acquireWorkerLock(rt.workerLockDir(os.homedir(), root), {
    kind,
    onWait: (owner) =>
      process.stdout.write(`waiting for ${rt.describeLockHolder(owner)} to finish before the ${kind} starts\n`),
    onRecovered: () => process.stdout.write("recovered a worker image lock left by a process that is gone\n"),
  });
  if (!lock.ok) fail(lock.message);
  // `fail` exits the process, which skips `finally`: the exit hook releases in that case too.
  process.once("exit", lock.release);
  try {
    return fn(lock);
  } finally {
    lock.release();
  }
}

function dockerAvailable() {
  const r = spawnSync("docker", ["--version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

// One mechanism for every docker query: { lines } on success, { lines: null, reason } on failure,
// so a failed query is never mistaken for an empty result.
function dockerQuery(args) {
  const r = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.error || r.status !== 0) {
    const reason = String((r.error && r.error.message) || r.stderr || `exit ${r.status}`)
      .trim()
      .split("\n")[0];
    return { lines: null, reason };
  }
  return {
    lines: String(r.stdout)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

function dockerLines(args) {
  return dockerQuery(args).lines;
}

// The current image tag, or null when it cannot be computed (no claude, a plugin with no install):
// then prune removes no image, since it cannot tell which one is current.
function currentTagOrNull() {
  try {
    const out = capture("claude", ["--version"]);
    const m = out && /(\d+\.\d+\.\d+[^\s]*)/.exec(out);
    if (!m) return null;
    const { spec, missing } = rt.gatherImageSpec(root, {
      verifyCommand: verifyCommandOf(root),
      home: os.homedir(),
      uid: process.getuid(),
      gid: process.getgid(),
      claudeVersion: m[1],
      extraPackages: [],
    });
    return missing.length ? null : rt.imageTag(spec);
  } catch {
    return null;
  }
}

// `180`: remove this project's superseded worker images and stopped worker containers. Never an
// image a running container uses, another project's worker image, or a non-worker image. Always exits 0
// when there is nothing to do (no docker, host workers only).
function pruneCommand(dryRun) {
  if (!dockerAvailable()) {
    process.stdout.write("maestro worker prune: nothing needed removing (docker is not available)\n");
    return;
  }
  const listed = dockerLines(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"]);
  if (listed === null) {
    // The daemon did not answer: nothing was checked, so never claim nothing needed removing. Exit 0.
    process.stdout.write("maestro worker prune: nothing was checked or removed (docker could not be reached)\n");
    return;
  }
  const refs = listed.filter((r) => r.startsWith(rt.WORKER_IMAGE_PREFIX) && !r.endsWith(":<none>"));
  const images = [];
  const queryFailures = [];
  const currentTag = currentTagOrNull();
  let currentUninspected = false;
  for (const ref of refs) {
    const q = dockerQuery([
      "image",
      "inspect",
      "--format",
      // Read the whole Config as json and take Labels in JS: an image built without labels has no Labels
      // key, and any template that names `.Config.Labels` beside other fields errors on it in real docker.
      "{{.Id}}|{{.Size}}|{{json .Config}}",
      ref,
    ]);
    const line = q.lines && q.lines[0];
    // Never dropped silently: a failed or unreadable inspect is named, the image is never removed, exit 1.
    const unreadable = (why) => {
      queryFailures.push(`could not inspect image ${ref}: ${why}`);
      if (ref === currentTag) currentUninspected = true;
    };
    if (!line) {
      unreadable(q.reason || "no output");
      continue;
    }
    const first = line.indexOf("|");
    const second = first < 0 ? -1 : line.indexOf("|", first + 1);
    let config = null;
    if (second > 0) {
      try {
        config = JSON.parse(line.slice(second + 1));
      } catch {
        config = null;
      }
    }
    const id = second > 0 ? line.slice(0, first) : "";
    if (!id || !config || typeof config !== "object" || Array.isArray(config)) {
      unreadable("unreadable inspect output");
      continue;
    }
    const size = line.slice(first + 1, second);
    // A valid Config with no Labels key is an unlabelled image, not an error.
    const labels = config.Labels && typeof config.Labels === "object" ? config.Labels : null;
    const label = labels && typeof labels[rt.PROJECT_LABEL] === "string" ? labels[rt.PROJECT_LABEL] : "";
    images.push({ ref, id, bytes: Number(size) || 0, label: label || null });
  }
  const ps = dockerQuery(["ps", "-a", "--format", "{{.Names}}|{{.Image}}|{{.State}}"]);
  const containers = (ps.lines || []).map((l) => {
    const [name, image, state] = l.split("|");
    return { name, image, running: state === "running" };
  });
  // Without the container list, or without the current image's id (aliases of it could look removable),
  // nothing can be proven safe: plan over no images, so nothing is removed.
  const blind = ps.lines === null || currentUninspected;
  if (ps.lines === null)
    queryFailures.push(`docker ps failed: ${ps.reason}; could not list containers, so no image removed`);
  if (currentUninspected) queryFailures.push("the current image could not be inspected; no image removed");
  const plan = rt.planPrune({
    currentTag,
    projectLabel: rt.projectLabelFor(root),
    images: blind ? [] : images,
    containers: blind ? [] : containers,
  });
  plan.queryFailures = queryFailures;
  if (queryFailures.length) process.exitCode = 1;
  const note =
    currentTag === null && images.length
      ? "no image removed: this project's current image tag could not be computed"
      : undefined;
  if (!dryRun) {
    const failed = [];
    const tryRemove = (kind, name, args) => {
      const r = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] });
      if (!r.error && r.status === 0) return true;
      const reason = String((r.error && r.error.message) || r.stderr || "")
        .trim()
        .split("\n")[0];
      failed.push({ kind, name, reason });
      return false;
    };
    const goneContainers = plan.removeContainers.filter((c) => tryRemove("container", c.name, ["rm", c.name]));
    const goneImages = plan.removeImages.filter((i) => tryRemove("image", i.ref, ["image", "rm", i.ref]));
    const byId = new Map(goneImages.map((i) => [i.id, i.bytes]));
    plan.removeContainers = goneContainers;
    plan.removeImages = goneImages;
    plan.bytes = [...byId.values()].reduce((n, b) => n + b, 0);
    plan.failed = failed;
    // A removal docker refused is a partial failure: exit 1. No docker and nothing to remove stay 0.
    if (failed.length) process.exitCode = 1;
  }
  process.stdout.write(rt.formatPrune(plan, dryRun, note));
}

const argv = process.argv.slice(2);
const command = argv[0];
const { positional, flags, packages } = parse(argv.slice(1));
const root = mainCheckoutRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());

try {
  switch (command) {
    case "image": {
      let spec;
      try {
        spec = specFor(root, packages);
      } catch (err) {
        fail(err.message);
      }
      const tag = rt.imageTag(spec);
      if (flags["print-tag"]) {
        process.stdout.write(`${tag}\n`);
        break;
      }
      requireDocker();
      // `181`: one build or prune of a project's image at a time. The image is looked for AFTER the
      // lock is held, so a second build started at once waits, then finds the first one's image and
      // reuses it instead of building the same tag again.
      withWorkerLock("build", (lock) => {
        if (imageExists(tag)) {
          process.stdout.write(
            lock.waited
              ? `maestro worker image ${tag} was built by another build of this project while waiting; reusing it\n`
              : `maestro worker image ${tag} is up to date; reusing it\n`
          );
          return;
        }
        const ctx = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worker-image-"));
        try {
          rt.writeBuildContext(ctx, spec, { trackedFiles: gitTrackedFiles });
          process.stdout.write(`building maestro worker image ${tag}\n`);
          const b = spawnSync(
            "docker",
            ["build", "-t", tag, "--label", `${rt.PROJECT_LABEL}=${rt.projectLabelFor(root)}`, ctx],
            { stdio: "inherit" }
          );
          if (b.status !== 0) fail(`docker build failed (exit ${b.status})`);
        } finally {
          fs.rmSync(ctx, { recursive: true, force: true });
        }
        process.stdout.write(`built ${tag}\n`);
      });
      break;
    }
    case "run": {
      const name = flags.name;
      const taskArg = positional[0];
      if (!name || !taskArg)
        fail("usage: run --name <worker name> [--model <model>] <.claude/maestro-tasks/NNN-task.md>");
      // The token first: a missing file stops here, before docker is touched.
      const tokenPath = path.join(os.homedir(), rt.WORKER_TOKEN_REL);
      const token = rt.readWorkerToken(tokenPath);
      if (!token.ok) {
        process.stderr.write(`${token.message}\n`);
        process.exit(1);
      }
      const taskRel = path.posix.join(".claude", "maestro-tasks", path.basename(taskArg));
      if (!fs.existsSync(path.join(root, taskRel))) fail(`no such task file: ${taskRel}`);
      requireDocker();
      const spec = specFor(root, []);
      const tag = rt.imageTag(spec);
      if (!imageExists(tag))
        fail(
          `the worker image ${tag} does not exist. Build it first: node .claude/scripts/maestro-worker-runtime.cjs image`
        );

      // `176`: refuse an image that lacks a plugin the host session has enabled, instead of a worker
      // that stops mid-run on a missing agent. Shell-only: nothing of claude runs.
      const probe = spawnSync("docker", ["run", "--rm", "--entrypoint", "sh", tag, "-c", rt.imagePluginProbe(spec)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (probe.error || probe.status !== 0)
        fail(`cannot check the plugins in image ${tag}: ${String(probe.stderr || probe.error).trim()}`);
      const lacking = rt.parseProbeOutput(String(probe.stdout));
      if (lacking.length) fail(rt.missingPluginMessage(tag, lacking));

      const worktreePath = rt.worktreeMountPath(root, taskRel);
      if (worktreePath) fs.mkdirSync(worktreePath, { recursive: true });

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-worker-"));
      try {
        let filtered = null;
        const localPath = path.join(root, ".claude", "settings.local.json");
        if (fs.existsSync(localPath)) {
          filtered = path.join(tmp, "settings.local.json");
          try {
            fs.writeFileSync(filtered, rt.filterSettingsLocal(fs.readFileSync(localPath, "utf8")));
          } catch (err) {
            fail(`cannot prepare settings.local.json: ${err.message}`);
          }
        }
        // `177`: with manager_approval on, the approvals directory (outside the repo) is mounted
        // read-only, so a worker reads approval records and can never write one. Off: no mount.
        let approvals = null;
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
          if (rt.resolveManagerApproval(cfg)) {
            approvals = rt.approvalsDir(os.homedir());
            fs.mkdirSync(approvals, { recursive: true });
          }
        } catch {
          approvals = null;
        }
        const mounts = rt.workerMounts({
          repoRoot: root,
          worktreePath,
          filteredSettingsLocal: filtered,
          exists: (p) => fs.existsSync(p),
          approvalsDir: approvals,
        });
        const args = rt.workerRunArgs({
          tag,
          name,
          taskRel,
          model: flags.model,
          repoRoot: root,
          mounts,
          gitIdentity: {
            name: capture("git", ["-C", root, "config", "user.name"]) || undefined,
            email: capture("git", ["-C", root, "config", "user.email"]) || undefined,
          },
        });
        // `181`: record the worker's runtime and manager_approval in its epic's worker record NOW, from
        // the settings in force at this launch. The record is first-write-wins, so the manager's later
        // add-worker keeps it, and a later edit of maestro.json never changes this worker.
        try {
          const epics = require("./lib/maestro-epic.cjs");
          const slug = epics.epicOfTask(root, taskRel);
          if (slug)
            epics.addWorker(root, slug, name, taskRel, undefined, {
              runtime: "docker",
              manager_approval: approvals !== null,
            });
        } catch {
          // best effort: add-worker records the same settings afterwards
        }
        const r = spawnSync("docker", args, {
          stdio: "inherit",
          env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token.token },
        });
        process.exitCode = r.status === null ? 1 : r.status;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      break;
    }
    case "prune": {
      // `181`: a real prune waits for a build in progress (and a build waits for it). A dry run removes
      // nothing, so it never waits and never blocks a build.
      if (flags["dry-run"] === true) pruneCommand(true);
      else withWorkerLock("prune", () => pruneCommand(false));
      break;
    }
    default:
      fail(
        "usage: image [--with-package <name@version>]... [--print-tag] | run --name <name> [--model <m>] <task.md> | prune [--dry-run]"
      );
  }
} catch (err) {
  fail(err && err.message ? err.message : String(err));
}
