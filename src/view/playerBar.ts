/*
 * The transport bar.
 *
 * Every control reads the engine and writes to the engine — this part keeps no
 * playback state of its own. The one exception is `seeking`, which exists
 * because a slider being dragged and a slider being driven by `timeupdate`
 * cannot both own the same thumb.
 *
 * The layout is three zones with fixed meaning, because a flat row of nine
 * controls is nine controls you have to read every time:
 *
 *   left    what is playing
 *   centre  what you press — prev · ⏪ · play · ⏩ · next
 *   right   what is switched — loop · speed · mute · volume
 *
 * The loop button used to sit in the middle of the transport cluster, which is
 * where a mode switch is least expected: it looks like a sixth transport button
 * and it changes a setting.
 */

import { Menu, setIcon } from "obsidian";
import type { LoopMode } from "../types";
import { RATE_STEPS, formatRate } from "../types";
import { formatTime } from "../parse";
import type { ViewPart } from "./viewTypes";

const LOOP_ICON: Record<LoopMode, string> = {
  all: "repeat",
  one: "repeat-1",
  shuffle: "shuffle",
};

const LOOP_LABEL: Record<LoopMode, string> = {
  all: "歌单循环",
  one: "单曲循环",
  shuffle: "随机播放",
};

const LOOP_ORDER: LoopMode[] = ["all", "one", "shuffle"];

/**
 * Paint the played portion of a range input via the `--mp-fill` token the
 * stylesheet turns into a gradient stop. A range input has no element to style
 * as "the part behind the thumb", so this one number is how progress is shown.
 */
function paintFill(el: HTMLInputElement, ratio: number): void {
  const pct = Math.min(1, Math.max(0, ratio)) * 100;
  el.style.setProperty("--mp-fill", `${pct.toFixed(2)}%`);
}

export interface PlayerBarPart {
  buildPlayerBar(parent: HTMLElement): void;
  syncPlayerBar(): void;
  showRateMenu(evt: MouseEvent): void;
}

