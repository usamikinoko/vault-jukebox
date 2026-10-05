/*
 * The smoke-test harness: assertion counters, boot/open helpers, the media
 * clock, and the preview-page writer.
 */

require("./env.cjs");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { ctx, app } = require("./stub.cjs");

const ROOT = path.join(__dirname, "..", "..");
const ARTIFACT = path.join(ROOT, "main.js");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

let passed = 0;
function check(label, actual, expected) {
  assert.deepStrictEqual(
    actual,
    expected,
    `${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`
  );
  passed++;
}
function ok(label, condition) {
  assert.ok(condition, `${label}`);
  passed++;
}
function tally() {
  return passed;
}
function textOf(el) {
  return (el.textContent ?? "").trim();
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * jsdom's media element has no clock. Replacing `currentTime`/`duration` with
 * plain values is what lets seek/restore be asserted as arithmetic instead of
 * being waved through — without it every position reads 0 and the test would
 * "pass" against a plugin that never seeks at all.
 */
function installClock(audio, duration) {
  let time = 0;
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    get: () => time,
    set: (value) => {
      time = value;
    },
  });
  Object.defineProperty(audio, "duration", {
    configurable: true,
    get: () => duration,
  });
}

/** Row/tree probes shared by every group. */
const rowsOf = (view) => [...view.listEl.querySelectorAll(".mp-row")];
const rowTitles = (view) => rowsOf(view).map((el) => textOf(el.querySelector(".mp-row-title")));
const rowPaths = (view) => rowsOf(view).map((el) => el.getAttribute("data-path"));
const treeNames = (view) =>
  [...view.treeEl.querySelectorAll(".mp-tree-row .mp-tree-name")].map(textOf);

function resetContext() {
  ctx.notices.length = 0;
  ctx.modals.length = 0;
  ctx.menus.length = 0;
  ctx.leaves.length = 0;
  ctx.views.length = 0;
  ctx.viewCreators.clear();
}

/**
 * Boot a fresh plugin instance. The artefact is required lazily so the
 * `obsidian` module hook is guaranteed to be in place first.
 */
async function boot(data) {
  resetContext();
  // eslint-disable-next-line global-require
  const bundle = require(ARTIFACT);
  const VaultJukeboxPlugin = bundle.default ?? bundle;
  const plugin = new VaultJukeboxPlugin(app, MANIFEST);
  plugin._data = data;
  await plugin.onload();
  return plugin;
}

/** Open the view the way the ribbon does and hand back the live view. */
async function openView(plugin) {
  await plugin.activateView();
  const leaf = ctx.leaves[ctx.leaves.length - 1];
  return { leaf, view: leaf.view };
}

// ------------------------------------------------------------- previews

/** Stand-in for Obsidian's icon set, and no more: a 16px block in `currentColor`. */
const PREVIEW_ICON_CSS = `
[data-icon]::before {
  content: ""; display: block; width: 16px; height: 16px;
  border-radius: 3px; background: currentColor; opacity: 0.45;
}
.mp-play[data-icon]::before { width: 18px; height: 18px; }
.mp-transport[data-icon]::before { width: 17px; height: 17px; }
.mp-status-icon[data-icon]::before, .mp-icon[data-icon]::before { width: 14px; height: 14px; }
.mp-sort-btn .mp-icon[data-icon]::before { width: 13px; height: 13px; }
.mp-check[data-icon]::before { width: 11px; height: 11px; border-radius: 2px; }
.mp-empty-icon[data-icon]::before { width: 24px; height: 24px; border-radius: 4px; }
`;

const PREVIEW_LIGHT_VARS = `
  --background-primary: #ffffff;
  --background-secondary: #f6f6f6;
  --background-modifier-border: #e0e0e0;
  --background-modifier-border-hover: #c8c8c8;
  --background-modifier-hover: rgba(0, 0, 0, 0.055);
  --background-modifier-active-hover: rgba(0, 0, 0, 0.09);
  --interactive-accent: #705dcf;
  --interactive-accent-hover: #7f6fe0;
  --text-on-accent: #ffffff;
  --text-normal: #2e3338;
  --text-muted: #6b7280;
  --text-faint: #9aa0a6;
  --text-accent: #705dcf;
  --text-error: #e93147;
  --font-ui-smaller: 12px;
  --font-ui-small: 13px;
  --font-ui-medium: 15px;
`;

const PREVIEW_DARK_VARS = `
  --background-primary: #1e1e1e;
  --background-secondary: #262626;
  --background-modifier-border: #333333;
  --background-modifier-border-hover: #4a4a4a;
  --background-modifier-hover: rgba(255, 255, 255, 0.055);
  --background-modifier-active-hover: rgba(255, 255, 255, 0.09);
  --interactive-accent: #7f6df2;
  --interactive-accent-hover: #9081f5;
  --text-on-accent: #ffffff;
  --text-normal: #dcddde;
  --text-muted: #a0a0a0;
  --text-faint: #787878;
  --text-accent: #a3a6ff;
  --text-error: #ff6b6b;
  --font-ui-smaller: 12px;
  --font-ui-small: 13px;
  --font-ui-medium: 15px;
`;

/**
 * Write the **rendered** view out as standalone pages for a headless
 * screenshot.
 *
 * The markup is `contentEl.outerHTML` from the real renderer, and the
 * stylesheet is the real `styles.css` — the preview holds no second copy of
 * either, so a layout bug it shows is a layout bug the plugin has.
 *
 * `host-baseline.css` sits in front of them and is not optional. Without the
 * host's own rules the harness renders a page the plugin never sees: it was
 * reporting a perfectly centred slider thumb while Obsidian was drawing an 18px
 * white one four pixels off, because the host's `input[type='range']` selectors
 * outrank the plugin's. And a *subset* of the host lies too — the 80-line
 * slider-only baseline had no `button` rules at all, so grey-filled checkboxes
 * and shadowed toolbars sailed through every preview round. The file is now the
 * whole app.css. See the header of that file.
 *
 * Cascade order below is the real one: host defaults first, then the preview's
 * own variables (they stand in for the theme, which Obsidian also loads after
 * app.css), then the plugin, then the icon placeholders.
 */
function writePreview(view, outDir, suffix = "") {
  const host = fs.readFileSync(path.join(__dirname, "..", "host-baseline.css"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  fs.mkdirSync(outDir, { recursive: true });

  const page = (vars, cls) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>Vault Jukebox preview</title>
<style>${host}</style>
<style>
html, body { height: 100%; margin: 0; }
body {
  background: var(--background-primary);
  color: var(--text-normal);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 14px;
${vars}
}
.mp-root { height: 100%; }
</style>
<style>${css}</style>
<style>${PREVIEW_ICON_CSS}</style>
</head>
<body class="${cls}" data-mp-motion="full">${view.contentEl.outerHTML}</body></html>`;

  fs.writeFileSync(
    path.join(outDir, `preview${suffix}.html`),
    page(PREVIEW_LIGHT_VARS, "theme-light")
  );
  fs.writeFileSync(
    path.join(outDir, `preview${suffix}-dark.html`),
    page(PREVIEW_DARK_VARS, "theme-dark")
  );
}

module.exports = {
  MANIFEST,
  check,
  ok,
  tally,
  textOf,
  sleep,
  installClock,
  rowsOf,
  rowTitles,
  rowPaths,
  treeNames,
  boot,
  openView,
  writePreview,
};
