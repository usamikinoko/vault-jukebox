/*
 * Smoke groups 4–9: search, rename, drag-move, collision naming, delete, and
 * the keyboard model (cursor vs selection).
 */

const { TFile } = require("../support/vault.cjs");
const { ctx } = require("../support/stub.cjs");
const { check, ok, rowsOf, installClock } = require("../support/harness.cjs");

module.exports = async function runLibraryGroups(env) {
  const { plugin, view, vault } = env;

  // =============================================================== 4. search
  // `refreshTracks` recomputes; `renderList` repaints. The search box pairs
  // them, so the test does too.
  const search = (query) => {
    view.query = query;
    view.refreshTracks();
    view.renderList();
  };
  search("broken");
  check("search matches on the file name", view.tracks.length, 1);
  check("the list narrows with it", rowsOf(view).length, 1);
  search("miles");
  check("search is case-insensitive and scoped to the open playlist", view.tracks.length, 0);
  ok("and the list shows the empty-search state", !!view.listEl.querySelector(".mp-empty"));
  search("");
  check("clearing the query restores the list", view.tracks.length, 3);
  check("and the rows come back", rowsOf(view).length, 3);

  // ================================================= 4b. list-head labelling
  /*
   * Two wording rules this head shares with Vault Gallery's toolbar. They are
   * pinned on both sides so the pair cannot drift apart:
   *   - a direction toggle states where the order stands and what the click
   *     does to it — "升序，点击改为降序" — not a bare "切换升序 / 降序";
   *   - a select-all control names what it covers, and flips once it has.
   */
  const sortAsc = plugin.settings.sortAsc;
  check(
    "the sort direction button names the current direction",
    view.sortDirEl.getAttribute("title"),
    sortAsc ? "升序，点击改为降序" : "降序，点击改为升序"
  );
  view.sortDirEl.dispatchEvent(new window.Event("click", { bubbles: true }));
  check(
    "and rewrites itself once the direction flips",
    view.sortDirEl.getAttribute("title"),
    sortAsc ? "降序，点击改为升序" : "升序，点击改为降序"
  );
  // Put it back — the groups below read the list in the order set above.
  view.sortDirEl.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("the flip is symmetric", plugin.settings.sortAsc, sortAsc);

  check(
    "select-all starts as 全选 and says what it covers",
    view.selectAllEl.getAttribute("title"),
    "全选当前列表"
  );
  check(
    "with 全选 as its accessible name",
    view.selectAllEl.getAttribute("aria-label"),
    "全选"
  );
  view.selectAllEl.dispatchEvent(new window.Event("click", { bubbles: true }));
  check(
    "and flips to 取消全选 once everything is picked",
    view.selectAllEl.getAttribute("title"),
    "取消全选"
  );
  view.selectAllEl.dispatchEvent(new window.Event("click", { bubbles: true }));
  check("picking all and clearing all leaves nothing selected", view.selection.size, 0);

  // =============================================================== 5. rename
  const flac = view.tracks.find((t) => t.ext === "flac");
  await vault.rename(flac.file, "music/Rock/Renamed_NewArtist.flac");
  await view.reloadLibrary();
  const renamed = view.tracks.find((t) => t.path === "music/Rock/Renamed_NewArtist.flac");
  ok("the renamed file is picked up", !!renamed);
  check("its metadata is re-parsed", renamed.artist, "NewArtist");
  ok("the old path is gone from the list", !view.rowEls.has(flac.path));

  // ================================================== 6. drag-move a track
  const rockTrackPath = "music/Rock/夜曲_周杰伦.mp3";
  await view.dropTracksOn("Jazz", [rockTrackPath]);
  ok("the file left its old playlist", vault.getAbstractFileByPath(rockTrackPath) === null);
  ok(
    "and arrived in the target",
    vault.getAbstractFileByPath("music/Jazz/夜曲_周杰伦.mp3") instanceof TFile
  );
  check("Rock is one track lighter", view.playlists.find((p) => p.name === "Rock").tracks.length, 2);

  // =============================================== 7. name collision on move
  vault.file("music/Rock/Collide.mp3"); // the name the incoming file wants
  vault.file("music/Jazz/Collide.mp3");
  await view.dropTracksOn("Rock", ["music/Jazz/Collide.mp3"]);
  ok(
    "a colliding name is suffixed instead of clobbering",
    vault.getAbstractFileByPath("music/Rock/Collide (2).mp3") instanceof TFile
  );
  ok(
    "both files survive",
    vault.getAbstractFileByPath("music/Rock/Collide.mp3") instanceof TFile
  );

  // =============================================================== 8. delete
  plugin.settings.confirmDelete = false;
  const victim = view.playlists.find((p) => p.name === "Rock").tracks.find((t) => t.ext === "wma");
  await view.deleteTracks([victim]);
  ok("the file went to the trash", vault.trashed.includes(victim.path));
  ok("and is gone from the tree", vault.getAbstractFileByPath(victim.path) === null);

  /*
   * A locked file must not cost the user the rest of the batch, and the notice
   * has to name the file and the reason rather than a bare "删除失败". That
   * reason is what `trashFile` now carries out; it used to be swallowed into a
   * boolean two frames below the caller, where nothing could recover it.
   * Vault Gallery words its per-file delete failure the same way.
   */
  const [locked, spare] = view.tracks.slice(0, 2);
  const realTrash = vault.trash.bind(vault);
  vault.trash = (node) => {
    if (node.path === locked.path) throw new Error("EBUSY: 文件被另一个程序占用");
    return realTrash(node);
  };
  ctx.notices.length = 0;
  await view.deleteTracks([locked, spare]);
  vault.trash = realTrash;
  ok(
    "a locked file is named, with its reason, in the failure notice",
    ctx.notices.some((n) => n.startsWith(`删除失败：${locked.name} —— `) && n.includes("EBUSY"))
  );
  ok("and the rest of the batch still went through", vault.trashed.includes(spare.path));
  ok("while the locked one stayed put", vault.getAbstractFileByPath(locked.path) !== null);

  view.selectPlaylist("Rock");
  const live = view.tracks[0];
  view.playTrack(live);
  check("a track is playing", plugin.player.current().path, live.path);
  await view.deleteTracks([live]);
  ok(
    "deleting the playing track drops it from the queue",
    !plugin.player.queue.some((t) => t.path === live.path)
  );
  check("and nothing is left playing", plugin.player.current(), null);

  // ============================================================== 9. keyboard
  view.selectPlaylist("Jazz");
  view.clearSelection();
  view.focusIndex = -1;
  view.moveFocus(1);
  check("arrow-down lands on the first row", view.focusIndex, 0);
  // Moving the cursor is not picking something up — the same rule the mouse
  // follows. `x` is what picks it up.
  check("and selects nothing", view.selection.size, 0);
  ok("but the cursor row is drawn", rowsOf(view)[0].hasClass("is-focused"));
  view.onKeyDown({ key: "x", target: view.contentEl, preventDefault() {} });
  check("x picks the cursor row up", view.selection.size, 1);
  check("...which is the cursor row", [...view.selection][0], view.tracks[0].path);
  view.onKeyDown({ key: "x", target: view.contentEl, preventDefault() {} });
  check("x toggles it back off", view.selection.size, 0);

  view.moveFocus(1);
  check("arrow-down again moves one row", view.focusIndex, 1);
  view.onKeyDown({ key: "ArrowUp", target: view.contentEl, preventDefault() {} });
  check("the view's handler moves focus back", view.focusIndex, 0);
  ok(
    "and the cursor highlight moved with it",
    rowsOf(view)[0].hasClass("is-focused") && !rowsOf(view)[1].hasClass("is-focused")
  );

  view.playTrack(view.tracks[0]);
  installClock(plugin.player.audio, 200);
  plugin.player.seek(10);
  view.onKeyDown({ key: "ArrowRight", target: view.contentEl, preventDefault() {} });
  check("arrow-right seeks forward by the configured step", plugin.player.position, 13);
  view.onKeyDown({ key: "ArrowLeft", target: view.contentEl, preventDefault() {} });
  check("arrow-left seeks back", plugin.player.position, 10);

  // jsdom never flips `paused` itself, so both branches of the space key are
  // pinned by hand — otherwise the assertion would only ever cover "resume".
  let pauseCalls = 0;
  plugin.player.audio.pause = () => {
    pauseCalls++;
  };
  Object.defineProperty(plugin.player.audio, "paused", { configurable: true, get: () => false });
  view.onKeyDown({ key: " ", target: view.contentEl, preventDefault() {} });
  check("space pauses when a track is up", pauseCalls, 1);
  Object.defineProperty(plugin.player.audio, "paused", { configurable: true, get: () => true });
  const resumed = plugin.player.current().path;
  view.onKeyDown({ key: " ", target: view.contentEl, preventDefault() {} });
  check("space keeps the same track when it resumes", plugin.player.current().path, resumed);

  const input = view.contentEl.createEl("input");
  view.onKeyDown({ key: "ArrowRight", target: input, preventDefault() {} });
  check("keys typed into an input are ignored", plugin.player.position, 10);
};
