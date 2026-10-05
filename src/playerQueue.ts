/*
 * Queue and playback sequencing.
 *
 * The queue is deliberately *not* replaced when the user browses to another
 * playlist. It is replaced at the moment playback starts from a list (`playFrom`),
 * which is what makes "clicking a playlist does not switch the music" true by
 * construction rather than by a guard somewhere in the view.
 */

import type { Track } from "./types";
import type { PlayerPart } from "./playerPart";

export interface PlayerQueuePart {
  /**
   * Replace the queue. `keepCurrent` re-points the queue index at the playing
   * track when it survives the swap, so browsing never loses the highlight.
   */
  setQueue(tracks: Track[], keepCurrent?: boolean): void;
  /**
   * Re-point the queue at fresh `Track` objects after a rename/move/delete.
   * Matched by path first and by `TFile` identity second: `renameFile` mutates
   * the same instance's path, so identity is the only thing that survives a
   * rename that happened while the track was playing.
   */
  syncTracks(all: readonly Track[]): void;
  /** Start playing `path`, taking its playlist as the new queue. */
  playFrom(tracks: Track[], path: string, position?: number): boolean;
  /**
   * Load without playing: what restoring the previous session needs, so the
   * app opens with the track paused at the position it was left at.
   */
  restore(tracks: Track[], path: string, position: number): boolean;
  playAt(index: number, position?: number): void;
  /** Next/previous by hand always wraps — the loop mode only governs "ended". */
  step(dir: 1 | -1): void;
  /** Detach the current file (used when the playing file is deleted). */
  stop(): void;

  /* Internals: other parts and the constructor's event wiring call these, so
     they must be on the merged type, but nothing outside the engine should. */
  load(track: Track, position: number, autoplay: boolean): void;
  seqStep(dir: 1 | -1): number;
  shuffleStep(dir: 1 | -1): number;
  rebuildShuffle(): void;
  handleEnded(): void;
  clearSource(): void;
}

export const queuePart: PlayerPart<PlayerQueuePart> = {
  setQueue(tracks: Track[], keepCurrent = true): void {
    const cur = this.current();
    this.queue = tracks.slice();
    this.rebuildShuffle();
    if (keepCurrent && cur) {
      this.index = this.queue.findIndex((t) => t.path === cur.path);
    } else if (!keepCurrent) {
      this.index = -1;
    }
    this.emit("queue");
  },

  syncTracks(all: readonly Track[]): void {
    const byPath = new Map(all.map((t) => [t.path, t]));
    const byFile = new Map(all.map((t) => [t.file, t]));

    const previous = this.current();
    const next: Track[] = [];
    for (const t of this.queue) {
      const fresh = byPath.get(t.path) ?? byFile.get(t.file);
      if (fresh && !next.some((x) => x.path === fresh.path)) next.push(fresh);
    }
    this.queue = next;
    this.rebuildShuffle();

    if (previous) {
      const fresh = byPath.get(previous.path) ?? byFile.get(previous.file);
      if (fresh) {
        this.index = next.findIndex((t) => t.path === fresh.path);
      } else {
        this.index = -1;
        this.clearSource();
      }
    }
    this.emit("queue");
    this.emit("track");
  },

  playFrom(tracks: Track[], path: string, position = 0): boolean {
    this.setQueue(tracks, true);
    const i = this.queue.findIndex((t) => t.path === path);
    if (i < 0) return false;
    this.playAt(i, position);
    return true;
  },

  restore(tracks: Track[], path: string, position: number): boolean {
    this.setQueue(tracks, false);
    const i = this.queue.findIndex((t) => t.path === path);
    if (i < 0) return false;
    this.index = i;
    this.load(this.queue[i], position, false);
    this.emit("state");
    return true;
  },

  playAt(index: number, position = 0): void {
    if (index < 0 || index >= this.queue.length) return;
    this.index = index;
    this.load(this.queue[index], position, true);
  },

  step(dir: 1 | -1): void {
    const i =
      this.loopMode === "shuffle" ? this.shuffleStep(dir) : this.seqStep(dir);
    if (i < 0) return;
    this.playAt(i);
  },

  stop(): void {
    this.clearSource();
    this.index = -1;
    this.emit("track");
    this.emit("state");
    this.persist?.();
  },

  // ------------------------------------------------- internals (part-private)

  load(track: Track, position: number, autoplay: boolean): void {
    if (!track.playable) {
      this.error = `不支持播放 .${track.ext} 音频`;
      this.emit("state");
      return;
    }
    const url = this.urlFor?.(track);
    if (!url) {
      this.error = "无法解析文件路径";
      this.emit("state");
      return;
    }
    this.error = null;
    this.pendingSeek = position;
    this.audio.src = url;
    try {
      this.audio.load();
    } catch {
      /* jsdom and unusual builds have no loader; the src is set either way. */
    }
    if (autoplay) this.attemptPlay();
    this.emit("track");
    this.emit("state");
    this.persist?.();
  },

  seqStep(dir: 1 | -1): number {
    const n = this.queue.length;
    if (n === 0) return -1;
    const base = this.index < 0 ? (dir > 0 ? -1 : 1) : this.index;
    return (base + dir + n) % n;
  },

  shuffleStep(dir: 1 | -1): number {
    const n = this.queue.length;
    if (n === 0) return -1;
    if (this.shuffleOrder.length !== n) this.rebuildShuffle();
    const cur = this.shuffleOrder.indexOf(this.index);
    const pos = cur < 0 ? (dir > 0 ? 0 : n - 1) : cur + dir;
    if (pos >= 0 && pos < n) return this.shuffleOrder[pos];
    // The whole list has been played: reshuffle, and do not open the new round
    // with the track that just finished.
    this.rebuildShuffle();
    const first = this.shuffleOrder[0];
    return first === this.index && n > 1 ? this.shuffleOrder[1] : first;
  },

  rebuildShuffle(): void {
    const n = this.queue.length;
    this.shuffleOrder = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shuffleOrder[i], this.shuffleOrder[j]] = [
        this.shuffleOrder[j],
        this.shuffleOrder[i],
      ];
    }
  },

  handleEnded(): void {
    this.persist?.();
    if (this.loopMode === "one") {
      this.pendingSeek = 0;
      try {
        this.audio.currentTime = 0;
      } catch {
        /* ignore */
      }
      this.attemptPlay();
      return;
    }
    this.step(1);
    this.emit("state");
  },

  clearSource(): void {
    this.pause();
    this.audio.removeAttribute("src");
    try {
      this.audio.load();
    } catch {
      /* ignore */
    }
    this.error = null;
  },
};
