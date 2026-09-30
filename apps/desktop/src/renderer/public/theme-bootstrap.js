// Applied before first paint so the app never flashes the wrong theme.
//
// A separate file, not an inline <script> in index.html: the renderer CSP declared in that same
// file is `script-src 'self'`, which blocks inline execution outright. Inline, this ran nowhere —
// the browser logged a CSP violation and the theme was applied only later, when ThemeToggle
// mounted, which is exactly the flash it exists to prevent. Served from `public/` it is a
// same-origin script the policy allows, with no 'unsafe-inline' and no per-edit CSP hash to keep
// in sync. Keep it a classic (parser-blocking) script in <head> so it runs before the body paints.
//
// Deliberately duplicates the logic in @repo/ui's theme-toggle: that one runs in a React effect,
// which is far too late for this purpose.
(function () {
  try {
    var stored = window.localStorage.getItem("theme");
    var mode = stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var resolved = mode === "auto" ? (prefersDark ? "dark" : "light") : mode;
    var root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    root.style.colorScheme = resolved;
  } catch (e) {}
})();
