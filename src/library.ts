/*
 * The vault side of the plugin: walking the music folder, and the file
 * operations that the view triggers (create a playlist, move tracks, import).
 *
 * The shape of the library is fixed by the folder layout:
 *
 *   <musicRoot>/                songs here are moved into `default` on scan
 *   <musicRoot>/<playlist>/     exactly one level of nesting, songs go here
 *
 * Anything deeper is not a playlist and is not walked — "allow one level" is
 * enforced by simply never looking further down.
 */

import type { App } from "obsidian";
import { Notice, TFile, TFolder } from "obsidian";
import { isAudioName, isPlayableExt } from "./audioFormats";
import { naturalCompare, parseTrackName, uniqueName } from "./parse";
import { DEFAULT_PLAYLIST, type Library, type Playlist, type SortKey, type Track } from "./types";
import { cleanPath, extOf, joinPath } from "./utils/paths";
import { readFileBytes } from "./utils/shell";

export function toTrack(file: TFile, extensions: readonly string[]): Track {
  const name = file.basename;
  const ext = extOf(file.name);
  const { title, artist } = parseTrackName(name);
  return {
    file,
    path: file.path,
    name,
    title,
    artist,
    ext,
    size: file.stat?.size ?? 0,
    mtime: file.stat?.mtime ?? 0,
    playable: isPlayableExt(ext),
  };
}

/** Create `path` (and its parents) if missing; returns the folder either way. */
export async function ensureFolder(app: App, path: string): Promise<TFolder | null> {
  const clean = cleanPath(path);
  if (!clean) return null;
  const existing = app.vault.getAbstractFileByPath(clean);
  if (existing instanceof TFolder) return existing;
  if (existing) return null;

  const segments = clean.split("/");
  let cursor = "";
  for (const segment of segments) {
    cursor = joinPath(cursor, segment);
    const node = app.vault.getAbstractFileByPath(cursor);
    if (node instanceof TFolder) continue;
    if (node) return null;
    try {
      await app.vault.createFolder(cursor);
    } catch {
      // A racing create (or a folder the adapter already had) is not a failure
      // as long as the folder is there afterwards.
    }
  }
  const created = app.vault.getAbstractFileByPath(clean);
  return created instanceof TFolder ? created : null;
}

function tracksIn(folder: TFolder, extensions: readonly string[]): Track[] {
  return folder.children
    .filter((c): c is TFile => c instanceof TFile && isAudioName(c.name, extensions))
    .map((f) => toTrack(f, extensions));
}

/**
 * Walk the music folder. Returns null when it is not a folder in this vault,
 * which the view renders as "this path does not exist" rather than as an empty
 * library — the two need different fixes and must not look alike.
 */
export function scanLibrary(
  app: App,
  root: string,
  extensions: readonly string[]
): Library | null {
  const clean = cleanPath(root);
  if (!clean) return null;
  const folder = app.vault.getAbstractFileByPath(clean);
  if (!(folder instanceof TFolder)) return null;

  const playlists: Playlist[] = [];
  const rootSongs: TFile[] = [];
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      const tracks = tracksIn(child, extensions);
      tracks.sort((a, b) => naturalCompare(a.name, b.name));
      playlists.push({ name: child.name, path: child.path, tracks });
    } else if (child instanceof TFile && isAudioName(child.name, extensions)) {
      rootSongs.push(child);
    }
  }
  playlists.sort((a, b) => {
    // The auto-created playlist is a default, not a favourite: it sorts last so
    // the folders the user made themselves stay at the top where they look.
    if (a.name === DEFAULT_PLAYLIST) return 1;
    if (b.name === DEFAULT_PLAYLIST) return -1;
    return naturalCompare(a.name, b.name);
  });

  const total = playlists.reduce((n, p) => n + p.tracks.length, 0) + rootSongs.length;
  return { root: clean, name: folder.name, playlists, rootSongs, total };
}

/** Every track in the library, flattened. Used to remap a stale player queue. */
export function allTracks(library: Library): Track[] {
  return library.playlists.flatMap((p) => p.tracks);
}

export function sortTracks(tracks: Track[], key: SortKey, asc: boolean): Track[] {
  const dir = asc ? 1 : -1;
  const sorted = [...tracks];
  sorted.sort((a, b) => {
    switch (key) {
      case "title":
        return dir * naturalCompare(a.title, b.title);
      case "artist":
        return dir * naturalCompare(a.artist, b.artist);
      case "size":
        return dir * (a.size - b.size);
      case "mtime":
        return dir * (a.mtime - b.mtime);
      default:
        return dir * naturalCompare(a.name, b.name);
    }
  });
  return sorted;
}

