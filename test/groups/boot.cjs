/*
 * Smoke groups 1–2: first boot, and "browsing a playlist does not switch the
 * music". Receives the shared env object and fills in plugin/view/vault.
 */

const { ctx, app } = require("../support/stub.cjs");
const { TFile, TFolder, makeVault } = require("../support/vault.cjs");
const { check, ok, rowsOf, rowTitles, rowPaths, treeNames, boot, openView } = require("../support/harness.cjs");

module.exports = async function runBootGroups(env) {
  // ======================================================= 1. first boot
  const vault = makeVault();
  env.vault = vault;
  app.vault = vault;
  const plugin = await boot({ musicRoot: "music" });
  env.plugin = plugin;
  const view = (await openView(plugin)).view;
  env.view = view;

  check("the library root is the configured folder", view.library.root, "music");
  check(
    "playlists are the direct subfolders, the auto-created one last",
    view.playlists.map((p) => p.name),
    ["deep", "Jazz", "Rock", "default"]
  );
  ok("a second level of nesting is not a playlist", !view.playlists.some((p) => p.name === "ignored"));
  check(
    "a playlist whose only content is a deeper folder is simply empty",
    view.playlists.find((p) => p.name === "deep").tracks.length,
    0
  );
  ok("the buried track is invisible", !rowPaths(view).some((p) => p && p.includes("buried")));

  ok("`default` is created when missing", vault.getAbstractFileByPath("music/default") instanceof TFolder);
  ok(
    "a song left in the root is swept into default",
    vault.getAbstractFileByPath("music/default/Loose.mp3") instanceof TFile
  );
  ok("and is no longer in the root", vault.getAbstractFileByPath("music/Loose.mp3") === null);
  ok("the sweep is announced", ctx.notices.some((n) => n.includes("移入")));

  const rock = view.playlists.find((p) => p.name === "Rock");
  check("Rock sees exactly its three audio files", rock.tracks.length, 3);
  check("a .md file is not a track", view.playlists.find((p) => p.name === "Jazz").tracks.length, 1);
  const wma = rock.tracks.find((t) => t.ext === "wma");
  ok("an undecodable format is still listed", !!wma);
  check("...but marked unplayable", wma.playable, false);
  check("the name is parsed down to the artist", rock.tracks.find((t) => t.ext === "flac").artist, "C");

  // --- the shell ---------------------------------------------------------
  check("the tree shows one row per playlist", treeNames(view), ["deep", "Jazz", "Rock", "default"]);
  ok("the player bar is mounted", !!view.contentEl.querySelector(".mp-player"));
  ok("the seek slider is mounted", !!view.contentEl.querySelector(".mp-seek"));
  ok("the volume slider is mounted", !!view.contentEl.querySelector(".mp-volume-range"));
  check(
    "five transport buttons, all in the centre cluster",
    view.contentEl.querySelectorAll(".mp-buttons .mp-icon-btn").length,
    5
  );
  // The mode switches are grouped on the right, not mixed into the transport
  // cluster: a loop button between "next" and "forward" reads as a sixth
  // transport button and changes a setting.
  check(
    "the right cluster holds loop / speed / mute",
    view.contentEl.querySelectorAll(".mp-extras .mp-icon-btn").length,
    3
  );
  ok(
    "the loop button lives in the right cluster",
    view.contentEl.querySelector(".mp-extras .mp-icon-btn") === view.loopBtnEl
  );
  ok(
    "the speed button lives in the right cluster",
    !!view.contentEl.querySelector(".mp-extras .mp-rate")
  );
  ok(
    "the volume slider is inside the right cluster",
    !!view.contentEl.querySelector(".mp-extras .mp-volume input.mp-volume-range")
  );
  check(
    "the sort control is a button, not a native select",
    view.contentEl.querySelectorAll("select").length,
    0
  );
  check("the first playlist is the one shown", view.activePlaylist, "Jazz");
  check("and its tracks are listed", rowTitles(view), ["So What"]);

  // ================================================= 2. browsing != playing
  const jazzTrack = view.tracks[0];
  view.playTrack(jazzTrack);
  check("playing a row loads it", plugin.player.current().path, jazzTrack.path);
  ok("the audio element got a vault resource URL", plugin.player.audio.src.startsWith("app://testvault/"));
  check("the queue became that playlist", plugin.player.queue.length, 1);
  ok("the row is marked as playing", rowsOf(view)[0].hasClass("is-current"));

  view.selectPlaylist("Rock");
  check("the list follows the playlist", rowTitles(view).length, 3);
  check("but the playing track is untouched", plugin.player.current().path, jazzTrack.path);
  check("and so is the queue", plugin.player.queue.length, 1);
  check("the tree moved its highlight", view.activePlaylist, "Rock");
};
