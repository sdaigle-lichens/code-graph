import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePnpmWorkspaceYaml,
  parsePackageJsonWorkspaces,
  inferFileKind,
  computeFanInOut,
  flagHubs,
  computeGlobCoverage,
  detectOverlaps,
  detectWorkspaceUnits,
  type FsAdapter,
  type ImportEdge,
} from "./catalog.js";

// ─── parsePnpmWorkspaceYaml ───────────────────────────────────────────────────

describe("parsePnpmWorkspaceYaml", () => {
  it("parses single-quoted glob patterns", () => {
    const yaml = "packages:\n  - 'apps/*'\n  - 'packages/*'\n";
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*", "packages/*"]);
  });

  it("parses double-quoted patterns", () => {
    const yaml = 'packages:\n  - "apps/*"\n';
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*"]);
  });

  it("parses unquoted patterns", () => {
    const yaml = "packages:\n  - apps/*\n  - packages/*\n";
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*", "packages/*"]);
  });

  it("ignores exclusion patterns starting with !", () => {
    const yaml = "packages:\n  - 'apps/*'\n  - '!apps/legacy'\n";
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*"]);
  });

  it("stops at next top-level key", () => {
    const yaml = "packages:\n  - 'apps/*'\noptions:\n  some: value\n";
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*"]);
  });

  it("returns empty array when no packages key", () => {
    assert.deepEqual(parsePnpmWorkspaceYaml("name: foo\nversion: 1.0\n"), []);
  });

  it("handles Windows CRLF line endings", () => {
    const yaml = "packages:\r\n  - 'apps/*'\r\n  - 'packages/*'\r\n";
    assert.deepEqual(parsePnpmWorkspaceYaml(yaml), ["apps/*", "packages/*"]);
  });
});

// ─── parsePackageJsonWorkspaces ───────────────────────────────────────────────

describe("parsePackageJsonWorkspaces", () => {
  it("parses array form", () => {
    const pkg = { workspaces: ["apps/*", "packages/*"] };
    assert.deepEqual(parsePackageJsonWorkspaces(pkg), ["apps/*", "packages/*"]);
  });

  it("parses Yarn Berry / npm nested { packages: [...] } form", () => {
    const pkg = { workspaces: { packages: ["apps/*"], nohoist: [] } };
    assert.deepEqual(parsePackageJsonWorkspaces(pkg), ["apps/*"]);
  });

  it("returns empty array when no workspaces field", () => {
    assert.deepEqual(parsePackageJsonWorkspaces({ name: "foo" }), []);
  });

  it("returns empty array when workspaces is not an array or object", () => {
    assert.deepEqual(parsePackageJsonWorkspaces({ workspaces: "apps/*" }), []);
  });

  it("filters non-string elements from array", () => {
    const pkg = { workspaces: ["apps/*", 42, null, "packages/*"] };
    assert.deepEqual(parsePackageJsonWorkspaces(pkg), ["apps/*", "packages/*"]);
  });
});

// ─── inferFileKind ────────────────────────────────────────────────────────────

describe("inferFileKind", () => {
  it("detects test files by extension pattern", () => {
    assert.equal(inferFileKind("src/foo.test.ts", []), "test");
    assert.equal(inferFileKind("src/foo.spec.tsx", []), "test");
  });

  it("detects index files", () => {
    assert.equal(inferFileKind("src/index.ts", []), "index");
    assert.equal(inferFileKind("src/components/index.tsx", []), "index");
  });

  it("detects config files by extension", () => {
    assert.equal(inferFileKind("vite.config.ts", []), "config");
    assert.equal(inferFileKind(".eslintrc.js", []), "config");
  });

  it("detects type definition files", () => {
    assert.equal(inferFileKind("src/foo.types.ts", []), "types");
    assert.equal(inferFileKind("src/foo.d.ts", []), "types");
  });

  it("detects store files by naming convention", () => {
    assert.equal(inferFileKind("src/store/workorder.store.ts", []), "store");
    assert.equal(inferFileKind("src/WorkorderStore.ts", []), "store");
  });

  it("detects hooks by filename prefix", () => {
    assert.equal(inferFileKind("src/hooks/useWorkorder.ts", []), "hook");
  });

  it("detects hooks by exported names even if filename is plain", () => {
    assert.equal(inferFileKind("src/hooks/workorder-hooks.ts", ["useWorkorderList", "useWorkorderActions"]), "hook");
  });

  it("detects components by uppercase export names", () => {
    assert.equal(inferFileKind("src/components/Scheduler.tsx", ["Scheduler", "SchedulerProps"]), "component");
  });

  it("falls back to module for plain files", () => {
    assert.equal(inferFileKind("src/utils/dates.ts", ["formatDate", "parseDate"]), "module");
  });
});

// ─── computeFanInOut ─────────────────────────────────────────────────────────

describe("computeFanInOut", () => {
  it("computes fan-in and fan-out from edges", () => {
    const imports: ImportEdge[] = [
      { from: "a.ts", to: "b.ts" },
      { from: "a.ts", to: "c.ts" },
      { from: "b.ts", to: "c.ts" },
      { from: "d.ts", to: "c.ts" },
    ];
    const { fanIn, fanOut } = computeFanInOut(imports);
    assert.equal(fanOut["a.ts"], 2);
    assert.equal(fanOut["b.ts"], 1);
    assert.equal(fanOut["d.ts"], 1);
    assert.equal(fanIn["b.ts"], 1);
    assert.equal(fanIn["c.ts"], 3);
    assert.equal(fanIn["a.ts"], undefined, "a.ts has no incoming imports");
  });

  it("returns empty objects for no edges", () => {
    const { fanIn, fanOut } = computeFanInOut([]);
    assert.deepEqual(fanIn, {});
    assert.deepEqual(fanOut, {});
  });
});

// ─── flagHubs ─────────────────────────────────────────────────────────────────

describe("flagHubs", () => {
  it("flags files at or above the threshold", () => {
    const fanIn = { "a.ts": 10, "b.ts": 5, "c.ts": 4, "d.ts": 1 };
    const hubs = flagHubs(fanIn, 5);
    assert.ok(hubs.includes("a.ts"));
    assert.ok(hubs.includes("b.ts"));
    assert.ok(!hubs.includes("c.ts"), "below threshold");
    assert.ok(!hubs.includes("d.ts"));
  });

  it("returns hubs sorted by fan-in descending", () => {
    const fanIn = { "z.ts": 3, "a.ts": 10, "m.ts": 7 };
    const hubs = flagHubs(fanIn, 3);
    assert.equal(hubs[0], "a.ts");
    assert.equal(hubs[1], "m.ts");
    assert.equal(hubs[2], "z.ts");
  });

  it("returns empty when all below threshold", () => {
    assert.deepEqual(flagHubs({ "a.ts": 1, "b.ts": 2 }, 5), []);
  });

  it("uses default threshold of 5", () => {
    const fanIn = { "a.ts": 5, "b.ts": 4 };
    const hubs = flagHubs(fanIn);
    assert.ok(hubs.includes("a.ts"));
    assert.ok(!hubs.includes("b.ts"));
  });
});

// ─── computeGlobCoverage ──────────────────────────────────────────────────────

describe("computeGlobCoverage", () => {
  const files = [
    "src/store/workorder.store.ts",
    "src/hooks/useWorkorder.ts",
    "src/components/Scheduler.tsx",
    "src/utils/dates.ts",
  ];

  it("matches files by glob pattern", () => {
    const matched = computeGlobCoverage(files, ["src/store/**"]);
    assert.deepEqual(matched, ["src/store/workorder.store.ts"]);
  });

  it("matches across multiple globs (union)", () => {
    const matched = computeGlobCoverage(files, ["src/store/**", "src/hooks/**"]);
    assert.equal(matched.length, 2);
  });

  it("returns empty for no matches", () => {
    assert.deepEqual(computeGlobCoverage(files, ["src/api/**"]), []);
  });

  it("returns all files for a catch-all glob", () => {
    assert.equal(computeGlobCoverage(files, ["**"]).length, files.length);
  });
});

// ─── detectOverlaps ──────────────────────────────────────────────────────────

describe("detectOverlaps", () => {
  const files = [
    "src/store/a.ts",
    "src/shared/dates.ts",
    "src/hooks/useA.ts",
    "src/hooks/useB.ts",
  ];

  it("detects a file in two concepts", () => {
    const globs = {
      conceptA: ["src/store/**", "src/shared/**"],
      conceptB: ["src/hooks/**", "src/shared/**"],
    };
    const overlaps = detectOverlaps(globs, files);
    assert.deepEqual(overlaps["src/shared/dates.ts"]?.sort(), ["conceptA", "conceptB"]);
  });

  it("returns empty when no overlaps", () => {
    const globs = {
      conceptA: ["src/store/**"],
      conceptB: ["src/hooks/**"],
    };
    const overlaps = detectOverlaps(globs, files);
    assert.deepEqual(overlaps, {});
  });

  it("a file in three concepts is recorded correctly", () => {
    const globs = {
      a: ["src/shared/**"],
      b: ["src/shared/**"],
      c: ["src/shared/**"],
    };
    const overlaps = detectOverlaps(globs, files);
    assert.equal(overlaps["src/shared/dates.ts"]?.length, 3);
  });
});

// ─── detectWorkspaceUnits — via FsAdapter ────────────────────────────────────

describe("detectWorkspaceUnits — pnpm-workspace.yaml", () => {
  const makeFs = (yamlContent: string, dirs: Record<string, string[]>): FsAdapter => ({
    exists: (p) => Object.keys(dirs).some((d) => p === d || p.startsWith(d + "/")),
    readText: (p) => {
      if (p.endsWith("pnpm-workspace.yaml")) return yamlContent;
      return null;
    },
    readJson: (p) => {
      if (p.endsWith("package.json")) {
        const dir = p.slice(0, -"/package.json".length);
        const name = dir.split("/").at(-1) ?? "pkg";
        return { name };
      }
      return null;
    },
    listDirs: (p) => dirs[p] ?? [],
  });

  it("discovers units from pnpm-workspace.yaml", () => {
    const root = "/repo";
    const fs = makeFs("packages:\n  - 'apps/*'\n  - 'packages/*'\n", {
      [`${root}/apps`]: ["web", "api"],
      [`${root}/packages`]: ["ui-kit"],
    });
    const units = detectWorkspaceUnits(root, fs);
    const names = units.map((u) => u.name);
    assert.ok(names.includes("web"));
    assert.ok(names.includes("api"));
    assert.ok(names.includes("ui-kit"));
  });
});

describe("detectWorkspaceUnits — package.json workspaces", () => {
  it("discovers units from package.json workspaces array", () => {
    const root = "/repo";
    const fs: FsAdapter = {
      exists: () => true,
      readText: () => null,
      readJson: (p) => {
        if (p === `${root}/package.json`) return { workspaces: ["apps/*"] };
        const name = p.split("/").at(-2) ?? "pkg";
        return { name };
      },
      listDirs: (p) => (p.endsWith("/apps") ? ["web", "mobile"] : []),
    };
    const units = detectWorkspaceUnits(root, fs);
    const names = units.map((u) => u.name);
    assert.ok(names.includes("web"));
    assert.ok(names.includes("mobile"));
  });
});

describe("detectWorkspaceUnits — turbo.json / convention", () => {
  it("falls back to apps/* + packages/* convention when turbo.json present", () => {
    const root = "/repo";
    const fs: FsAdapter = {
      exists: (p) =>
        p === `${root}/turbo.json` ||
        p === `${root}/apps` ||
        p === `${root}/packages`,
      readText: () => null,
      readJson: (p) => {
        if (p.endsWith("package.json")) {
          const name = p.split("/").at(-2) ?? "pkg";
          return { name };
        }
        return null;
      },
      listDirs: (p) => {
        if (p.endsWith("/apps")) return ["web"];
        if (p.endsWith("/packages")) return ["ui"];
        return [];
      },
    };
    const units = detectWorkspaceUnits(root, fs);
    const names = units.map((u) => u.name);
    assert.ok(names.includes("web"));
    assert.ok(names.includes("ui"));
  });
});

describe("detectWorkspaceUnits — single-package fallback", () => {
  it("returns root unit when no workspace indicators", () => {
    const root = "/repo";
    const fs: FsAdapter = {
      exists: () => false,
      readText: () => null,
      readJson: (p) => (p === `${root}/package.json` ? { name: "my-app" } : null),
      listDirs: () => [],
    };
    const units = detectWorkspaceUnits(root, fs);
    assert.equal(units.length, 1);
    assert.equal(units[0].name, "root");
    assert.equal(units[0].packageName, "my-app");
  });
});
