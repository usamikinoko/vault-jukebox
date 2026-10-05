/*
 * Smoke groups 10–14: persistence, session restore, unconfigured/missing
 * startup states, and closing the view.
 */

const { TFolder } = require("../support/vault.cjs");
const { check, ok, treeNames, boot, openView, sleep, installClock } = require("../support/harness.cjs");
const { window } = require("../support/env.cjs");

module.exports = async function runSessionGroups(env) {
  const { plugin, view, vault } = env;

  // ========================================================= 10. persistence
  view.selectPlaylist("Jazz");
  view.playTrack(view.tracks[0]);
  installClock(plugin.player.audio, 200);
  plugin.player.seek(42);
  check("the position is where we put it", plugin.player.position, 42);

  await plugin.flushSave();
  const saved = plugin._data;
  env.saved = saved;
  check("the session track is written", saved.lastTrackPath, view.tracks[0].path);
  check("the position is written", saved.lastPosition, 42);
  check("the volume is written", Math.round(saved.volume * 100), 25);
  check("the loop mode is written", saved.loopMode, "all");
  check("the last playlist is written", saved.lastPlaylist, "Jazz");
  check("ordinary settings are written too", saved.seekStep, 3);
  check("the volume survives a mute/unmute round trip", saved.volume, 0.25);

  // ======================================================= 11. restore
  const savedPath = saved.lastTrackPath;
  const revived = await boot(saved);
  env.revived = revived;
  check("the last track is loaded again", revived.player.current()?.path, savedPath);
  check("it is restored paused, not playing", revived.player.playing, false);
  ok("the audio element is paused", revived.player.audio.paused);

  // The clock has to exist before the metadata event, or the position lands in
  // `pendingSeek` and never anywhere observable.
  installClock(revived.player.audio, 0);
  revived.player.audio.dispatchEvent(new window.Event("loadedmetadata"));
  check("and it is parked at the saved position", revived.player.position, 42);
  ok("restore seeds the queue from the track's playlist", revived.player.queue.length > 0);

  const restoredView = (await openView(revived)).view;
  check("the remembered playlist is the one shown", restoredView.activePlaylist, "Jazz");
  const row = restoredView.rowEls.get(savedPath);
  ok("the restored track's row is marked", !!row && row.hasClass("is-current"));

  // ================================================= 12. unconfigured setup
  const blank = await boot({ ...saved, musicRoot: "" });
  env.blank = blank;
  const blankView = (await openView(blank)).view;
  check("an unset music folder is reported as such", blankView.problem, "unset");
  ok(
    "an empty state with an action is drawn",
    !!blankView.listEl.querySelector(".mp-empty-actions button")
  );
  check("and no playlist rows are drawn", treeNames(blankView).length, 0);

  // ==================================================== 13. missing folder
  const lost = await boot({ ...saved, musicRoot: "no/such/folder" });
  env.lost = lost;
  const lostView = (await openView(lost)).view;
  check("a missing folder is reported as such", lostView.problem, "missing");
  const createBtn = [...lostView.listEl.querySelectorAll(".mp-empty-actions button")].find((b) =>
    b.textContent.trim().includes("创建")
  );
  ok("a create-the-folder action is offered", !!createBtn);
  createBtn.dispatchEvent(new window.Event("click"));
  await sleep(40);
  check("creating it clears the problem", lostView.problem, null);
  ok("the folder now exists", vault.getAbstractFileByPath("no/such/folder") instanceof TFolder);
  ok("and its default playlist was made too", vault.getAbstractFileByPath("no/such/folder/default") instanceof TFolder);

  // ============================================== 14. offline: nothing to scan
  await view.onClose();
  ok("closing the view detaches its subscription", view.unsubPlayer === null);
};
