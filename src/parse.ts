/*
 * Filename conventions and small formatters. Pure — no `obsidian`, no DOM —
 * so test/logic.cjs can bundle and assert on it directly.
 */

/**
 * `曲名_歌手` -> { title, artist }.
 *
 * Split on the **last** underscore: `A_B_C.mp3` is "A_B" by "C", because a
 * title is far more likely to contain an underscore than an artist is. A name
 * with no underscore (or one at either end) has no artist at all rather than an
 * empty one, so the list can render "未知歌手" as a distinct state.
 */
export function parseTrackName(base: string): { title: string; artist: string } {
  const i = base.lastIndexOf("_");
  if (i <= 0 || i === base.length - 1) return { title: base, artist: "" };
  return { title: base.slice(0, i), artist: base.slice(i + 1) };
}

/** Seconds -> "m:ss", or "h:mm:ss" past an hour. `NaN`/negative render as "0:00". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "3.4 MB" / "812 KB" / "0.4 MB" for a byte count. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * First free name of the form `base.ext`, `base (2).ext`, …
 *
 * The caller supplies the collision test so the same helper serves "what is on
 * disk" and "what this batch has already reserved".
 */
export function uniqueName(
  base: string,
  ext: string,
  taken: (name: string) => boolean
): string {
  const join = (b: string) => (ext ? `${b}.${ext}` : b);
  const stem = base || "track";
  if (!taken(join(stem))) return join(stem);
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})`;
    if (!taken(join(candidate))) return join(candidate);
  }
  return join(`${stem} (${Date.now()})`);
}

/** Illegal on Windows and on some network shares; rejected before renaming. */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;

export function isValidFileName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !ILLEGAL_NAME_CHARS.test(name);
}

/**
 * Ascending comparison that keeps `track2` before `track10`.
 *
 * Plain `<` sorts them the other way round, which is the single most visible
 * way a music list can look wrong.
 */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const ax = a.toLowerCase().match(re) ?? [];
  const bx = b.toLowerCase().match(re) ?? [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const av = ax[i];
    const bv = bx[i];
    if (av === bv) continue;
    const an = /^\d/.test(av) ? Number(av) : null;
    const bn = /^\d/.test(bv) ? Number(bv) : null;
    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;
    return av < bv ? -1 : 1;
  }
  return ax.length - bx.length;
}
