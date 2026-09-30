import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `electron` must be externalized explicitly, via `rollupOptions.external`.
 *
 * `externalizeDepsPlugin` derives its externals from package.json `dependencies`, and `electron`
 * is a devDependency — correctly so, since the runtime comes from the Electron binary rather than
 * being shipped in the app. So the plugin does not cover it, and what then gets bundled is the
 * npm package's Node-side shim: a module whose entire body is `module.exports = getElectronPath()`,
 * resolving `path.txt` relative to `__dirname`. Inlined into `out/main/index.js` that runs at
 * import time, finds no `path.txt` beside the bundle, and throws "Electron failed to install
 * correctly, please delete node_modules/electron and try installing again" — which sends you off
 * to reinstall node_modules for what is purely a bundling mistake. The app cannot start at all.
 *
 * The plugin's own `include` option is the documented lever for this and does NOT work here
 * (verified under vite 8.0.0 / electron-vite 4: it mutates `config.build` from inside the
 * `config` hook, and that no longer reaches the resolved ssr environment). Hence the direct
 * `external` below. `test/isolation.test.ts` asserts the built bundles import electron rather
 * than inlining the shim, because this failure is invisible until the app is launched.
 */
const ELECTRON_EXTERNAL = ["electron"];

/**
 * Runtime `dependencies`, externalized BY HAND — because `externalizeDepsPlugin` does not do it.
 *
 * This is the same vite 8 / electron-vite 4 bug documented above for the plugin's `include`
 * option, and it turns out to cost the whole plugin: `externalizeDepsPlugin` computes its external
 * list from `dependencies` and then assigns `config.build` from inside the `config` hook, which no
 * longer reaches the resolved ssr environment. The list is simply dropped. An empty list is
 * indistinguishable from an ignored one, which is how this goes unnoticed until a dependency
 * with a real artifact on disk shows up.
 *
 * Here that dependency is `code-graph`: its dist imports `node:sqlite` and ts-morph-free modules
 * and is meant to be resolved from node_modules at runtime, not inlined into `out/main/`.
 *
 * Derived from the manifest rather than listed here, so a dependency added tomorrow is external
 * without anyone remembering this file. The regex covers subpath imports (`<pkg>/config`), which
 * a bare name does not. `test/isolation.test.ts` asserts the built bundle carries the specifier
 * rather than the source.
 */
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
const RUNTIME_DEPS: string[] = Object.keys(pkg.dependencies ?? {});
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EXTERNAL = [
  ...ELECTRON_EXTERNAL,
  ...RUNTIME_DEPS,
  ...(RUNTIME_DEPS.length ? [new RegExp(`^(${RUNTIME_DEPS.map(escape).join("|")})/`)] : []),
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: EXTERNAL,
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The preload imports nothing but electron and the shared contract, and keeping it that
        // way is what makes the bridge auditable — so it gets the electron entry, not EXTERNAL.
        external: ELECTRON_EXTERNAL,
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [
      tailwindcss(),
      tanstackRouter({
        target: "react",
        routesDirectory: resolve(__dirname, "src/renderer/src/routes"),
        generatedRouteTree: resolve(__dirname, "src/renderer/src/routeTree.gen.ts"),
        // Routes are plain components under a hash history — there is no SSR shell in Electron.
        // Chunks resolve relatively (`base: "./"`), which is what makes splitting safe for the
        // packaged `file://` load — a build that regressed `base` to "/" would leave routes blank
        // in the packaged app while dev, served over http, stayed perfectly happy.
        autoCodeSplitting: true,
      }),
      viteReact(),
    ],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
    },
  },
});
