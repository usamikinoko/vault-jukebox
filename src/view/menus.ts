/* Context menus for a track row and for a playlist row. */

import { Menu } from "obsidian";
import { revealInOS } from "../utils/shell";
import type { Track } from "../types";
import type { ViewPart } from "./viewTypes";

export interface MenuPart {
  showTrackMenu(evt: MouseEvent, track: Track): void;
  showPlaylistMenu(evt: MouseEvent, name: string): void;
}

export const menuPart: ViewPart<MenuPart> = {
  showTrackMenu(evt: MouseEvent, track: Track): void {
    const menu = new Menu();
    // Right-clicking a row that is part of the selection acts on all of it;
    // anything else acts on this row alone. Opening a menu never mutates the
    // selection on its own.
    const batch = this.selection.has(track.path) && this.selection.size > 1;
    const targets = batch ? this.selectedTracks() : [track];

    if (batch) {
      menu.addItem((item) =>
        item.setTitle(`已选中 ${targets.length} 首`).setIcon("check-check").setDisabled(true)
      );
      menu.addItem((item) =>
        item.setTitle("播放选中曲目").setIcon("play").onClick(() => this.playTrack(track))
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("批量移动…").setIcon("folder-input").onClick(() => this.pickMoveTarget(targets, evt))
      );
      menu.addItem((item) =>
        item
          .setTitle("批量删除")
          .setIcon("trash")
          .setWarning(true)
          .onClick(() => void this.deleteTracks(targets))
      );
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("复制文件路径").setIcon("copy").onClick(() => {
          void navigator.clipboard.writeText(targets.map((t) => t.path).join("\n"));
          this.plugin.notify(`已复制 ${targets.length} 条文件路径`);
        })
      );
      menu.showAtMouseEvent(evt);
      return;
    }

    menu.addItem((item) =>
      item
        .setTitle("播放")
        .setIcon("play")
        .setDisabled(!track.playable)
        .onClick(() => this.playTrack(track))
    );
    // The menu must never *silently* change the selection, but it is the natural
    // home for the explicit version of that gesture — this is the discoverable
    // path to "select this one" for a user who never tries Ctrl-click.
    const picked = this.selection.has(track.path);
    menu.addItem((item) =>
      item
        .setTitle(picked ? "取消选中" : "选中")
        .setIcon(picked ? "square" : "check-square")
        .onClick(() => {
          const index = this.tracks.findIndex((t) => t.path === track.path);
          this.toggleSelection(track.path, index);
        })
    );
    if (!track.playable) {
      menu.addItem((item) =>
        item
          .setTitle("用系统默认应用打开")
          .setIcon("external-link")
          .onClick(() => this.openTrackWithOS(track))
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("重命名…").setIcon("pencil").onClick(() => this.renameTrack(track))
    );
    menu.addItem((item) =>
      item
        .setTitle("移动到歌单…")
        .setIcon("folder-input")
        .onClick(() => this.pickMoveTarget([track], evt))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("在系统资源管理器中显示")
        .setIcon("folder-open")
        .onClick(() => this.revealTrack(track))
    );
    menu.addItem((item) =>
      item.setTitle("复制文件路径").setIcon("copy").onClick(() => this.copyTrackPath(track))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("删除")
        .setIcon("trash")
        .setWarning(true)
        .onClick(() => void this.deleteTracks([track]))
    );

    menu.showAtMouseEvent(evt);
  },

  showPlaylistMenu(evt: MouseEvent, name: string): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item.setTitle("打开歌单").setIcon("folder-open").onClick(() => this.selectPlaylist(name))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item.setTitle("新建歌单…").setIcon("folder-plus").onClick(() => this.promptNewPlaylist())
    );
    menu.addItem((item) =>
      item
        .setTitle("重命名歌单…")
        .setIcon("pencil")
        .onClick(() => this.promptRenamePlaylist(name))
    );
    menu.addItem((item) =>
      item
        .setTitle("在系统资源管理器中显示")
        .setIcon("folder-search")
        .onClick(() => revealInOS(this.app, this.playlistPath(name)))
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("删除歌单")
        .setIcon("trash")
        .setWarning(true)
        .onClick(() => this.deletePlaylist(name))
    );
    menu.showAtMouseEvent(evt);
  },
};
