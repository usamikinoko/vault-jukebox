/*
 * Multi-selection in the track list.
 *
 * The rule this file exists to enforce: **playing a track and selecting a track
 * are two different intentions**, and a music player must not conflate them.
 * Clicking a row is the single most frequent action in the plugin — it means
 * "play this" — and making it also grow a selection means that after auditioning
 * four songs the user is holding four files they never asked to hold, with a
 * toolbar full of destructive buttons they never asked for.
 *
 * So:
 *   click              play. Never touches the selection.
 *   click on ☐         toggle this row. Never plays.
 *   Ctrl / Cmd + click toggle this row. Never plays.
 *   Shift + click      extend the range from the anchor. Never plays.
 *   right click        open the menu. Never touches the selection.
 *   Ctrl+A             select the visible list.
 *
 * The playing row and the selected rows are therefore two different
 * decorations, painted by two different classes, and neither can be mistaken for
 * the other: playing is an accent title plus the equaliser bars, selected is a
 * wash plus a bar on the leading edge.
 */

import type { Track } from "../types";
import { sortTracks } from "../library";
import type { ViewPart } from "./viewTypes";

export interface SelectionPart {
  onRowClick(evt: MouseEvent, track: Track, index: number): void;
  onRowCheckClick(evt: MouseEvent, track: Track, index: number): void;
  toggleSelection(path: string, index: number): void;
  extendSelection(path: string, index: number): void;
  renderSelBar(): void;
  syncSelectionClasses(): void;
  selectedTracks(): Track[];
  clearSelection(): void;
  selectAll(): void;
  queueTracks(): Track[];
}

export const selectionPart: ViewPart<SelectionPart> = {
  onRowClick(evt: MouseEvent, track: Track, index: number): void {
    // Ctrl/Cmd and Shift are selection gestures, not playback ones. They are
    // handled first so the modifiers can never leak into "and also play".
    if (evt.ctrlKey || evt.metaKey) {
      this.toggleSelection(track.path, index);
      return;
    }
    if (evt.shiftKey) {
      this.extendSelection(track.path, index);
      return;
    }

    this.focusIndex = index;
    this.anchor = track.path;
    this.updateFocusRow();
    this.playTrack(track);
  },

  onRowCheckClick(evt: MouseEvent, track: Track, index: number): void {
    // The row's own click handler must not also fire, or ticking a box would
    // start a song.
    evt.stopPropagation();
    this.toggleSelection(track.path, index);
  },

  /** Add or remove one row, then repaint. Used by ☐, Ctrl-click and the menu. */
  toggleSelection(path: string, index: number): void {
    if (this.selection.has(path)) this.selection.delete(path);
    else this.selection.add(path);
    this.anchor = path;
    this.focusIndex = index;
    this.updateFocusRow();
    this.syncSelectionClasses();
    this.renderSelBar();
  },

  /**
   * Shift-click: everything between the anchor and here, *inclusive of both*.
   * The anchor is deliberately left where it was, so a second shift-click
   * re-ranges from the same origin instead of creeping along the list.
   */
  extendSelection(path: string, index: number): void {
    const from = this.anchor ? this.tracks.findIndex((t) => t.path === this.anchor) : -1;
    if (from < 0) {
      this.selection.add(path);
    } else {
      const [lo, hi] = from < index ? [from, index] : [index, from];
      for (let i = lo; i <= hi; i++) this.selection.add(this.tracks[i].path);
    }
    this.focusIndex = index;
    this.updateFocusRow();
    this.syncSelectionClasses();
    this.renderSelBar();
  },

  selectedTracks(): Track[] {
    const byPath = new Map(this.activeTracks().map((t) => [t.path, t]));
    return [...this.selection]
      .map((path) => byPath.get(path))
      .filter((t): t is Track => !!t);
  },

  clearSelection(): void {
    this.selection.clear();
    this.anchor = null;
    this.syncSelectionClasses();
    this.renderSelBar();
  },

  selectAll(): void {
    for (const track of this.tracks) this.selection.add(track.path);
    this.syncSelectionClasses();
    this.renderSelBar();
  },

  syncSelectionClasses(): void {
    for (const [path, row] of this.rowEls) {
      const on = this.selection.has(path);
      row.toggleClass("is-selected", on);
      const check = row.querySelector(".mp-row-check");
      check?.setAttr("aria-checked", String(on));
      /* The glyph is styled off `is-on`, so it must be class-toggled here and
         not left to `aria-checked` — attributes restyle nothing without a
         matching attribute selector, and the one that would match does not
         exist. This line was missing once: every box stayed visually blank no
         matter what was selected. */
      check?.toggleClass("is-on", on);
    }
    // Keeping every checkbox visible while a selection exists is what makes
    // "how do I get out of this?" answerable without hovering every row.
    this.listEl.toggleClass("has-selection", this.selection.size > 0);
    this.updateSelectAll();
  },

  /**
   * The playback queue is the sorted playlist, not the filtered list: typing in
   * the search box is a way to find a track, not a way to redefine what "next"
   * means.
   */
  queueTracks(): Track[] {
    const settings = this.plugin.settings;
    return sortTracks(this.activeTracks(), settings.sortKey, settings.sortAsc);
  },

  renderSelBar(): void {
    if (!this.selBarEl) return;
    const count = this.selection.size;
    // Rebuilding this bar on every repaint would throw away the focus of the
    // button the user is about to click; the signature stops that.
    const signature = `${count}\u0000${this.activePlaylist}`;
    if (signature === this.selSignature) return;
    this.selSignature = signature;

    this.selBarEl.empty();
    this.selBarEl.toggleClass("is-hidden", count === 0);
    if (count === 0) return;

    const label = this.selBarEl.createSpan({ cls: "mp-selbar-count" });
    label.createSpan({ text: `已选中 ${count} 首` });
    label.createSpan({ cls: "mp-selbar-hint", text: "点击歌曲只会播放，不会选中" });

    const move = this.selBarEl.createEl("button", { cls: "mp-btn", attr: { type: "button" } });
    move.setText("移动到…");
    move.addEventListener("click", () => this.moveSelection());

    const remove = this.selBarEl.createEl("button", {
      cls: "mp-btn is-danger",
      attr: { type: "button" },
    });
    remove.setText("删除");
    remove.addEventListener("click", () => {
      void this.deleteTracks(this.selectedTracks());
    });

    const clear = this.selBarEl.createEl("button", { cls: "mp-btn", attr: { type: "button" } });
    clear.setText("取消选择");
    clear.addEventListener("click", () => this.clearSelection());
  },
};
