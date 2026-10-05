/*
 * The playlist column.
 *
 * A playlist *is* a direct subfolder of the music root, so this column is the
 * folder tree — flattened to the one level the plugin allows. Selecting a row
 * changes what the list shows and nothing else; the queue is not touched until
 * the user actually plays something, which is what keeps the current song
 * playing while you browse.
 */

import { TFolder, setIcon } from "obsidian";
import { DEFAULT_PLAYLIST } from "../types";
import { createPlaylistFolder, trashFile } from "../library";
import { isValidFileName } from "../parse";
import { joinPath } from "../utils/paths";
import { ConfirmModal } from "../ui/confirmModal";
import { PromptModal } from "../ui/promptModal";
import type { ViewPart } from "./viewTypes";

export interface TreePart {
  buildSidebar(parent: HTMLElement): void;
  renderTree(): void;
  selectPlaylist(name: string): void;
  promptNewPlaylist(): void;
  promptRenamePlaylist(name: string): void;
  deletePlaylist(name: string): void;
  playlistPath(name: string): string;
  makePlaylistDropTarget(row: HTMLElement, name: string): void;
}

export const treePart: ViewPart<TreePart> = {
  playlistPath(name: string): string {
    return joinPath(this.library?.root ?? "", name);
  },

  buildSidebar(parent: HTMLElement): void {
    const side = parent.createDiv({ cls: "mp-sidebar" });
    const head = side.createDiv({ cls: "mp-sidebar-head" });

    const label = head.createDiv({ cls: "mp-sidebar-label" });
    setIcon(label.createSpan({ cls: "mp-icon" }), "list-music");
    label.createSpan({ text: "歌单" });

    const tools = head.createDiv({ cls: "mp-sidebar-tools" });

    const settings = tools.createEl("button", { cls: "mp-icon-btn", attr: { type: "button" } });
    setIcon(settings, "settings-2");
    settings.setAttr("aria-label", "插件设置");
    settings.setAttr("title", "插件设置");
    settings.addEventListener("click", () => this.plugin.openSettings());

    const add = tools.createEl("button", { cls: "mp-icon-btn", attr: { type: "button" } });
    setIcon(add, "folder-plus");
    add.setAttr("aria-label", "新建歌单");
    add.setAttr("title", "新建歌单");
    add.addEventListener("click", () => this.promptNewPlaylist());

    this.treeEl = side.createDiv({ cls: "mp-tree" });
  },

  renderTree(): void {
    this.treeEl.empty();
    const library = this.library;
    if (!library) return;

    const rootRow = this.treeEl.createDiv({ cls: "mp-tree-root" });
    setIcon(rootRow.createSpan({ cls: "mp-icon" }), "music");
    rootRow.createSpan({ cls: "mp-tree-name", text: library.name });
    rootRow.setAttr("title", library.root);

    if (library.playlists.length === 0) {
      this.treeEl.createDiv({ cls: "mp-tree-empty", text: "还没有子目录，点右上角新建一个歌单。" });
      return;
    }

    for (const playlist of library.playlists) {
      const row = this.treeEl.createDiv({ cls: "mp-tree-row" });
      row.dataset.playlist = playlist.name;
      row.toggleClass("is-active", playlist.name === this.activePlaylist);
      setIcon(
        row.createSpan({ cls: "mp-icon" }),
        playlist.name === DEFAULT_PLAYLIST ? "inbox" : "folder"
      );
      row.createSpan({ cls: "mp-tree-name", text: playlist.name });
      row.createSpan({ cls: "mp-tree-badge", text: String(playlist.tracks.length) });

      row.addEventListener("click", () => this.selectPlaylist(playlist.name));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.showPlaylistMenu(e, playlist.name);
      });
      this.makePlaylistDropTarget(row, playlist.name);
    }
  },

  selectPlaylist(name: string): void {
    if (name === this.activePlaylist) return;
    this.activePlaylist = name;
    this.plugin.settings.lastPlaylist = name;
    this.selection.clear();
    this.anchor = null;
    this.focusIndex = -1;
    this.refreshTracks();
    this.renderTree();
    this.renderHead();
    this.renderList();
    this.renderSelBar();
  },

  promptNewPlaylist(): void {
    const root = this.library?.root;
    if (!root) return;
    const existing = new Set(this.playlists.map((p) => p.name));
    new PromptModal(this.app, {
      heading: "新建歌单",
      initial: "",
      placeholder: "歌单名称",
      submitLabel: "创建",
      validate: (value) => {
        if (!isValidFileName(value)) return "名称里有不能用于文件名的字符";
        if (existing.has(value)) return "已存在同名歌单";
        return null;
      },
      onSubmit: async (value) => {
        const folder = await createPlaylistFolder(this.app, root, value);
        if (!folder) {
          this.plugin.notify("创建失败，可能已存在同名目录");
          return;
        }
        this.activePlaylist = value;
        await this.reloadLibrary();
      },
    }).open();
  },

  promptRenamePlaylist(name: string): void {
    const source = this.app.vault.getAbstractFileByPath(this.playlistPath(name));
    if (!(source instanceof TFolder)) return;
    const root = this.library?.root ?? "";
    const existing = new Set(this.playlists.map((p) => p.name));

    new PromptModal(this.app, {
      heading: "重命名歌单",
      initial: name,
      submitLabel: "重命名",
      validate: (value) => {
        if (value === name) return null;
        if (!isValidFileName(value)) return "名称里有不能用于文件名的字符";
        if (existing.has(value)) return "已存在同名歌单";
        return null;
      },
      onSubmit: async (value) => {
        if (value === name) return;
        try {
          await this.app.fileManager.renameFile(source, joinPath(root, value));
        } catch (err) {
          this.plugin.notify(`重命名失败：${name} —— ${String(err)}`);
          return;
        }
        if (this.activePlaylist === name) this.activePlaylist = value;
        await this.reloadLibrary();
      },
    }).open();
  },

  deletePlaylist(name: string): void {
    const folder = this.app.vault.getAbstractFileByPath(this.playlistPath(name));
    if (!(folder instanceof TFolder)) return;

    const run = async () => {
      const trashed = await trashFile(this.app, folder);
      if (!trashed.ok) {
        this.plugin.notify(`删除失败：${name} —— ${trashed.reason}`);
        return;
      }
      if (this.activePlaylist === name) this.activePlaylist = "";
      await this.reloadLibrary();
    };

    if (!this.plugin.settings.confirmDelete) {
      void run();
      return;
    }
    const count = this.playlists.find((p) => p.name === name)?.tracks.length ?? 0;
    new ConfirmModal(
      this.app,
      `删除歌单「${name}」？`,
      count > 0
        ? `其中的 ${count} 首歌曲会一起移入系统回收站。`
        : "这个歌单是空的，删除后目录会被移入系统回收站。",
      "移入回收站",
      () => void run()
    ).open();
  },

  /**
   * Playlist rows are the drop targets for the list's drag-and-drop move.
   * Blocked drops (onto the track's own folder) are shown as blocked rather
   * than silently ignored — a drop that does nothing reads as a bug.
   */
  makePlaylistDropTarget(row: HTMLElement, name: string): void {
    const clear = () => row.removeClass("is-drop-target");
    row.addEventListener("dragover", (e) => {
      const drag = this.drag;
      if (!drag || drag.kind !== "tracks") return;
      const target = this.playlistPath(name);
      const sameFolder = drag.paths.every((p) => p.startsWith(`${target}/`));
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = sameFolder ? "none" : "move";
      row.toggleClass("is-drop-target", !sameFolder);
    });
    row.addEventListener("dragleave", clear);
    row.addEventListener("drop", (e) => {
      clear();
      const drag = this.drag;
      if (!drag || drag.kind !== "tracks") return;
      e.preventDefault();
      e.stopPropagation();
      void this.dropTracksOn(name, drag.paths);
    });
    // A drop that lands anywhere else must not leave the highlight behind.
    row.addEventListener("dragend", clear);
  },
};
