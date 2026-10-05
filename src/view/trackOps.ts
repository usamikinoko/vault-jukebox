/*
 * Everything that mutates the library: play, rename, delete, import, move.
 *
 * All of it ends in `reloadLibrary()`, which is what re-syncs the playlist tree,
 * the player queue and the row mapping in one place — a mutation that forgets
 * one of the three is how a list ends up disagreeing with the disk.
 */

import { Menu, TFile } from "obsidian";
import { importAudioFiles, moveTracks, trashFile } from "../library";
import { isValidFileName } from "../parse";
import type { Track } from "../types";
import { parentPath, joinPath } from "../utils/paths";
import { openWithOS, revealInOS } from "../utils/shell";
import { ConfirmModal } from "../ui/confirmModal";
import { PromptModal } from "../ui/promptModal";
import { pickAudioFiles } from "../ui/filePicker";
import type { ViewPart } from "./viewTypes";

/** Keeps the original casing of ".FLAC" instead of normalising it to ".flac". */
function rawExtOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1);
}

export interface OpsPart {
  playTrack(track: Track): void;
  /** Playlist a new import should land in; falls back to the first one. */
  currentPlaylistName(): string;
  renameTrack(track: Track): void;
  deleteTracks(tracks: Track[]): Promise<void>;
  addSongs(): Promise<void>;
  moveSelection(): void;
  /** Build the "move to playlist" chooser for an explicit set of tracks. */
  pickMoveTarget(tracks: Track[], evt?: MouseEvent): void;
  moveTracksTo(tracks: Track[], playlistName: string): Promise<void>;
  revealTrack(track: Track): void;
  openTrackWithOS(track: Track): void;
  copyTrackPath(track: Track): void;
}

export const opsPart: ViewPart<OpsPart> = {
  playTrack(track: Track): void {
    if (!track.playable) {
      this.plugin.notify(
        `不支持播放 .${track.ext} 音频：可以用「用系统默认应用打开」收听。`
      );
      return;
    }
    const ok = this.player.playFrom(this.queueTracks(), track.path);
    if (!ok) this.player.playFrom([track], track.path);
    this.updatePlayingRows();
  },

  renameTrack(track: Track): void {
    const folder = parentPath(track.path);
    const ext = rawExtOf(track.path);

    new PromptModal(this.app, {
      heading: "重命名歌曲",
      initial: track.name,
      placeholder: "曲名_歌手",
      submitLabel: "重命名",
      validate: (value) => {
        if (value === track.name) return null;
        if (!isValidFileName(value)) return "名称里有不能用于文件名的字符";
        const target = joinPath(folder, ext ? `${value}.${ext}` : value);
        if (this.app.vault.getAbstractFileByPath(target)) return "已存在同名文件";
        return null;
      },
      onSubmit: async (value) => {
        if (value === track.name) return;
        const target = joinPath(folder, ext ? `${value}.${ext}` : value);
        try {
          // renameFile, not adapter.rename: any wiki-link pointing at this
          // audio file follows the new name.
          await this.app.fileManager.renameFile(track.file, target);
        } catch (err) {
          this.plugin.notify(`重命名失败：${track.name} —— ${String(err)}`);
          return;
        }
        await this.reloadLibrary();
      },
    }).open();
  },

  async deleteTracks(tracks: Track[]): Promise<void> {
    if (tracks.length === 0) return;

    const run = async () => {
      let removed = 0;
      for (const track of tracks) {
        const trashed = await trashFile(this.app, track.file);
        if (trashed.ok) removed++;
        // Reported per file, and the rest of the batch carries on: a track
        // locked by an external player must not cost the user the other nine.
        else this.plugin.notify(`删除失败：${track.name} —— ${trashed.reason}`);
      }
      for (const track of tracks) this.selection.delete(track.path);
      this.anchor = null;
      this.selSignature = null;
      if (removed > 0) {
        this.plugin.notify(`已将 ${removed} 首移入回收站`);
      }
      await this.reloadLibrary();
    };

    if (!this.plugin.settings.confirmDelete) {
      await run();
      return;
    }
    const preview = tracks.slice(0, 6).map((t) => t.title || t.name).join("、");
    new ConfirmModal(
      this.app,
      tracks.length === 1 ? "删除这首歌曲？" : `删除 ${tracks.length} 首歌？`,
      `${preview}${tracks.length > 6 ? " 等" : ""} —— 文件会被移入系统回收站。`,
      "移入回收站",
      () => void run()
    ).open();
  },

  async addSongs(): Promise<void> {
    if (!this.library || !this.activePlaylist) {
      this.plugin.notify("先设置音乐目录再添加歌曲");
      this.plugin.pickMusicRoot();
      return;
    }
    const paths = await pickAudioFiles(this.plugin.settings.audioExtensions);
    if (paths.length === 0) return;

    const target = this.currentPlaylistName();
    const { imported, failed } = await importAudioFiles(
      this.app,
      paths,
      this.playlistPath(target)
    );
    if (imported === 0) {
      this.plugin.notify("没有歌曲被加入");
    } else {
      this.plugin.notify(
        `已加入 ${imported} 首到「${target}」${failed > 0 ? `，${failed} 首失败` : ""}`
      );
    }
    await this.reloadLibrary();
  },

  currentPlaylistName(): string {
    return this.activePlaylist || this.playlists[0]?.name || "";
  },

  moveSelection(): void {
    this.pickMoveTarget(this.selectedTracks());
  },

  /**
   * The playlist chooser. Takes the tracks explicitly rather than reading the
   * selection, so the row menu can move one track without first having to make
   * that track "selected" — which is the sort of side effect a context menu
   * should never have.
   */
  pickMoveTarget(tracks: Track[], evt?: MouseEvent): void {
    if (tracks.length === 0) return;
    const current = parentPath(tracks[0].path);

    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle(tracks.length > 1 ? `移动 ${tracks.length} 首到歌单` : "移动到歌单").setDisabled(true)
    );
    menu.addSeparator();
    for (const playlist of this.playlists) {
      const path = this.playlistPath(playlist.name);
      menu.addItem((item) =>
        item
          .setTitle(playlist.name)
          .setChecked(path === current)
          .setDisabled(path === current)
          .onClick(() => void this.moveTracksTo(tracks, playlist.name))
      );
    }
    if (evt) {
      menu.showAtMouseEvent(evt);
      return;
    }
    const rect = this.selBarEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left + 12, y: rect.bottom + 4 });
  },

  async moveTracksTo(tracks: Track[], playlistName: string): Promise<void> {
    const target = this.playlistPath(playlistName);
    const files = tracks
      .map((t) => t.file)
      .filter((f): f is TFile => f instanceof TFile && f.parent?.path !== target);
    if (files.length === 0) {
      this.plugin.notify(`这些歌曲已经在「${playlistName}」里了`);
      return;
    }
    const moved = await moveTracks(this.app, files, target);
    if (moved > 0) this.plugin.notify(`已移动 ${moved} 首到「${playlistName}」`);
    // Only the tracks that actually moved leave the selection; a single-track
    // move out of the row menu must not clear a selection it never touched.
    for (const track of tracks) {
      if (files.includes(track.file)) this.selection.delete(track.path);
    }
    this.anchor = null;
    this.selSignature = null;
    await this.reloadLibrary();
  },

  revealTrack(track: Track): void {
    revealInOS(this.app, track.path);
  },

  openTrackWithOS(track: Track): void {
    openWithOS(this.app, track.path);
  },

  copyTrackPath(track: Track): void {
    void navigator.clipboard.writeText(track.path);
    this.plugin.notify("已复制文件路径");
  },
};
