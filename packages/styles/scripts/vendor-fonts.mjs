#!/usr/bin/env node
/**
 * Re-vendors the self-hosted UI fonts under `packages/styles/fonts/`.
 *
 * The shared style sheet used to `@import` Google's CDN, which the Electron renderer's
 * `default-src 'self'` CSP blocks outright. This script downloads the exact same files the CDN
 * would have served and writes them into the repo, plus a generated `fonts.css` whose
 * `@font-face` rules point at them with relative URLs.
 *
 * Run it from anywhere:  node packages/styles/scripts/vendor-fonts.mjs
 *
 * Everything under `fonts/` and `fonts.css` is generated — edit this file, not the output.
 * To add or drop a weight, change FAMILIES below and re-run; the script deletes any vendored
 * file it did not just write, so removals actually shrink the payload.
 */
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = resolve(PACKAGE_ROOT, "fonts");

/**
 * A Chrome UA is required: the CSS API serves woff2 only to browsers it recognises, and falls
 * back to ttf (roughly twice the size) for anything else — including curl and Node's default.
 */
const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Only the weights and styles the codebase actually references, and only the Latin subsets.
 * The API also serves cyrillic/greek/vietnamese/math/symbols cuts of every face; the UI is
 * Latin-only, and `unicode-range` means those cuts would never download anyway — so they are
 * filtered out rather than committed as dead weight.
 *
 * `expect` is asserted against what the API returns so a silent upstream change (a dropped
 * weight, a renamed family) fails the refresh instead of quietly shipping fewer faces.
 */
const SUBSETS = ["latin", "latin-ext"];
const FAMILIES = [
  {
    family: "Inter",
    slug: "inter",
    spec: "Inter:wght@300;400;500;600;700",
    licenceDir: "inter",
    expect: [
      { weight: "300", style: "normal" },
      { weight: "400", style: "normal" },
      { weight: "500", style: "normal" },
      { weight: "600", style: "normal" },
      { weight: "700", style: "normal" },
    ],
  },
  {
    family: "Bodoni Moda",
    slug: "bodoni-moda",
    spec: "Bodoni+Moda:ital,opsz,wght@1,6..96,600;1,6..96,700",
    licenceDir: "bodonimoda",
    expect: [
      { weight: "600", style: "italic" },
      { weight: "700", style: "italic" },
    ],
  },
  {
    family: "IBM Plex Mono",
    slug: "ibm-plex-mono",
    spec: "IBM+Plex+Mono:wght@300;400;500;600",
    licenceDir: "ibmplexmono",
    expect: [
      { weight: "300", style: "normal" },
      { weight: "400", style: "normal" },
      { weight: "500", style: "normal" },
      { weight: "600", style: "normal" },
    ],
  },
];

const LICENCE_URL = (dir) => `https://raw.githubusercontent.com/google/fonts/main/ofl/${dir}/OFL.txt`;
const CSS_URL = (spec) => `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;

/** Each `@font-face` block in the API response is preceded by a `/* subset *\/` comment. */
const FACE_RE = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.text();
}

function parseFaces(css) {
  const declaration = (block, prop) => block.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`))?.[1].trim();

  return [...css.matchAll(FACE_RE)].map(([, subset, block]) => ({
    subset,
    family: declaration(block, "font-family")?.replace(/['"]/g, ""),
    style: declaration(block, "font-style"),
    weight: declaration(block, "font-weight"),
    display: declaration(block, "font-display"),
    unicodeRange: declaration(block, "unicode-range"),
    url: block.match(/src:\s*url\(([^)]+)\)/)?.[1],
  }));
}

async function main() {
  await mkdir(FONT_DIR, { recursive: true });
  const written = new Set();
  const rules = [];

  for (const { family, slug, spec, licenceDir, expect } of FAMILIES) {
    const faces = parseFaces(await fetchText(CSS_URL(spec), { "User-Agent": CHROME_UA })).filter((face) =>
      SUBSETS.includes(face.subset)
    );

    /**
     * Inter and Bodoni Moda are variable fonts: the API answers every requested weight of a
     * given style+subset with the *same* file, because one binary already spans the axis.
     * Writing one copy per weight would commit five identical 48 kB blobs for Inter alone, so
     * faces are grouped by the file they resolve to and collapsed into a single `@font-face`
     * with a `font-weight: <min> <max>` range. IBM Plex Mono is static and groups of one fall
     * through unchanged — if upstream ever flips a family the other way, this follows it.
     */
    const groups = new Map();
    for (const { weight, style } of expect) {
      for (const subset of SUBSETS) {
        const face = faces.find(
          (candidate) =>
            candidate.family === family &&
            candidate.weight === weight &&
            candidate.style === style &&
            candidate.subset === subset
        );
        if (!face) throw new Error(`${family} ${weight} ${style} ${subset}: not served by the API`);
        if (!face.url?.endsWith(".woff2")) {
          throw new Error(`${family} ${weight} ${style} ${subset}: expected woff2, got ${face.url}`);
        }

        const group = groups.get(face.url) ?? { face, weights: [] };
        group.weights.push(Number(weight));
        groups.set(face.url, group);
      }
    }

    for (const [url, { face, weights }] of groups) {
      const span = [Math.min(...weights), Math.max(...weights)];
      const label = span[0] === span[1] ? `${span[0]}` : span.join("-");
      const file = `${slug}-${face.subset}-${label}-${face.style}.woff2`;

      const body = await fetch(url).then((res) => res.arrayBuffer());
      await writeFile(resolve(FONT_DIR, file), Buffer.from(body));
      written.add(file);

      rules.push(
        [
          "@font-face {",
          `  font-family: '${family}';`,
          `  font-style: ${face.style};`,
          `  font-weight: ${span[0] === span[1] ? span[0] : span.join(" ")};`,
          `  font-display: ${face.display ?? "swap"};`,
          `  src: url('./fonts/${file}') format('woff2');`,
          `  unicode-range: ${face.unicodeRange};`,
          "}",
        ].join("\n")
      );
    }

    const licence = `${slug}-OFL.txt`;
    await writeFile(resolve(FONT_DIR, licence), await fetchText(LICENCE_URL(licenceDir)));
    written.add(licence);
  }

  for (const stale of await readdir(FONT_DIR)) {
    if (!written.has(stale)) await rm(resolve(FONT_DIR, stale), { recursive: true });
  }

  await writeFile(
    resolve(PACKAGE_ROOT, "fonts.css"),
    [
      "/*",
      " * GENERATED by scripts/vendor-fonts.mjs — do not edit by hand.",
      " *",
      " * Self-hosted so the Electron renderer's `font-src 'self' data:` CSP is satisfied without",
      " * loosening it, and so typography does not depend on the network at launch. See README.md.",
      " */",
      "",
      ...rules,
      "",
    ].join("\n")
  );

  console.log(`vendored ${written.size} files into ${FONT_DIR}`);
}

await main();
