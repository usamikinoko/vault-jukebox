import type { TFile } from "obsidian";
import { DEFAULT_AUDIO_EXTENSIONS } from "./audioFormats";

/** How the queue advances when a track finishes (and what the loop button shows). */
export type LoopMode = "all" | "one" | "shuffle";

export type SortKey = "name" | "title" | "artist" | "size" | "mtime";

/**
 * How much motion the interface is allowed to use. One setting drives the
 * plugin's single CSS duration token, so the whole plugin can be calmed down
 * from one place.
 */
export type MotionLevel = "full" | "reduced" | "none";

const MOTION_LEVELS: MotionLevel[] = ["full", "reduced", "none"];
const LOOP_MODES: LoopMode[] = ["all", "one", "shuffle"];
const SORT_KEYS: SortKey[] = ["name", "title", "artist", "size", "mtime"];

/** The playlist folder created automatically when the music folder has none. */
export const DEFAULT_PLAYLIST = "default";

/**
 * The speeds the ⏩ rate button cycles through. Kept short on purpose: a
 * dropdown of twelve values is a decision nobody wants to make while listening,
 * and 1× is nearly always the answer after a podcast intro.
 */
export const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** `1` → "1×", `1.25` → "1.25×", `0.75` → "0.75×". */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}

/** The RATE_STEPS entry closest to an arbitrary number. */
export function nearestRate(rate: number): number {
  return RATE_STEPS.reduce((best, step) =>
    Math.abs(step - rate) < Math.abs(best - rate) ? step : best,
  );
}

export interface VaultJukeboxSettings {
  /** Vault-relative path of the single folder this plugin plays from. "" = unset. */
  musicRoot: string;
  /** Lowercase extensions without the leading dot; the accepted-file filter. */
  audioExtensions: string[];
  /** Seconds moved by the ⏪ / ⏩ buttons and by ← / →. */
  seekStep: number;
  volume: number;
  /** Playback speed multiplier; one of RATE_STEPS. */
  rate: number;
  loopMode: LoopMode;
  /** Playlist shown the last time the view was open. */
  lastPlaylist: string;
  /** Vault path of the track that was playing, for restore-on-startup. */
  lastTrackPath: string;
  /** Seconds into `lastTrackPath` at the last checkpoint. */
  lastPosition: number;
  showStatusBar: boolean;
  motion: MotionLevel;
  sortKey: SortKey;
  sortAsc: boolean;
  confirmDelete: boolean;
}

export const DEFAULT_SETTINGS: VaultJukeboxSettings = {
  musicRoot: "",
  audioExtensions: [...DEFAULT_AUDIO_EXTENSIONS],
  seekStep: 3,
  volume: 0.8,
  rate: 1,
  loopMode: "all",
  lastPlaylist: "",
  lastTrackPath: "",
  lastPosition: 0,
  showStatusBar: true,
  motion: "full",
  sortKey: "name",
  sortAsc: true,
  confirmDelete: true,
};

/**
 * Repair a settings object that came off disk.
 *
 * `Object.assign` already covers the ordinary upgrade case — a `data.json`
 * written before `rate` existed gets the default. This covers the other one: a
 * user hand-editing the file. Every field below has a failure mode that is
 * invisible until the plugin misbehaves, and none of them are worth a crash:
 *
 *   rate            NaN → `playbackRate` throws; a value outside RATE_STEPS →
 *                   the rate menu cannot show a checkmark on any row.
 *   volume          outside [0, 1] → `audio.volume` throws IndexSizeError.
 *   motion          anything else → the `data-mp-motion` attribute matches no
 *                   CSS rule, so `--mp-dur` is never set and *every* transition
 *                   in the plugin becomes invalid. The loudest of the lot.
 *   loopMode        unknown → the queue's advance logic falls through.
 *   sortKey         unknown → the comparator cannot order the list.
 *   seekStep        NaN or ≤ 0 → seeking jumps by NaN.
 *   audioExtensions not an array of non-empty strings → the library scan throws.
 */
export function normalizeSettings(raw: Partial<VaultJukeboxSettings> | null | undefined): VaultJukeboxSettings {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});

  if (!Number.isFinite(s.rate) || s.rate <= 0) s.rate = DEFAULT_SETTINGS.rate;
  if (!RATE_STEPS.includes(s.rate as (typeof RATE_STEPS)[number])) s.rate = nearestRate(s.rate);

  if (!Number.isFinite(s.volume)) s.volume = DEFAULT_SETTINGS.volume;
  s.volume = Math.min(1, Math.max(0, s.volume));

  if (!Number.isFinite(s.seekStep) || s.seekStep <= 0) s.seekStep = DEFAULT_SETTINGS.seekStep;
  if (!Number.isFinite(s.lastPosition) || s.lastPosition < 0) s.lastPosition = 0;

  if (!MOTION_LEVELS.includes(s.motion)) s.motion = DEFAULT_SETTINGS.motion;
  if (!LOOP_MODES.includes(s.loopMode)) s.loopMode = DEFAULT_SETTINGS.loopMode;
  if (!SORT_KEYS.includes(s.sortKey)) s.sortKey = DEFAULT_SETTINGS.sortKey;

  for (const key of ["showStatusBar", "sortAsc", "confirmDelete"] as const) {
    if (typeof s[key] !== "boolean") s[key] = DEFAULT_SETTINGS[key];
  }
  for (const key of ["musicRoot", "lastPlaylist", "lastTrackPath"] as const) {
    if (typeof s[key] !== "string") s[key] = DEFAULT_SETTINGS[key];
  }

  // Extensions are compared lowercased and dotless everywhere else, so
  // normalising here means no other call site has to.
  const exts = Array.isArray(s.audioExtensions)
    ? s.audioExtensions
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase().replace(/^\./, ""))
        .filter((e) => e.length > 0)
    : [];
  s.audioExtensions = exts.length > 0 ? [...new Set(exts)] : [...DEFAULT_AUDIO_EXTENSIONS];

  return s;
}

/** One audio file, resolved. `title`/`artist` come from `曲名_歌手` parsing. */
export interface Track {
  file: TFile;
  path: string;
  /** Basename without the extension. */
  name: string;
  title: string;
  artist: string;
  ext: string;
  size: number;
  mtime: number;
  /** False for a recognised-but-undecodable format (wma, ape, …). */
  playable: boolean;
}

/** A direct subfolder of the music root. Its name is its identity. */
export interface Playlist {
  name: string;
  path: string;
  tracks: Track[];
}

export interface Library {
  /** Vault-relative path of the music root. */
  root: string;
  /** Display name of the root folder. */
  name: string;
  playlists: Playlist[];
  /** Audio files sitting directly in the root; moved into `default` on scan. */
  rootSongs: TFile[];
  total: number;
}
