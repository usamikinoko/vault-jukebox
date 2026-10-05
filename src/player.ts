/*
 * The playback engine.
 *
 * One instance lives on the plugin, not on the view, so closing the tab or
 * switching to another note does not interrupt the music — the `<audio>` element
 * is never inside the view's DOM in the first place. The view is only a
 * subscriber that redraws itself from `snapshot()` whenever something happens.
 *
 * This file is the core: state, event wiring and read-only accessors. Behaviour
 * is split by responsibility into two parts installed onto the prototype at the
 * bottom (the same part model the views use):
 *
 *   playerQueue.ts     queue, sequencing, shuffle, "ended"
 *   playerControls.ts  play/pause, seek, volume, loop, rate
 */

import type { LoopMode, Track } from "./types";
import { queuePart, type PlayerQueuePart } from "./playerQueue";
import { controlsPart, type PlayerControlsPart } from "./playerControls";

export type PlayerEvent =
  | "track"
  | "state"
  | "time"
  | "queue"
  | "loop"
  | "volume"
  | "rate";

export interface PlayerSnapshot {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  rate: number;
  loopMode: LoopMode;
  queue: Track[];
  index: number;
  error: string | null;
}

/** While playing, a position checkpoint is written at most this often. */
const PERSIST_INTERVAL_MS = 4000;

export class JukeboxPlayer {
  readonly audio: HTMLAudioElement;
  queue: Track[] = [];
  index = -1;
  loopMode: LoopMode = "all";
  rate = 1;
  error: string | null = null;

  /*
   * Public instead of private on purpose: the parts are plain objects installed
   * onto `JukeboxPlayer.prototype`, and TypeScript will not let a `private` field
   * be reached through `ThisType<JukeboxPlayer>` from outside the class body.
   * They are engine internals — nothing outside this file should touch them.
   */
  /** Indices of the queue in shuffle play order. */
  shuffleOrder: number[] = [];
  /** Where to jump once `audio.duration` is known; 0 means "start at the top". */
  pendingSeek = 0;
  lastPersist = 0;
  urlFor: ((track: Track) => string | null) | null = null;
  persist: (() => void) | null = null;
  private listeners = new Set<(event: PlayerEvent) => void>();

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";

    this.audio.addEventListener("timeupdate", () => {
      this.emit("time");
      this.persistThrottled();
    });
    this.audio.addEventListener("durationchange", () => this.emit("time"));
    this.audio.addEventListener("play", () => {
      this.error = null;
      this.emit("state");
      this.persist?.();
    });
    this.audio.addEventListener("pause", () => {
      this.emit("state");
      this.persist?.();
    });
    this.audio.addEventListener("ended", () => this.handleEnded());
    this.audio.addEventListener("volumechange", () => this.emit("volume"));
    this.audio.addEventListener("error", () => {
      this.error = this.current() ? "无法播放该文件（格式或路径问题）" : null;
      this.emit("state");
    });
    this.audio.addEventListener("loadedmetadata", () => {
      // Some engines drop a non-default rate across `load()`; re-assert it here
      // rather than trusting `defaultPlaybackRate` alone.
      this.applyRate();
      this.applyPendingSeek();
      this.emit("track");
      this.emit("time");
    });
  }

  // ------------------------------------------------------------- wiring

  /** Resolve a vault path to something `<audio src>` can fetch. */
  setUrlResolver(fn: (track: Track) => string | null): void {
    this.urlFor = fn;
  }

  /** Called when the position/volume/queue changed enough to be worth saving. */
  setPersistHook(fn: () => void): void {
    this.persist = fn;
  }

  subscribe(fn: (event: PlayerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Engine-internal announcement. Parts call it; subscribers must not. */
  emit(event: PlayerEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch {
        // A broken subscriber must not take playback down with it.
      }
    }
  }

  private persistThrottled(): void {
    const now = Date.now();
    if (now - this.lastPersist < PERSIST_INTERVAL_MS) return;
    this.lastPersist = now;
    this.persist?.();
  }

  // ------------------------------------------------------------ reading

  current(): Track | null {
    return this.index >= 0 ? this.queue[this.index] ?? null : null;
  }

  get position(): number {
    const t = this.audio.currentTime;
    return Number.isFinite(t) ? t : 0;
  }

  get duration(): number {
    const d = this.audio.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended && !!this.current();
  }

  get volume(): number {
    return this.audio.muted ? 0 : this.audio.volume;
  }

  snapshot(): PlayerSnapshot {
    return {
      track: this.current(),
      playing: this.playing,
      position: this.position,
      duration: this.duration,
      volume: this.audio.volume,
      muted: this.audio.muted,
      rate: this.rate,
      loopMode: this.loopMode,
      queue: this.queue,
      index: this.index,
      error: this.error,
    };
  }
}

/*
 * Declaration merging, so the parts' methods are visible on the class type —
 * the interface is what the compiler sees; `Object.assign` is what makes it
 * true at runtime. See `view/jukeboxView.ts` for the same trick in the view layer.
 */
export interface JukeboxPlayer extends PlayerQueuePart, PlayerControlsPart {}

Object.assign(JukeboxPlayer.prototype, queuePart, controlsPart);
