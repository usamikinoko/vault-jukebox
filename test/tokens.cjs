/*
 * tokens: the design-system lint.
 *
 * The styles are 5 source shards glued into styles.css by build-styles.mjs, so
 * a token can rot in two ways this test exists to catch:
 *
 *   1. a token declared but never referenced — the `fast/base/slow` duration
 *      ladder this suite was written for had two thirds of it unspent, which is
 *      how a "design system" turns into a pile of names nobody dares delete;
 *   2. a `var(--mp-x)` referenced but never declared — the component silently
 *      loses its styling and nothing errors.
 *
 * It also pins the two things the user asked for that are easy to regress
 * silently: no shadows anywhere in the plugin's own rules (flat design), and
 * styles.css actually matching the shards (a stale build is worse than a bad
 * one, because it lies about what the source says).
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
function eq(actual, expected, label) {
  assert.deepStrictEqual(
    actual,
    expected,
    `${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`,
  );
  passed++;
}
function ok(condition, label) {
  assert.ok(condition, label);
  passed++;
}

const root = path.join(__dirname, "..");
const stylesDir = path.join(root, "styles");
const shards = fs
  .readdirSync(stylesDir)
  .filter((f) => f.endsWith(".css"))
  .sort();

/** Comments are prose, not declarations. Scanning them produced a false
 *  positive once already: a comment explaining "box-shadow: none kills the
 *  host's shadow" was read as a decorative shadow. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

let css = "";
const declared = new Map();
const perShard = new Map();
for (const file of shards) {
  const code = stripComments(fs.readFileSync(path.join(stylesDir, file), "utf8"));
  css += code;
  perShard.set(file, code);
  for (const m of code.matchAll(/^\s*(--mp-[a-z0-9-]+)\s*:/gim)) {
    if (!declared.has(m[1])) declared.set(m[1], file);
  }
}

/* --- 1. every declared token is spent, every spent token is declared ----- */

// The one legitimate exception: tokens whose value is per-frame data, written
// from TypeScript with setProperty. Discovered from the source rather than
// hardcoded, so adding a second one does not require editing this test.
const fromTs = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith(".ts")) {
      const t = fs.readFileSync(p, "utf8");
      for (const m of t.matchAll(/setProperty\(\s*"(--mp-[a-z0-9-]+)"/g)) fromTs.add(m[1]);
    }
  }
}
walk(path.join(root, "src"));

const referenced = new Set([...css.matchAll(/var\(\s*(--mp-[a-z0-9-]+)/gi)].map((m) => m[1]));

const dead = [...declared.keys()].filter((k) => !referenced.has(k) && !fromTs.has(k));
const undefinedRefs = [...referenced].filter((k) => !declared.has(k));
const declaredNotSpent = [...fromTs].filter((k) => !declared.has(k));

eq(dead, [], "no declared token goes unspent");
eq(undefinedRefs, [], "no referenced token is undeclared");
eq(declaredNotSpent, [], "every TS-written token is also declared in CSS");
ok(declared.size > 0, "the token scan actually found tokens");

/* --- 2. flat design: no shadows in the plugin's own rules ---------------- */

// User requirement, verbatim: "扁平式设计，不要使用过多的 shadow（会拖慢渲染速度）".
// Every `box-shadow` the plugin writes must be a reset, never a decoration.
const shadowRules = [...css.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim());
const decorative = shadowRules.filter((v) => !/^(none|0(px)?(\s+0(px)?)*)$/i.test(v));
eq(decorative, [], "box-shadow is only ever used to reset the host's own shadow");

/* --- 3. the built stylesheet matches the shards -------------------------- */

const built = stripComments(fs.readFileSync(path.join(root, "styles.css"), "utf8"));
// build-styles.mjs joins the shards; compare the token set rather than the
// bytes, so the test does not break on the banner/separator formatting.
const builtTokens = new Set([...built.matchAll(/var\(\s*(--mp-[a-z0-9-]+)/gi)].map((m) => m[1]));
eq(
  [...builtTokens].filter((t) => !referenced.has(t)),
  [],
  "styles.css references no token the shards do not",
);
eq(
  [...referenced].filter((t) => !builtTokens.has(t)),
  [],
  "styles.css is not stale — rebuild it (npm run build) if this fails",
);

/* --- 4. the button families tie with the host, and must stay prefixed --- */

// Obsidian styles every button with `button:not(.clickable-icon)`, which is
// (0,1,1). A bare `.mp-btn` is (0,1,0) and loses outright — that is how
// unchecked checkboxes once rendered looking checked and how the whole toolbar
// ended up with a drop shadow.
//
// `body .mp-btn` is also (0,1,1), so it does not out-rank the host either: it
// TIES, and wins only because Obsidian appends a plugin's styles.css after
// app.css. Verified by swapping the two stylesheets in a test page — the host's
// five-layer shadow comes straight back. The prefix is therefore load-bearing.
//
// This asserts the family's BASE rule only (`.mp-btn`, not `.mp-btn:hover` or
// `.mp-btn.is-danger`). The base rule is the one that pins `box-shadow: none`
// and the whole frame; the derived rules in this plugin are written without the
// prefix and take their (0,1,1) ties on source order. That is a real, if
// narrower, fragility — recorded here rather than silently blessed. Note that
// vault-gallery's copy of this check is stricter and requires the prefix on
// every non-descendant family rule; the two conventions differ.
const BUTTON_FAMILIES = ["mp-btn", "mp-icon-btn", "mp-check", "mp-play"];
const unprefixed = [];
for (const [file, code] of perShard) {
  for (const m of code.matchAll(/(^|\})\s*([^{}]+)\{/g)) {
    const selector = m[2].trim();
    if (!selector || selector.startsWith("@") || selector.startsWith("body")) continue;
    if (!BUTTON_FAMILIES.includes(selector.slice(1))) continue;
    unprefixed.push(`${file}: ${selector}`);
  }
}
eq(unprefixed, [], "every button-family base rule carries the `body ` prefix");

/* --- 5. the reduced-motion ladder stays honest --------------------------- */

// Anchored to the start of a line so it matches the *declaration* block and not
// the first `body[data-mp-motion="reduced"] .something` consumer that happens to
// come earlier in the concatenation — the shards are read in alphabetical
// order, which is not the cascade order.
for (const mode of ["full", "reduced", "none"]) {
  const re = new RegExp(`^body\\[data-mp-motion="${mode}"\\]\\s*\\{([^}]*)\\}`, "m");
  const m = css.match(re);
  ok(m, `motion mode "${mode}" is declared`);
  if (m) ok(/--mp-dur\s*:/.test(m[1]), `motion mode "${mode}" sets --mp-dur`);
}

console.log(`tokens: ${passed} assertions passed`);
