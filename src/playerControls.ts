/*
 * User-facing controls: play state, seeking, volume, loop mode, playback rate.
 *
 * Nothing here owns playback state; everything reads the audio element and
 * announces through `emit`. The one subtlety is the rate: `load()` — which every
 * track change triggers — resets `playbackRate` back to `defaultPlaybackRate`,
 * so a speed set on track A would silently revert on track B if only
 * `playbackRate` were written.
 */

import type { LoopMode } from "./types";
import { RATE_STEPS } from "./types";
import type { PlayerPart } from "./playerPart";

/** Leave this much room at the end so a restored position is not instantly "ended". */
const END_GUARD = 0.35;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export interface PlayerControlsPart {
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  seekBy(delta: number): void;
  setVolume(value: number): void;
  setMuted(muted: boolean): void;
  toggleMute(): void;
  setLoopMode(mode: LoopMode): void;
  cycleLoopMode(): void;
  setRate(rate: number): void;
  /** Advance to the next preset, wrapping back to 1× from the top. */
  cycleRate(): void;
  /** Push the current position to the settings right now (plugin unload). */
  flush(): void;

  /* Internals: the queue part and the constructor's event wiring call these,
     so they must be on the merged type, but nothing outside the engine should. */
  applyRate(): void;
  applyPendingSeek(): void;
  attemptPlay(): void;
}

export const controlsPart: PlayerPart<PlayerControlsPart> = {
  play(): void {
    if (!this.current()) {
      if (this.queue.length > 0) this.playAt(0);
      return;
    }
    this.attemptPlay();
  },

  pause(): void {
    try {
      this.audio.pause();
    } catch {
      /* nothing to pause */
    }
  },

  toggle(): void {
    if (this.audio.paused) this.play();
    else this.pause();
  },

  seek(seconds: number): void {
    const d = this.duration;
    const target = clamp(seconds, 0, d > 0 ? Math.max(0, d - END_GUARD) : seconds);
    if (d > 0) {
      try {
        this.audio.currentTime = target;
      } catch {
        this.pendingSeek = target;
      }
      this.emit("time");
    } else {
      this.pendingSeek = target;
    }
    this.persist?.();
  },

  seekBy(delta: number): void {
    this.seek(this.position + delta);
  },

  setVolume(value: number): void {
    const v = clamp(value, 0, 1);
    this.audio.volume = v;
    this.audio.muted = v === 0;
    // Emitted here as well as from `volumechange`: a headless build (and some
    // programmatic paths) never fires that event, and a volume slider that only
    // moved when the browser felt like it would be indistinguishable from a bug.
    this.emit("volume");
    this.persist?.();
  },

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
    this.emit("volume");
    this.persist?.();
  },

  toggleMute(): void {
    this.setMuted(!this.audio.muted);
  },

  setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
    if (mode === "shuffle") this.rebuildShuffle();
    this.emit("loop");
    this.persist?.();
  },

  cycleLoopMode(): void {
    const order: LoopMode[] = ["all", "one", "shuffle"];
    this.setLoopMode(order[(order.indexOf(this.loopMode) + 1) % order.length]);
  },

  setRate(rate: number): void {
    this.rate = rate;
    this.applyRate();
    this.emit("rate");
    this.persist?.();
  },

  cycleRate(): void {
    const i = RATE_STEPS.indexOf(this.rate as (typeof RATE_STEPS)[number]);
    this.setRate(RATE_STEPS[(i + 1) % RATE_STEPS.length]);
  },

  flush(): void {
    this.lastPersist = 0;
    this.persist?.();
  },

  // ------------------------------------------------- internals (part-private)

  /**
   * Push the multiplier onto the element. `defaultPlaybackRate` is the one that
   * matters across track changes; see the file comment.
   */
  applyRate(): void {
    this.audio.defaultPlaybackRate = this.rate;
    this.audio.playbackRate = this.rate;
  },

  applyPendingSeek(): void {
    if (this.pendingSeek <= 0) return;
    const d = this.duration;
    const target = clamp(
      this.pendingSeek,
      0,
      d > 0 ? Math.max(0, d - END_GUARD) : this.pendingSeek
    );
    this.pendingSeek = 0;
    try {
      this.audio.currentTime = target;
    } catch {
      /* metadata raced us; the next timeupdate will show 0 */
    }
  },

  attemptPlay(): void {
    try {
      const result = this.audio.play() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          this.error = "播放被系统或浏览器阻止";
          this.emit("state");
        });
      }
    } catch {
      // jsdom (and a headless build) have no media pipeline at all; that is not
      // a user-visible failure, so it stays silent.
    }
  },
};
