/*
 * Which filenames this plugin treats as audio, and which of them it can
 * actually play.
 *
 * No `obsidian` import anywhere in this file: it is bundled standalone by
 * test/logic.cjs, and pulling in the Obsidian package (whose npm entry point is
 * empty) would break that.
 *
 * The two lists are separate on purpose. Chromium decodes the first list; the
 * second is recognised so a `.wma` sitting in the folder shows up as a greyed
 * row saying "不支持播放" instead of vanishing — a file the user put there and
 * cannot see is worse than one they can see and cannot play.
 */

export const DECODABLE_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "flac",
  "wav",
  "wave",
  "ogg",
  "oga",
  "opus",
  "weba",
  "webm",
];

export const UNDECODABLE_EXTENSIONS = [
  "wma",
  "aiff",
  "aif",
  "aifc",
  "ape",
  "dsf",
  "dff",
  "mid",
  "midi",
  "amr",
  "ac3",
  "mka",
  "tak",
  "wv",
  "mpc",
  "caf",
  "ra",
];

export const DEFAULT_AUDIO_EXTENSIONS = [
  ...DECODABLE_EXTENSIONS,
  ...UNDECODABLE_EXTENSIONS,
];

/** Lowercase, no leading dot. */
export function normalizeExt(raw: string): string {
  return raw.trim().replace(/^\./, "").toLowerCase();
}

/** "mp3, .FLAC wav" -> ["mp3","flac","wav"]; falls back to `fallback` if empty. */
export function parseExtensionList(raw: string, fallback: string[]): string[] {
  const list = raw
    .split(/[,\s;]+/)
    .map(normalizeExt)
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export function isPlayableExt(ext: string): boolean {
  return DECODABLE_EXTENSIONS.includes(normalizeExt(ext));
}

/** True when the name ends in an extension the user's list accepts. */
export function isAudioName(name: string, extensions: readonly string[]): boolean {
  const i = name.lastIndexOf(".");
  if (i <= 0) return false;
  return extensions.includes(name.slice(i + 1).toLowerCase());
}