export async function createPlaylistFolder(
  app: App,
  root: string,
  name: string
): Promise<TFolder | null> {
  const target = joinPath(cleanPath(root), name);
  if (app.vault.getAbstractFileByPath(target)) return null;
  return ensureFolder(app, target);
}

/**
 * Move files into `dest` (a vault path), renaming on collision.
 *
 * Goes through `fileManager.renameFile` rather than the adapter so any link in
 * a note pointing at the audio follows the file. Returns how many moved.
 */
export async function moveTracks(
  app: App,
  files: TFile[],
  destFolder: string
): Promise<number> {
  const dest = app.vault.getAbstractFileByPath(cleanPath(destFolder));
  const taken = new Set<string>(dest instanceof TFolder ? dest.children.map((c) => c.name) : []);

  let moved = 0;
  for (const file of files) {
    if (file.parent?.path === cleanPath(destFolder)) continue;
    const ext = extOf(file.name);
    const base = file.name.slice(0, file.name.length - ext.length - 1) || file.name;
    const name = uniqueName(base, ext, (n) => taken.has(n));
    taken.add(name);
    const target = joinPath(cleanPath(destFolder), name);
    try {
      await app.fileManager.renameFile(file, target);
      moved++;
    } catch (err) {
      new Notice(`移动失败：${file.name} —— ${String(err)}`);
    }
  }
  return moved;
}

/**
 * Copy audio files from absolute OS paths into a playlist folder.
 *
 * Bytes go straight from disk to `createBinary` — never through an audio
 * element or any re-encode, so what lands in the vault is the original file.
 */
export async function importAudioFiles(
  app: App,
  absPaths: string[],
  destFolder: string
): Promise<{ imported: number; failed: number }> {
  const folder = app.vault.getAbstractFileByPath(cleanPath(destFolder));
  const taken = new Set<string>(
    folder instanceof TFolder ? folder.children.map((c) => c.name) : []
  );

  let imported = 0;
  let failed = 0;
  for (const abs of absPaths) {
    const base = abs.split(/[\\/]/).pop() ?? "";
    if (!base) {
      failed++;
      continue;
    }
    const ext = extOf(base);
    const stem = ext ? base.slice(0, base.length - ext.length - 1) : base;
    const name = uniqueName(stem, ext, (n) => taken.has(n));
    taken.add(name);

    const bytes = readFileBytes(abs);
    if (!bytes) {
      failed++;
      continue;
    }
    try {
      await app.vault.createBinary(joinPath(cleanPath(destFolder), name), bytes);
      imported++;
    } catch {
      failed++;
    }
  }
  return { imported, failed };
}

/** What a trash attempt did, and — when it failed — why, in printable words. */
export interface TrashOutcome {
  ok: boolean;
  /** Empty when `ok`. */
  reason: string;
}

/**
 * Move a vault file (or folder) to the system trash.
 *
 * `fileManager.trashFile` is the current API but is not present in every build
 * this plugin claims to support, so `vault.trash(file, true)` is the fallback.
 *
 * The failure comes back as a message rather than a thrown error, for the same
 * reason Vault Gallery's batch delete reports per file: one locked file must
 * not abort the rest of the batch, and the user still deserves to know which
 * file failed and why. It used to return a bare boolean, which meant the
 * caller could say "删除失败" and nothing more — the actual reason was eaten
 * two frames down. Nothing could recover it there, so it is carried out here.
 */
export async function trashFile(app: App, file: TFile | TFolder): Promise<TrashOutcome> {
  const manager = app.fileManager as unknown as {
    trashFile?: (f: TFile | TFolder) => Promise<void>;
  };
  if (typeof manager?.trashFile === "function") {
    try {
      await manager.trashFile(file);
      return { ok: true, reason: "" };
    } catch (err) {
      console.error(err);
      return { ok: false, reason: String(err) };
    }
  }
  const vault = app.vault as unknown as {
    trash?: (f: TFile | TFolder, system: boolean) => Promise<void>;
  };
  if (typeof vault.trash !== "function") {
    return { ok: false, reason: "当前环境不支持移入回收站" };
  }
  try {
    await vault.trash(file, true);
    return { ok: true, reason: "" };
  } catch (err) {
    console.error(err);
    return { ok: false, reason: String(err) };
  }
}
