/* Mount / unmount, and the scan that feeds everything else. */

import { setIcon } from "obsidian";
import { DEFAULT_PLAYLIST, type Library } from "../types";
import { createPlaylistFolder, ensureFolder, moveTracks, scanLibrary, allTracks } from "../library";
import { cleanPath, joinPath } from "../utils/paths";
import { VIEW_TYPE_VAULT_JUKEBOX } from "./viewTypes";
import type { ViewPart } from "./viewTypes";

/**
 * Deliberately *not* part of `LifecyclePart`: `ItemView` declares both of these
 * `protected`, and an interface cannot widen that. They are still installed and
 * still type-checked — just not merged into the class type.
 */
interface MountPart {
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
}

export interface LifecyclePart {
  getViewType(): string;
  getDisplayText(): string;
  getIcon(): string;
  /** Re-read the vault, reconcile it with the player, then repaint. */
  reloadLibrary(): Promise<void>;
  /** Repaint every region from the state already loaded. */
  renderAll(): void;
  renderProblem(kind: "unset" | "missing", root: string): void;
}

export const lifecyclePart: ViewPart<LifecyclePart & MountPart> = {
  getViewType(): string {
    return VIEW_TYPE_VAULT_JUKEBOX;
  },

  getDisplayText(): string {
    return "音乐播放器";
  },

  getIcon(): string {
    return "music";
  },

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("mp-root");
    container.tabIndex = 0;

    const body = container.createDiv({ cls: "mp-body" });

    this.buildSidebar(body);
    this.buildMain(body);
    // The bar goes *inside* the main column, not under the whole view: the
    // sidebar then runs its full height and the transport lines up with the
    // list above it, so the pane has two vertical rules (the list's left and
    // right edges) instead of three.
    this.buildPlayerBar(this.mainEl);

    container.addEventListener("keydown", (e) => this.onKeyDown(e));

    // The engine outlives this view, so a re-opened tab has to redraw itself
    // from the player's current state rather than from a fresh, silent start.
    this.unsubPlayer = this.player.subscribe((event) => {
      if (event === "time" || event === "volume" || event === "loop") {
        this.syncPlayerBar();
      } else {
        this.syncPlayerBar();
        this.updatePlayingRows();
      }
    });

    await this.reloadLibrary();
    this.syncPlayerBar();
  },

  async onClose(): Promise<void> {
    window.clearTimeout(this.searchTimer);
    this.searchTimer = 0;
    this.unsubPlayer?.();
    this.unsubPlayer = null;
    this.endDrag();
    this.contentEl.empty();
  },

  async reloadLibrary(): Promise<void> {
    // Moving root-level songs is a mutation; a second scan re-entering while
    // the first is still renaming files would fight over the same names.
    if (this.scanning) return;
    this.scanning = true;
    try {
      const settings = this.plugin.settings;
      const root = cleanPath(settings.musicRoot);

      if (!root) {
        this.library = null;
        this.playlists = [];
        this.tracks = [];
        this.problem = "unset";
        this.renderAll();
        return;
      }

      let library: Library | null = scanLibrary(this.app, root, settings.audioExtensions);
      if (!library) {
        this.library = null;
        this.playlists = [];
        this.tracks = [];
        this.problem = "missing";
        this.renderAll();
        return;
      }

      // 1. A music folder with no `default` gets one, so there is always at
      //    least one place a new song can land.
      if (!library.playlists.some((p) => p.name === DEFAULT_PLAYLIST)) {
        const created = await createPlaylistFolder(this.app, root, DEFAULT_PLAYLIST);
        if (created) {
          library = scanLibrary(this.app, root, settings.audioExtensions) ?? library;
        }
      }

      // 2. Songs dropped straight into the music folder are swept into
      //    `default`, because the tree only ever shows subfolders and a file
      //    nobody can see is worse than one that moved.
      if (library.rootSongs.length > 0) {
        const moved = await moveTracks(
          this.app,
          library.rootSongs,
          joinPath(root, DEFAULT_PLAYLIST)
        );
        if (moved > 0) {
          this.plugin.notify(
            `已将 ${moved} 首根目录下的歌曲移入 ${DEFAULT_PLAYLIST}/`
          );
          library = scanLibrary(this.app, root, settings.audioExtensions) ?? library;
        }
      }

      this.library = library;
      this.problem = null;
      this.playlists = library.playlists;

      const names = this.playlists.map((p) => p.name);
      if (!names.includes(this.activePlaylist)) {
        const remembered = settings.lastPlaylist;
        if (names.includes(remembered)) {
          this.activePlaylist = remembered;
        } else {
          // Land on a playlist that actually has music in it: the folder that
          // happens to sort first is as likely as not to be an empty one, and
          // opening onto "this playlist is empty" reads as a broken plugin.
          const firstFilled =
            library.playlists.find((p) => p.tracks.length > 0) ?? library.playlists[0];
          this.activePlaylist = firstFilled?.name ?? "";
        }
      }
      settings.lastPlaylist = this.activePlaylist;

      // Renames and deletions made outside this view have to reach the queue,
      // or "next" would walk into files that no longer exist.
      this.player.syncTracks(allTracks(library));

      this.refreshTracks();
      this.renderAll();
    } finally {
      this.scanning = false;
    }
  },

  renderAll(): void {
    this.renderTree();
    this.renderHead();
    this.renderList();
    this.renderSelBar();
    this.syncPlayerBar();
  },

  renderProblem(kind: "unset" | "missing", root: string): void {
    const box = this.listEl.createDiv({ cls: "mp-empty" });
    setIcon(
      box.createDiv({ cls: "mp-empty-icon" }),
      kind === "unset" ? "music-2" : "folder-x"
    );
    box.createDiv({
      cls: "mp-empty-title",
      text: kind === "unset" ? "还没有设置音乐目录" : "找不到这个目录",
    });
    box.createDiv({
      cls: "mp-empty-hint",
      text:
        kind === "unset"
          ? "选择 vault 里的一个目录作为音乐库。它的第一层子目录会成为歌单。"
          : `${root} 不在当前 vault 中。换一个目录，或者先把它建出来。`,
    });

    const actions = box.createDiv({ cls: "mp-empty-actions" });
    const pick = actions.createEl("button", { text: "选择音乐目录", cls: "mp-btn mod-cta" });
    pick.addEventListener("click", () => this.plugin.pickMusicRoot());

    if (kind === "missing") {
      const create = actions.createEl("button", { text: "创建该目录", cls: "mp-btn" });
      create.addEventListener("click", async () => {
        await ensureFolder(this.app, root);
        await this.reloadLibrary();
      });
    }
  },
};
