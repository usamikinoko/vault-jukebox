/*
 * Drag state for the list → playlist-tree move.
 *
 * The payload is a discriminated union from the start, so adding "drag a whole
 * playlist" later does not mean rewriting every drop handler.
 */

import { TFile } from "obsidian";
import { moveTracks } from "../library";
import type { Track } from "../types";
import type { ViewPart } from "./viewTypes";

export interface DragPart {
  beginTrackDrag(evt: DragEvent, track: Track): void;
  endDrag(): void;
  dropTracksOn(playlistName: string, paths: string[]): Promise<void>;
}

export const dragPart: ViewPart<DragPart> = {
  beginTrackDrag(evt: DragEvent, track: Track): void {
    // Dragging a row that is part of a multi-selection moves the whole
    // selection; anything else drags just itself — and does not disturb the
    // selection, because grabbing a file is not a way of selecting it.
    const inSelection = this.selection.has(track.path) && this.selection.size > 1;
    const paths = inSelection ? [...this.selection] : [track.path];
    this.drag = { kind: "tracks", paths };

    if (evt.dataTransfer) {
      evt.dataTransfer.effectAllowed = "move";
      evt.dataTransfer.setData("text/plain", paths.join("\n"));
    }
  },

  endDrag(): void {
    this.drag = null;
    this.listEl?.querySelectorAll(".is-drop-target").forEach((el) => {
      el.removeClass("is-drop-target");
    });
    this.treeEl?.querySelectorAll(".is-drop-target").forEach((el) => {
      el.removeClass("is-drop-target");
    });
  },

  async dropTracksOn(playlistName: string, paths: string[]): Promise<void> {
    const target = this.playlistPath(playlistName);
    const files = paths
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile);
    const moving = files.filter((f) => f.parent?.path !== target);

    if (moving.length === 0) {
      this.plugin.notify(`这些歌曲已经在「${playlistName}」里了`);
      return;
    }
    const moved = await moveTracks(this.app, moving, target);
    if (moved > 0) this.plugin.notify(`已移动 ${moved} 首到「${playlistName}」`);
    await this.reloadLibrary();
  },
};
