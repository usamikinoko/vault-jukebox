/*
 * Smoke groups 3, 3b, 3c: the transport (loop/step/seek/volume), the
 * click-vs-selection rule, and playback rate.
 */

const { check, ok, rowsOf, installClock, writePreview } = require("../support/harness.cjs");
const { window } = require("../support/env.cjs");

module.exports = async function runTransportGroups(env) {
  const { plugin, view } = env;

  // ============================================================ 3. transport
  view.playTrack(view.tracks[0]);

  // Real screenshots of the real DOM, for the eyes rather than the assertions.
  if (process.env.MP_PREVIEW) {
    const dir = process.env.MP_PREVIEW;
    // Park the transport mid-track with a non-default volume and speed, so the
    // screenshots show the parts of the bar that only exist in motion: the
    // played portion of both sliders, and a loop/rate button in its alt state.
    installClock(plugin.player.audio, 215);
    plugin.player.seek(72);
    plugin.player.setVolume(0.55);
    plugin.player.setLoopMode("shuffle");
    plugin.player.setRate(1.25);
    view.syncPlayerBar();
    writePreview(view, dir);

    view.selectPlaylist("deep"); // an empty playlist, so the empty state renders
    writePreview(view, dir, "-empty");

    view.selectPlaylist("Rock");
    view.selection = new Set(view.tracks.map((t) => t.path));
    view.renderList();
    view.renderSelBar();
    view.syncSelectionClasses();
    writePreview(view, dir, "-selection");
    console.log(`previews written to ${dir}`);
    process.exit(0);
  }
  check("playing from the new playlist re-points the queue", plugin.player.queue.length, 3);
  ok("the queue covers the whole playlist", plugin.player.queue.some((t) => t.ext === "flac"));

  plugin.player.setLoopMode("all");
  plugin.player.cycleLoopMode();
  check("loop cycles to single", plugin.player.loopMode, "one");
  plugin.player.cycleLoopMode();
  check("loop cycles to shuffle", plugin.player.loopMode, "shuffle");
  plugin.player.cycleLoopMode();
  check("loop cycles back to the list", plugin.player.loopMode, "all");
  view.syncPlayerBar();
  check("the loop button reflects the mode", view.loopBtnEl.getAttribute("data-icon"), "repeat");

  const indexBefore = plugin.player.index;
  plugin.player.step(1);
  check("next advances one track", plugin.player.index, (indexBefore + 1) % 3);
  plugin.player.step(-1);
  check("previous comes back", plugin.player.index, indexBefore);

  // --- seek, with a clock -------------------------------------------------
  installClock(plugin.player.audio, 200);
  plugin.player.seekBy(3);
  check("seekBy moves forward by the configured step", plugin.player.position, 3);
  plugin.player.seekBy(-3);
  check("and back again", plugin.player.position, 0);
  plugin.player.seek(-10);
  check("seeking before the start clamps to 0", plugin.player.position, 0);
  plugin.player.seek(500);
  ok(
    "seeking past the end clamps below the duration",
    plugin.player.position > 199 && plugin.player.position < 200
  );

  plugin.player.setVolume(0.25);
  check("volume is applied to the element", Math.round(plugin.player.audio.volume * 100), 25);
  check("the slider tracks it", view.volEl.value, "25");
  plugin.player.toggleMute();
  check("mute is reflected", plugin.player.audio.muted, true);
  plugin.player.toggleMute();
  check("unmute is reflected", plugin.player.audio.muted, false);

  // ================================================== 3b. click vs selection
  //
  // The rule under test: clicking a song plays it and does nothing else. The
  // old behaviour selected it as a side effect, so auditioning four songs left
  // four files held and a toolbar of destructive buttons — which is what the
  // user reported. Everything below asserts the separation from both sides.
  view.selectPlaylist("Rock");
  view.clearSelection();
  const rowFor = (path) => view.rowEls.get(path);
  const idxOf = (track) => view.tracks.indexOf(track);
  const clickRow = (track, mods = {}) =>
    rowFor(track.path).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, ...mods })
    );
  const tickBox = (track) =>
    view.onRowCheckClick({ stopPropagation() {} }, track, idxOf(track));

  // Rock also holds a .wma, which cannot be decoded; clicking it is a refusal,
  // not a playback, so the click assertions use the two that do play.
  const playable = view.tracks.filter((t) => t.playable);
  check("two of the three Rock tracks are playable", playable.length, 2);
  const [first, second] = playable;

  clickRow(first);
  check("clicking a row plays it", plugin.player.current()?.path, first.path);
  check("...and selects nothing", view.selection.size, 0);
  ok("...so no row is drawn as selected", !rowFor(first.path).hasClass("is-selected"));

  clickRow(second);
  check("clicking another row moves playback", plugin.player.current()?.path, second.path);
  check("...and the selection is still empty", view.selection.size, 0);
  ok(
    "the selection bar stays hidden through a run of auditions",
    view.selBarEl.hasClass("is-hidden")
  );

  // The checkbox is the selection gesture.
  tickBox(first);
  check("the checkbox selects", view.selection.size, 1);
  check("...the row it was on", [...view.selection][0], first.path);
  check("...and does not start playback", plugin.player.current()?.path, second.path);
  ok("a ticked row is drawn as selected", rowFor(first.path).hasClass("is-selected"));
  check(
    "aria-checked follows",
    rowFor(first.path).querySelector(".mp-row-check").getAttribute("aria-checked"),
    "true"
  );
  // The checked glyph is styled off `is-on`, not off `aria-checked` — a bug here
  // leaves every box visually blank, which is how it once shipped.
  ok("the box carries is-on", rowFor(first.path).querySelector(".mp-row-check").hasClass("is-on"));
  ok("and the list marks itself as having a selection", view.listEl.hasClass("has-selection"));

  tickBox(first);
  check("the checkbox toggles back off", view.selection.size, 0);
  ok("is-on drops with the selection", !rowFor(first.path).querySelector(".mp-row-check").hasClass("is-on"));
  ok("and the list stops flagging a selection", !view.listEl.hasClass("has-selection"));

  // Ctrl-click is the same gesture from the row.
  view.onRowClick({ ctrlKey: true }, first, idxOf(first));
  check("ctrl-click selects", view.selection.size, 1);
  check("...without changing what is playing", plugin.player.current()?.path, second.path);
  view.onRowClick({ metaKey: true }, second, idxOf(second));
  check("cmd/meta-click adds to it", view.selection.size, 2);

  // Shift-click ranges from the anchor. It is additive rather than replacing,
  // so the invariant that matters is that the anchor stays put: a second
  // shift-click origin-eats from the same row instead of from the last target,
  // which is what makes "go back and grab one more" behave.
  view.clearSelection();
  view.onRowClick({ ctrlKey: true }, view.tracks[0], 0);
  check("the anchor is the ctrl-clicked row", view.anchor, view.tracks[0].path);
  view.onRowClick({ shiftKey: true }, view.tracks[2], 2);
  check("shift-click takes the whole range", view.selection.size, 3);
  check("...and leaves the anchor where it was", view.anchor, view.tracks[0].path);
  view.onRowClick({ shiftKey: true }, view.tracks[2], 2);
  check("repeating the same shift-click is idempotent", view.selection.size, 3);
  check("...still without playing", plugin.player.current()?.path, second.path);

  // Escape is the way out.
  view.onKeyDown({ key: "Escape", target: view.contentEl, preventDefault() {} });
  check("escape clears the selection", view.selection.size, 0);

  // The toolbar toggle, from both ends.
  view.selectAll();
  check("select-all takes the visible list", view.selection.size, view.tracks.length);
  ok(
    "the toolbar button flips to the checked icon",
    view.selectAllEl.getAttribute("data-icon") === "check-square"
  );
  view.clearSelection();
  check("clear-selection empties it", view.selection.size, 0);

  // Zebra striping is an explicit class, not `:nth-child`.
  const zebra = view.tracks.map((t) => (rowFor(t.path).hasClass("is-odd") ? 1 : 0));
  check("zebra stripes alternate", zebra.join(""), "010");

  // =============================================================== 3c. rate
  plugin.player.setRate(1);
  check("the default speed is 1x", plugin.player.snapshot().rate, 1);
  ok(
    "and it is not flagged as an alt state",
    !view.rateBtnEl.hasClass("is-alt"),
    true
  );
  plugin.player.cycleRate();
  check("cycle steps off 1x to 1.25x", plugin.player.snapshot().rate, 1.25);
  check(
    "the element got the multiplier",
    plugin.player.audio.playbackRate,
    1.25
  );
  check(
    "and so did defaultPlaybackRate, which is what survives load()",
    plugin.player.audio.defaultPlaybackRate,
    1.25
  );
  view.syncPlayerBar();
  check("the button shows the speed", view.rateBtnEl.textContent, "1.25×");
  ok("and takes the accent as an alt state", view.rateBtnEl.hasClass("is-alt"));

  plugin.player.setRate(2);
  plugin.player.cycleRate();
  check("cycling off the top wraps back to the slowest preset", plugin.player.snapshot().rate, 0.5);
  plugin.player.setRate(1);
  view.syncPlayerBar();
  check("the button label follows", view.rateBtnEl.textContent, "1×");
  ok("and the alt state is dropped at 1x", !view.rateBtnEl.hasClass("is-alt"));

  await plugin.flushSave();
  check("the speed is persisted", plugin._data.rate, 1);
};
