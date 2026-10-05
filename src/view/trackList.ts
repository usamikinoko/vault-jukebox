/*
 * The track list's toolbar and header — the main pane's frame.
 *
 * Row painting lives in `trackRows.ts`; selection semantics in `selection.ts`.
 * This part owns the controls around the list: search, sort, select-all and the
 * "add songs" entry point.
 */

import { Menu, setIcon } from "obsidian";
import type { SortKey, Track } from "../types";
import { sortTracks } from "../library";
import type { ViewPart } from "./viewTypes";

/** Search keystrokes coalesce into one list repaint after this delay. */
const SEARCH_DEBOUNCE_MS = 140;

const SORT_LABELS: Array<{ value: SortKey; label: string }> = [
  { value: "name", label: "文件名" },
  { value: "title", label: "曲名" },
  { value: "artist", label: "歌手" },
  { value: "mtime", label: "修改时间" },
  { value: "size", label: "文件大小" },
];

function sortLabel(key: SortKey): string {
  return SORT_LABELS.find((o) => o.value === key)?.label ?? "文件名";
}

export interface ListPart {
  buildMain(parent: HTMLElement): void;
  /** Recompute `tracks` from the active playlist, the query and the sort. */
  refreshTracks(): void;
  renderHead(): void;
  /** Keep the toolbar's select-all button in step with the selection. */
  updateSelectAll(): void;
  activeTracks(): Track[];
  /** A menu rather than a `<select>`: see track-list.css for why. */
  showSortMenu(evt: MouseEvent): void;
}

export const listPart: ViewPart<ListPart> = {
  buildMain(parent: HTMLElement): void {
    const main = parent.createDiv({ cls: "mp-main" });
    this.mainEl = main;

    const head = main.createDiv({ cls: "mp-head" });
    const title = head.createDiv({ cls: "mp-head-title" });
    this.headTitleEl = title.createDiv({ cls: "mp-title" });
    this.headCountEl = title.createDiv({ cls: "mp-count" });

    const actions = head.createDiv({ cls: "mp-head-actions" });

    const search = actions.createEl("input", {
      cls: "mp-search",
      attr: { type: "search", placeholder: "搜索曲名或歌手…" },
    });
    this.searchEl = search;
    search.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.query = search.value.trim().toLowerCase();
        this.focusIndex = -1;
        this.refreshTracks();
        this.renderList();
        this.renderHead();
      }, SEARCH_DEBOUNCE_MS);
    });

    // Sort: a button that opens a menu, not a <select>. See track-list.css for
    // why the native control was the one thing in this bar that never matched.
    const sort = actions.createEl("button", {
      cls: "mp-btn mp-sort-btn",
      attr: { type: "button" },
    });
    this.sortBtnEl = sort;
    sort.createSpan({ cls: "mp-sort-label", text: "排序" });
    this.sortValueEl = sort.createSpan({ cls: "mp-sort-value" });
    setIcon(sort.createSpan({ cls: "mp-icon" }), "chevron-down");
    sort.setAttr("aria-label", "排序方式");
    sort.setAttr("title", "排序方式");
    sort.addEventListener("click", (e) => this.showSortMenu(e));

    const dir = actions.createEl("button", { cls: "mp-icon-btn", attr: { type: "button" } });
    this.sortDirEl = dir;
    dir.addEventListener("click", () => {
      this.plugin.settings.sortAsc = !this.plugin.settings.sortAsc;
      void this.plugin.saveSettings();
      this.refreshTracks();
      this.renderList();
      this.renderHead();
    });

    // Select-all lives in the toolbar rather than in a list header: it is the
    // only "act on everything" control in the pane, and the toolbar is already
    // where the pane-wide controls are.
    const all = actions.createEl("button", { cls: "mp-icon-btn", attr: { type: "button" } });
    this.selectAllEl = all;
    all.addEventListener("click", () => {
      if (this.tracks.length > 0 && this.tracks.every((t) => this.selection.has(t.path))) {
        this.clearSelection();
      } else {
        this.selectAll();
      }
    });

    const add = actions.createEl("button", { cls: "mp-btn mod-cta", attr: { type: "button" } });
    setIcon(add.createSpan({ cls: "mp-icon" }), "file-plus-2");
    add.createSpan({ text: "新增歌曲" });
    add.addEventListener("click", () => void this.addSongs());

    this.selBarEl = main.createDiv({ cls: "mp-selbar is-hidden" });

    this.listWrapEl = main.createDiv({ cls: "mp-list-wrap" });
    this.listEl = this.listWrapEl.createDiv({ cls: "mp-list" });
  },

  showSortMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.plugin.settings.sortKey;
    menu.addItem((item) => item.setTitle("排序方式").setDisabled(true));
    menu.addSeparator();
    for (const option of SORT_LABELS) {
      menu.addItem((item) =>
        item
          .setTitle(option.label)
          .setChecked(option.value === current)
          .onClick(() => {
            this.plugin.settings.sortKey = option.value;
            void this.plugin.saveSettings();
            this.refreshTracks();
            this.renderList();
            this.renderHead();
          })
      );
    }
    const rect = this.sortBtnEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  },

  activeTracks(): Track[] {
    const library = this.library;
    if (!library) return [];
    return library.playlists.find((p) => p.name === this.activePlaylist)?.tracks ?? [];
  },

  refreshTracks(): void {
    const settings = this.plugin.settings;
    const sorted = sortTracks(this.activeTracks(), settings.sortKey, settings.sortAsc);
    const q = this.query;
    this.tracks = q
      ? sorted.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.artist.toLowerCase().includes(q) ||
            t.name.toLowerCase().includes(q)
        )
      : sorted;
  },

  renderHead(): void {
    if (!this.headTitleEl) return;
    if (this.problem) {
      this.headTitleEl.setText("音乐库");
      this.headCountEl.setText("");
      return;
    }
    const library = this.library;
    this.headTitleEl.setText(
      this.activePlaylist || (library ? library.name : "音乐库")
    );

    const total = this.activeTracks().length;
    const shown = this.tracks.length;
    this.headCountEl.setText(
      this.query && shown !== total ? `${shown} / ${total} 首` : `${total} 首`
    );

    const settings = this.plugin.settings;
    this.sortValueEl.setText(sortLabel(settings.sortKey));

    this.sortDirEl.empty();
    setIcon(
      this.sortDirEl,
      settings.sortAsc ? "arrow-up-narrow-wide" : "arrow-down-wide-narrow"
    );
    this.sortDirEl.setAttr("title", settings.sortAsc ? "升序，点击改为降序" : "降序，点击改为升序");

    this.updateSelectAll();
  },

  updateSelectAll(): void {
    if (!this.selectAllEl) return;
    const allSelected =
      this.tracks.length > 0 && this.tracks.every((t) => this.selection.has(t.path));
    this.selectAllEl.toggleClass("is-alt", this.selection.size > 0);
    this.selectAllEl.empty();
    setIcon(this.selectAllEl, allSelected ? "check-square" : "square");
    this.selectAllEl.setAttr("aria-label", allSelected ? "取消全选" : "全选");
    this.selectAllEl.setAttr("title", allSelected ? "取消全选" : "全选当前列表");
  },
};
