/*
 * The status-bar readout: what is playing right now, and a way back to the tab.
 *
 * It exists because the player is a singleton — music keeps going when the tab
 * is closed, so there has to be a permanent, visible way to notice that and to
 * get back.
 */

import { setIcon } from "obsidian";
import type { PlayerSnapshot } from "./player";

export class StatusBarControl {
  private iconEl: HTMLElement;
  private labelEl: HTMLElement;
  private lastLabel = "";

  constructor(
    private host: HTMLElement,
    onClick: () => void
  ) {
    this.host.addClass("mp-status");
    this.iconEl = this.host.createSpan({ cls: "mp-status-icon" });
    this.labelEl = this.host.createSpan({ cls: "mp-status-label" });
    this.host.addEventListener("click", onClick);
    this.update(null);
  }

  update(snapshot: PlayerSnapshot | null): void {
    const track = snapshot?.track ?? null;
    const label = track
      ? `${track.artist ? `${track.artist} — ` : ""}${track.title}`
      : "未在播放";
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.labelEl.setText(label);
      this.labelEl.setAttr("title", track ? track.path : "Vault Jukebox");
    }
    const icon = !track ? "music" : snapshot?.playing ? "pause" : "play";
    this.iconEl.empty();
    setIcon(this.iconEl, icon);
    this.host.toggleClass("is-playing", !!snapshot?.playing);
    this.host.toggleClass("is-idle", !track);
  }

  setVisible(visible: boolean): void {
    this.host.toggleClass("is-hidden", !visible);
  }

  dispose(): void {
    this.host.remove();
  }
}
