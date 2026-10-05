/*
 * Headless smoke test — the runner.
 *
 * Runs the **real build artefact** (`main.js`) against a fake vault, so what is
 * under test is what ships. Obsidian has no headless mode, so three things are
 * faked: the `obsidian` module (support/stub), the element helpers Obsidian
 * patches onto every element (support/env), and the vault / fileManager /
 * workspace (support/vault).
 *
 * The assertions live in test/groups/*.cjs, one file per theme, each receiving
 * the shared `env` object that threads plugin/view/vault between groups:
 *
 *   boot.cjs       1–2   first boot; browsing != playing
 *   transport.cjs  3–3c  transport, click-vs-selection, playback rate
 *   library.cjs    4–9   search, rename, move, collision, delete, keyboard
 *   session.cjs    10–14 persistence, restore, bad-startup states
 *   wiring.cjs     15–16 commands, settings tab, teardown
 */

const { app, installModuleHook } = require("./support/stub.cjs");
const { tally } = require("./support/harness.cjs");

// The module hook must be in place before the artefact is ever required —
// `boot()` does that lazily, but install it here to make the order explicit.
installModuleHook();

async function main() {
  const env = { app, plugin: null, view: null, vault: null, saved: null, revived: null, blank: null, lost: null };

  await require("./groups/boot.cjs")(env);
  await require("./groups/transport.cjs")(env);
  await require("./groups/library.cjs")(env);
  await require("./groups/session.cjs")(env);
  await require("./groups/wiring.cjs")(env);
}

main()
  .then(() => {
    console.log(`smoke: ${tally()} assertions passed`);
    // Debounce timers and player listeners would otherwise hold the process open.
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
