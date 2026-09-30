# @repo/styles

The shared design system: Tailwind theme wiring, Sass partials, and the three UI typefaces.

Consumed by `apps/maestro`, which does `@import '@repo/styles/shared-styles.css'` from its own
entry stylesheet. `apps/help-server` was the second consumer until it was folded into Maestro.

## Fonts are vendored, not fetched

`fonts.css` and everything under `fonts/` are **generated**. Regenerate them with:

```bash
node packages/styles/scripts/vendor-fonts.mjs
```

Do not edit either by hand, and do not put a `fonts.googleapis.com` `@import` back.

### Why

`shared-styles.css` used to open with an `@import` of Google's CSS API. The Maestro renderer
declares `default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:`, which that
request satisfies in no respect — so it was blocked on **every** load, the app rendered in
Ubuntu Sans and Liberation Mono instead of Inter and IBM Plex Mono, and the violation was the only
console error in an otherwise clean run.

The three rejected alternatives, so they are not re-proposed:

- **Widen the CSP** to allow `fonts.googleapis.com` + `fonts.gstatic.com`. Contradicts the
  policy's own stated intent in `apps/maestro/src/renderer/index.html` ("this app needs neither at
  runtime"), and makes a desktop app that opens local folders depend on the network to render text.
- **Drop the `@import`** and live with system fonts. Silently changes the look of every app in the
  monorepo.
- **Depend on `@fontsource/*` packages.** Works, but puts the files behind a lockfile update
  rather than in the repo, and the licence terms then live in `node_modules`.

### Provenance

The files come from Google's CSS API — byte-for-byte what the CDN was serving before, so the
typography is unchanged from what the `@import` intended. The script requests exactly the faces
the codebase references:

| Family        | Faces requested                 | Used by                                           |
| ------------- | ------------------------------- | ------------------------------------------------- |
| Inter         | 300, 400, 500, 600, 700 upright | `--font-sans` — nearly all UI text                |
| Bodoni Moda   | 600, 700 **italic**             | `--font-serif` — `.display-title`, `.display-num` |
| IBM Plex Mono | 300, 400, 500, 600 upright      | `--font-mono` — paths, commands, `<kbd>`          |

All three are **SIL Open Font License 1.1**, which permits redistribution (bundling with software
is explicitly allowed; the licence text must travel with the files). The upstream `OFL.txt` for
each is committed as `fonts/<family>-OFL.txt`.

Two things keep the payload honest, and both are worth understanding before adding a weight:

- **Only the Latin cuts are vendored.** The API also serves cyrillic, greek, vietnamese, math and
  symbol cuts of every face. Their `unicode-range` means a browser would never download them for
  this UI, so committing them would be pure dead weight. `latin` and `latin-ext` are kept — the
  latter covers accented European text in project paths.
- **Inter and Bodoni Moda are variable fonts**: one binary spans the whole weight axis, and the
  API answers every requested weight with the _same_ file. The script groups faces by the file
  they resolve to and emits a single `@font-face` with a `font-weight: 300 700` range, rather than
  five identical copies of a 48 kB blob. IBM Plex Mono is static, so its four weights are four
  files. This is why `fonts/` holds 12 files for 11 logical faces rather than 22.

Total: ~372 kB on disk.

### Adding, changing, or removing a weight

1. Edit the `FAMILIES` list in `scripts/vendor-fonts.mjs` — specifically the `spec` (the CSS API
   query) and the matching `expect` entries.
2. Re-run the script. It rewrites `fonts.css` and deletes any file under `fonts/` it did not just
   write, so a removal actually shrinks the payload.
3. Rebuild a consumer and confirm the new face is _painted_, not merely declared — see below.

`expect` is asserted against what the API returns, so a family renamed or a weight withdrawn
upstream fails the refresh loudly instead of quietly shipping fewer faces than the CSS asks for.

### Verifying

`getComputedStyle(el).fontFamily` only echoes the CSS back; it says nothing about whether the file
loaded, and reads identically when everything has fallen back to a system font. The real check is
which fonts the engine _painted with_ — CDP's `CSS.getPlatformFontsForNode`, driven through the
`test-maestro-desktop` skill's harness. That is how this change was verified in both a packaged
`file://` window and an HTTP-served one.

`apps/maestro/test/isolation.test.ts` pins the cheap half: the built renderer CSS references
nothing off-origin, and the woff2 files are emitted beside it.

### The `file://` / HTTP split

`fonts.css` uses relative `url('./fonts/…')`, which a consumer's bundler rewrites for its own
`base`. Maestro emits `url(./x.woff2)` because a packaged Electron build loads over `file://` with
`base: "./"`; the two web apps this package used to serve — help-server and ai-tools-manager, both
now folded into Maestro — emitted `url(/assets/x.woff2)` for an HTTP root, and both paths were
checked in a running window. Maestro is the only consumer left, so only the `file://` path is
exercised today: a change here that assumes it is the only one will break the next HTTP-served
consumer while looking perfectly fine.
