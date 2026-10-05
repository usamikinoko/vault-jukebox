/*
 * Row rendering and the two incremental decorations.
 *
 * Rows are rendered plainly rather than windowed. Unlike the image grid a row
 * is a handful of spans and a button, so a thousand of them cost nothing
 * noticeable, and skipping virtualization removes an entire class of "the
 * constant and the CSS drifted apart" bugs. What *is* avoided is repainting the
 * whole list when only the playing track changed: `updatePlayingRows` touches at
 * most two rows.
 *
 * Two decorations are painted incrementally, because both change without the
 * list changing: the current track (a `timeupdate` fires four times a second)
 * and the keyboard cursor (an arrow-key repeat fires even faster).
 */

import { setIcon } from "obsidian";
import type { Track } from "../types";
import { formatSize } from "../parse";
import { cleanPath } from "../utils/paths";
import type { ViewPart } from "./viewTypes";

export interface RowPart {
  renderList(): void;
  buildRow(track: Track, index: number): HTMLElement;
  /**
   * Repaint the "playing" decoration only. Two rows at most, and the whole
   * point of keeping `rowEls` around: a `timeupdate` fires four times a second
   * and must never cost a list rebuild.
   */
  updatePlayingRows(): void;
  /** Same idea as `updatePlayingRows`, for the arrow-key cursor. */
  updateFocusRow(): void;
  /** The empty playlist / no search results panel. */
  renderEmptyState(): void;
}

export const rowPart: ViewPart<RowPart> = {
  renderList(): void {
    this.listEl.empty();
    this.rowEls.clear();
    this.paintedPath = null;
    this.paintedFocus = null;

    if (this.problem) {
      this.renderProblem(this.problem, cleanPath(this.plugin.settings.musicRoot));
      return;
    }
    if (!this.library) return;

    if (this.tracks.length === 0) {
      this.renderEmptyState();
      return;
    }

    const fragment = document.createDocumentFragment();
    this.tracks.forEach((track, index) => fragment.appendChild(this.buildRow(track, index)));
    this.listEl.appendChild(fragment);

    // The rows were rebuilt, so the playing/selected/focus classes have to be
    // laid down again; the fast paths are reset above so they cannot skip it.
    this.updatePlayingRows();
    this.updateFocusRow();
  },

  buildRow(track: Track, index: number): HTMLElement {
    const row = document.createElement("div");
    row.addClass("mp-row");
    // The stripe is an explicit class rather than `:nth-child`, so an error
    // placeholder or a future section header cannot silently invert it.
    row.addClass(index % 2 === 0 ? "is-even" : "is-odd");
    row.toggleClass("is-selected", this.selection.has(track.path));
    row.toggleClass("is-unplayable", !track.playable);
    row.dataset.path = track.path;
    row.draggable = true;

    // The checkbox is first so it lands in the same column as the select-all
    // button's mental position, and so Ctrl-click and checkbox-click are not
    // two different pixels to aim at.
    const check = row.createEl("button", {
      cls: "mp-check mp-row-check",
      attr: { type: "button", role: "checkbox" },
    });
    setIcon(check, "check");
    // Initial state is written here, not left to a later `syncSelectionClasses`:
    // list rebuilds (search, sort, playlist switch) do not call it, so a row
    // born selected must already carry `is-on` or its glyph stays hidden.
    check.toggleClass("is-on", this.selection.has(track.path));
    check.setAttr("aria-checked", String(this.selection.has(track.path)));
    check.setAttr("aria-label", "选中");
    check.addEventListener("click", (e) => this.onRowCheckClick(e, track, index));

    const lead = row.createDiv({ cls: "mp-row-lead" });
    const bars = lead.createDiv({ cls: "mp-row-bars" });
    bars.createDiv({ cls: "mp-row-bar" });
    bars.createDiv({ cls: "mp-row-bar" });
    bars.createDiv({ cls: "mp-row-bar" });
    lead.createDiv({ cls: "mp-row-index", text: String(index + 1) });

    const main = row.createDiv({ cls: "mp-row-main" });
    main.createDiv({ cls: "mp-row-title", text: track.title || track.name });
    main.createDiv({ cls: "mp-row-sub", text: track.artist || "未知歌手" });

    const meta = row.createDiv({ cls: "mp-row-meta" });
    meta.createSpan({ cls: "mp-row-ext", text: track.ext.toUpperCase() });
    if (!track.playable) {
      meta.createSpan({ cls: "mp-row-warn", text: "不支持播放" });
    } else {
      meta.createSpan({ cls: "mp-row-size", text: formatSize(track.size) });
    }

    const more = row.createEl("button", { cls: "mp-icon-btn mp-row-more", attr: { type: "button" } });
    setIcon(more, "more-horizontal");
    more.setAttr("aria-label", "歌曲操作");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      this.showTrackMenu(e, track);
    });

    row.addEventListener("click", (e) => this.onRowClick(e, track, index));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showTrackMenu(e, track);
    });
    row.addEventListener("dragstart", (e) => this.beginTrackDrag(e, track));
    row.addEventListener("dragend", () => this.endDrag());

    this.rowEls.set(track.path, row);
    return row;
  },

  updatePlayingRows(): void {
    if (!this.listEl) return;
    const snapshot = this.player.snapshot();
    const path = snapshot.track?.path ?? null;

    if (path !== this.paintedPath) {
      if (this.paintedPath) {
        this.rowEls.get(this.paintedPath)?.removeClass("is-current");
        this.rowEls.get(this.paintedPath)?.removeClass("is-playing");
      }
      this.paintedPath = path;
      if (path) {
        const row = this.rowEls.get(path);
        row?.addClass("is-current");
        if (row && typeof row.scrollIntoView === "function") {
          row.scrollIntoView({ block: "nearest" });
        }
      }
    }

    const current = path ? this.rowEls.get(path) : null;
    current?.toggleClass("is-playing", snapshot.playing);
  },

  updateFocusRow(): void {
    if (!this.listEl) return;
    const path = this.focusIndex >= 0 ? this.tracks[this.focusIndex]?.path ?? null : null;
    if (path === this.paintedFocus) return;
    if (this.paintedFocus) this.rowEls.get(this.paintedFocus)?.removeClass("is-focused");
    this.paintedFocus = path;
    if (path) this.rowEls.get(path)?.addClass("is-focused");
  },

  /** The empty playlist / no search results panel. */
  renderEmptyState(): void {
    const box = this.listEl.createDiv({ cls: "mp-empty" });
    const searching = this.query.length > 0;
    setIcon(box.createDiv({ cls: "mp-empty-icon" }), searching ? "search-x" : "disc-3");
    box.createDiv({
      cls: "mp-empty-title",
      text: searching ? `没有匹配「${this.query}」的歌曲` : "这个歌单还是空的",
    });
    box.createDiv({
      cls: "mp-empty-hint",
      text: searching
        ? "换个关键词试试。"
        : "点「新增歌曲」从系统里挑几首歌加进来，或者把别的歌单里的歌拖到左侧这个歌单上。",
    });
    if (!searching) {
      const actions = box.createDiv({ cls: "mp-empty-actions" });
      const add = actions.createEl("button", { text: "新增歌曲", cls: "mp-btn mod-cta" });
      add.addEventListener("click", () => void this.addSongs());
    }
  },
};
