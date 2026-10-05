/*
 * Smoke groups 15–16: command registration and wiring, the settings tab, then
 * teardown of every plugin instance the suite booted.
 */

const { MANIFEST, check, ok, textOf, sleep } = require("../support/harness.cjs");
const { window } = require("../support/env.cjs");

module.exports = async function runWiringGroups(env) {
  const { plugin, revived, blank, lost } = env;

  // ================================================== 15. commands and wiring
  check(
    "every command is registered",
    plugin.commands.map((c) => c.id).sort(),
    ["next", "open", "prev", "rescan", "toggle", "volume-down", "volume-up"]
  );
  check("exactly one ribbon icon", plugin.ribbonIcons.length, 1);
  check("exactly one status bar item", plugin.statusBarItems.length, 1);
  ok(
    "the status bar names the current track",
    plugin.statusBarItems[0].textContent.includes("—") ||
      plugin.statusBarItems[0].textContent.includes("未在播放")
  );

  // a command actually drives the engine
  const toggle = plugin.commands.find((c) => c.id === "toggle");
  let playCalls = 0;
  const realPlay = plugin.player.play.bind(plugin.player);
  plugin.player.play = () => {
    playCalls++;
  };
  toggle.callback();
  check("the play/pause command reaches the engine", playCalls, 1);
  plugin.player.play = realPlay;

  const next = plugin.commands.find((c) => c.id === "next");
  const indexBeforeCommand = plugin.player.index;
  next.callback();
  ok("the next command advances the queue", plugin.player.index !== indexBeforeCommand);

  // Drain any debounced checkpoint before asserting on the settings page, so a
  // timer firing mid-test cannot be mistaken for the reset button's effect.
  await plugin.flushSave();

  plugin.settingTab.display();
  const tab = plugin.settingTab.containerEl;
  ok("the settings tab renders groups", tab.querySelectorAll(".mp-settings-group").length >= 3);
  ok("the music folder row is present", tab.textContent.includes("音乐目录"));
  ok("the loop mode row is present", tab.textContent.includes("循环模式"));
  ok("the version stamp is present", tab.textContent.includes(MANIFEST.version));

  const resetButton = [...tab.querySelectorAll("button")].find((b) => textOf(b) === "恢复默认");
  ok("the reset action is rendered", !!resetButton);
  resetButton.dispatchEvent(new window.Event("click"));
  await sleep(20);
  check("reset keeps the session position", plugin.settings.lastPosition, 42);
  check("reset clears the folder preference", plugin.settings.musicRoot, "");

  // ============================================================== 16. teardown
  await revived.onunload();
  await blank.onunload();
  await lost.onunload();
  await plugin.onunload();
};
