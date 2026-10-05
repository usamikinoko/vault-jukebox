/*
 * Keyboard shortcuts, scoped to the view.
 *
 * `contentEl` gets a tabIndex in `onOpen`, without which keydown never reaches
 * here; and anything typed into an input, a select or the seek slider is left
 * alone, so the search box and the volume keys keep working.
 *
 * Arrow keys move a cursor and do not select. That is the same rule the mouse
 * follows: moving the eye is not the same as picking something up. `x` is what
 * picks the row up.
 */

import type { ViewPart } from "./viewTypes";

export interface KeyboardPart {
  onKeyDown(evt: KeyboardEvent): void;
  moveFocus(delta: number): void;
}

export const keyboardPart: ViewPart<KeyboardPart> = {
  onKeyDown(evt: KeyboardEvent): void {
    const target = evt.target as HTMLElement | null;
    const tag = target?.tagName ?? "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    const step = this.plugin.settings.seekStep;
    const mod = evt.ctrlKey || evt.metaKey;

    if (mod && (evt.key === "a" || evt.key === "A")) {
      evt.preventDefault();
      this.selectAll();
      return;
    }

    switch (evt.key) {
      case " ":
        evt.preventDefault();
        this.player.toggle();
        return;
      case "ArrowRight":
        evt.preventDefault();
        this.player.seekBy(step);
        return;
      case "ArrowLeft":
        evt.preventDefault();
        this.player.seekBy(-step);
        return;
      case "ArrowDown":
        evt.preventDefault();
        this.moveFocus(1);
        return;
      case "ArrowUp":
        evt.preventDefault();
        this.moveFocus(-1);
        return;
      case "Enter": {
        const track = this.tracks[this.focusIndex];
        if (track) {
          evt.preventDefault();
          this.playTrack(track);
        }
        return;
      }
      // The keyboard twin of ticking the checkbox.
      case "x":
      case "X": {
        const track = this.tracks[this.focusIndex];
        if (!track) return;
        evt.preventDefault();
        this.toggleSelection(track.path, this.focusIndex);
        return;
      }
      case "Escape": {
        if (this.selection.size === 0) return;
        evt.preventDefault();
        this.clearSelection();
        return;
      }
      case "Delete":
      case "Backspace": {
        if (this.selection.size === 0) return;
        evt.preventDefault();
        void this.deleteTracks(this.selectedTracks());
        return;
      }
      default:
        break;
    }
  },

  /**
   * Arrow keys move a single-row cursor. The cursor is *not* a selection — see
   * the file comment — so this deliberately does not touch `selection`.
   */
  moveFocus(delta: number): void {
    const count = this.tracks.length;
    if (count === 0) return;
    const next =
      this.focusIndex < 0
        ? delta > 0
          ? 0
          : count - 1
        : Math.min(count - 1, Math.max(0, this.focusIndex + delta));

    this.focusIndex = next;
    const track = this.tracks[next];
    // The anchor follows the cursor, so a Shift-click after arrowing down ranges
    // from where the user is looking rather than from wherever they last clicked.
    this.anchor = track.path;
    this.updateFocusRow();

    const row = this.rowEls.get(track.path);
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  },
};