export const playerBarPart: ViewPart<PlayerBarPart> = {
  buildPlayerBar(parent: HTMLElement): void {
    const bar = parent.createDiv({ cls: "mp-player" });
    this.playerEl = bar;

    // --- seek row ---
    const seekRow = bar.createDiv({ cls: "mp-seek-row" });
    this.curTimeEl = seekRow.createSpan({ cls: "mp-time", text: "0:00" });
    const seek = seekRow.createEl("input", {
      cls: "mp-range mp-seek",
      attr: { type: "range", min: "0", max: "1000", step: "1", value: "0" },
    });
    this.seekEl = seek;
    this.totalTimeEl = seekRow.createSpan({ cls: "mp-time", text: "0:00" });

    // The rewind/forward buttons move in `seekStep` seconds and the two
    // labels are the only place that number is visible.
    const step = () => this.plugin.settings.seekStep;
    const labelStep = () => {
      this.backBtnEl.setAttr("title", `后退 ${step()} 秒`);
      this.fwdBtnEl.setAttr("title", `前进 ${step()} 秒`);
    };

    seek.addEventListener("pointerdown", () => {
      this.seeking = true;
    });
    seek.addEventListener("input", () => {
      this.seeking = true;
      const duration = this.player.duration;
      const ratio = Number(seek.value) / 1000;
      paintFill(seek, ratio);
      if (duration > 0) this.curTimeEl.setText(formatTime(ratio * duration));
    });
    seek.addEventListener("change", () => {
      const duration = this.player.duration;
      this.seeking = false;
      if (duration > 0) this.player.seek((Number(seek.value) / 1000) * duration);
    });
    seek.addEventListener("blur", () => {
      this.seeking = false;
    });

    // --- control row ---
    const row = bar.createDiv({ cls: "mp-control-row" });

    const now = row.createDiv({ cls: "mp-now" });
    this.nowTitleEl = now.createDiv({ cls: "mp-now-title", text: "未在播放" });
    this.nowArtistEl = now.createDiv({ cls: "mp-now-artist" });

    const buttons = row.createDiv({ cls: "mp-buttons" });

    const mk = (
      icon: string,
      title: string,
      onClick: () => void,
      cls = "mp-icon-btn mp-transport"
    ): HTMLElement => {
      const button = buttons.createEl("button", { cls, attr: { type: "button" } });
      setIcon(button, icon);
      button.setAttr("aria-label", title);
      button.setAttr("title", title);
      button.addEventListener("click", onClick);
      return button;
    };

    mk("skip-back", "上一首", () => this.player.step(-1));
    this.backBtnEl = mk("rewind", `后退 ${step()} 秒`, () => {
      this.player.seekBy(-step());
    });
    this.playBtnEl = mk(
      "play",
      "播放 / 暂停",
      () => this.player.toggle(),
      "mp-icon-btn mp-transport mp-play"
    );
    this.fwdBtnEl = mk("fast-forward", `前进 ${step()} 秒`, () => {
      this.player.seekBy(step());
    });
    mk("skip-forward", "下一首", () => this.player.step(1));
    labelStep();

    // --- extras: the mode switches and the audio ones ---
    const extras = row.createDiv({ cls: "mp-extras" });

    this.loopBtnEl = extras.createEl("button", {
      cls: "mp-icon-btn",
      attr: { type: "button" },
    });
    this.loopBtnEl.addEventListener("click", () => {
      this.player.cycleLoopMode();
      this.syncPlayerBar();
    });

    this.rateBtnEl = extras.createEl("button", {
      cls: "mp-icon-btn mp-rate",
      attr: { type: "button" },
    });
    this.rateBtnEl.setText(formatRate(1));
    this.rateBtnEl.addEventListener("click", (e) => this.showRateMenu(e));

    const volume = extras.createDiv({ cls: "mp-volume" });
    this.muteBtnEl = volume.createEl("button", {
      cls: "mp-icon-btn",
      attr: { type: "button", "aria-label": "静音" },
    });
    this.muteBtnEl.addEventListener("click", () => this.player.toggleMute());
    const vol = volume.createEl("input", {
      cls: "mp-range mp-volume-range",
      attr: { type: "range", min: "0", max: "100", step: "1", value: "80" },
    });
    this.volEl = vol;
    vol.addEventListener("input", () => {
      paintFill(vol, Number(vol.value) / 100);
      this.player.setVolume(Number(vol.value) / 100);
    });

    this.errEl = bar.createDiv({ cls: "mp-player-error" });
  },

  /** A menu rather than a cycle: six presets is a value you want to pick, not guess at. */
  showRateMenu(evt: MouseEvent): void {
    const menu = new Menu();
    const current = this.player.snapshot().rate;
    menu.addItem((item) => item.setTitle("播放速度").setDisabled(true));
    menu.addSeparator();
    for (const rate of RATE_STEPS) {
      menu.addItem((item) =>
        item
          .setTitle(rate === 1 ? "1×（原速）" : formatRate(rate))
          .setChecked(rate === current)
          .onClick(() => {
            this.player.setRate(rate);
            this.syncPlayerBar();
          })
      );
    }
    const rect = this.rateBtnEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.top - 6 });
  },

  syncPlayerBar(): void {
    if (!this.playerEl) return;
    const snapshot = this.player.snapshot();
    this.lastSnapshot = snapshot;
    const track = snapshot.track;

    this.nowTitleEl.setText(track ? track.title || track.name : "未在播放");
    this.nowArtistEl.setText(track ? track.artist || "未知歌手" : "");
    this.playerEl.toggleClass("is-empty", !track);
    this.playerEl.toggleClass("is-playing", snapshot.playing);

    this.playBtnEl.empty();
    setIcon(this.playBtnEl, snapshot.playing ? "pause" : "play");
    this.playBtnEl.setAttr("title", snapshot.playing ? "暂停" : "播放");

    const duration = snapshot.duration;
    // While the user is holding the thumb, the engine does not get to move it.
    if (!this.seeking) {
      const ratio = duration > 0 ? snapshot.position / duration : 0;
      this.seekEl.value = String(Math.round(Math.min(1, Math.max(0, ratio)) * 1000));
      paintFill(this.seekEl, ratio);
      this.curTimeEl.setText(formatTime(snapshot.position));
    }
    this.totalTimeEl.setText(formatTime(duration));
    this.seekEl.disabled = !track || duration <= 0;

    this.loopBtnEl.empty();
    setIcon(this.loopBtnEl, LOOP_ICON[snapshot.loopMode]);
    this.loopBtnEl.setAttr("title", `循环模式：${LOOP_LABEL[snapshot.loopMode]}`);
    this.loopBtnEl.toggleClass("is-alt", snapshot.loopMode !== LOOP_ORDER[0]);

    this.rateBtnEl.setText(formatRate(snapshot.rate));
    this.rateBtnEl.setAttr("title", `播放速度：${formatRate(snapshot.rate)}`);
    this.rateBtnEl.toggleClass("is-alt", snapshot.rate !== 1);

    this.volEl.value = String(Math.round(snapshot.volume * 100));
    paintFill(this.volEl, snapshot.volume);
    this.muteBtnEl.empty();
    setIcon(
      this.muteBtnEl,
      snapshot.muted || snapshot.volume === 0
        ? "volume-x"
        : snapshot.volume < 0.5
          ? "volume-1"
          : "volume-2"
    );
    this.muteBtnEl.toggleClass("is-alt", snapshot.muted);

    this.playerEl.toggleClass("has-error", !!snapshot.error);
    this.errEl.setText(snapshot.error ?? "");
  },
};
