# @repo/ui

Shared React component library for the monorepo. Consumed by `apps/maestro` — the only app left
since `apps/help-server` was folded into it, though nothing here assumes that.

## Conventions

- **One component per file.** Kebab-case filenames, `default export` from each file.
- **No domain knowledge.** Anything here must be reusable across apps. Domain-specific composition (e.g. `SkillTemplatePreview` for the skill creation form) lives in the consuming app, not here.
- **Icons are props, not deps.** Components accept `ReactNode` for icons (e.g. `icon`, `titleIcon`, `fileIcon`). The package does NOT depend on `lucide-react` or any icon library — that lives in the consuming app. Convention follows `dialog.tsx`'s inline-SVG close button and `mode-pill.tsx`'s `icon` prop.
- **Tailwind for styling.** Uses CSS custom properties from `@repo/styles` (`var(--ink)`, `var(--bg-elev)`, `var(--primary)`, `var(--line)`, etc.). Don't hard-code colors — pull them from those tokens so apps can theme.
- **Base UI for primitives.** `dialog.tsx` wraps `@base-ui/react/dialog` — the only runtime dep. Use Base UI rather than rolling new accessibility primitives.

## Component map

| Component          | Purpose                                                                                                                                                                         | Notable props                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `button`           | Primary / ghost button with optional icon + loading state                                                                                                                       | `variant`, `icon`, `loading`                                       |
| `chip-input`       | Tag/chip input that emits `string[]` — Enter to add                                                                                                                             | `values`, `onChange` (note: `values`, not `value`)                 |
| `copyable-text`    | Inline text with a copy button                                                                                                                                                  | —                                                                  |
| `dialog`           | Base UI dialog shell with optional title row + close button                                                                                                                     | `open`, `onOpenChange`, `title`, `titleIcon`, `widthClass`         |
| `field`            | Labeled form row with hint + error slot; exports `Field`, `Input`, `Textarea`                                                                                                   | `label`, `hint`, `error`                                           |
| `file-preview`     | "Fake editor" chrome with numbered lines + syntax-highlighted rendering                                                                                                         | `filename`, `fileIcon`, `path`, `lines` (or `children` for custom) |
| `mode-pill`        | Animated segmented control for picking among 2–N values                                                                                                                         | `value`, `onChange`, `options: { value, label, icon? }[]`          |
| `select`           | Styled Base UI Select with `{ id, name }[]` options                                                                                                                             | `value`, `options`, `onChange`                                     |
| `shortcuts-dialog` | Pre-built dialog rendering `{ title, items: [label, keys][] }[]` sections                                                                                                       | `sections`, optional `title`, `titleIcon`                          |
| `slide-panel`      | Right-side slide-out panel                                                                                                                                                      | —                                                                  |
| `syntax-line`      | Renders a single line of YAML or JSON with key-highlighting; used by `file-preview`                                                                                             | `raw`                                                              |
| `theme-toggle`     | Light/dark theme switcher                                                                                                                                                       | —                                                                  |
| `toast`            | Transient bottom-right notifications. Named exports (not a default): imperative `toast(message, { variant?, duration? })` + a `<Toaster />` portal mounted once at the app root | `message`, `variant`, `duration`                                   |

## Adding a new component

1. Create `src/<kebab-name>.tsx` with a single default export.
2. Add it to `exports` in `package.json`: `"./<kebab-name>": "./src/<kebab-name>.tsx"`.
3. Keep props minimal and generic — if the API is leaking domain concerns, the component probably belongs in the consuming app.
4. Accept icons as `ReactNode` props rather than importing an icon library here.
5. Use CSS variables from `@repo/styles` for any color/border/shadow — never hard-code.

## When something doesn't fit here

If a component needs domain knowledge (filenames, payload shapes, route paths, marketplace concepts, etc.), put it in `apps/<app>/src/components/` instead. `@repo/ui` is the lowest common denominator.
