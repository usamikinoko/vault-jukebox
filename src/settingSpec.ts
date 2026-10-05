/*
 * The settings, described once.
 *
 * Two places render them — Obsidian's plugin tab and the panel inside the view
 * — and both call the same function in `settingsPanel.ts`, so the list lives
 * here and each renderer is a dumb loop over this array. Adding a setting means
 * adding one entry, not editing two UIs.
 */

import type { VaultJukeboxSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { parseExtensionList } from "./audioFormats";

export type ControlKind = "text" | "slider" | "toggle" | "dropdown";

export interface ControlSpec {
  kind: ControlKind;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
}

export interface SettingSpec {
  key: keyof VaultJukeboxSettings;
  name: string;
  desc: string;
  control: ControlSpec;
  /** Raw control value to stored value. Falls back to the kind's default. */
  encode?: (raw: string, current: VaultJukeboxSettings) => unknown;
  /** Stored value to control value. Falls back to the kind's default. */
  decode?: (value: unknown) => string;
  visible?: (s: VaultJukeboxSettings) => boolean;
}

/** An action row: a button that does something rather than storing a value. */
export interface ActionSpec {
  key: "reset" | "rescan" | "pickRoot";
  name: string;
  desc: string;
  button: string;
  warning?: boolean;
}

export interface SettingsGroup {
  title: string;
  hint?: string;
  settings: SettingSpec[];
  actions?: ActionSpec[];
}

export const LOOP_OPTIONS = [
  { value: "all", label: "歌单循环" },
  { value: "one", label: "单曲循环" },
  { value: "shuffle", label: "随机播放" },
];

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "音乐库",
    hint:
      "只扫描这个目录以及它的第一层子目录。每个子目录就是一张歌单；更深层的目录会被忽略。",
    settings: [
      {
        key: "musicRoot",
        name: "音乐目录",
        desc: "vault 内相对路径，例如 01_Resources/music。留空则插件不做任何扫描。",
        control: { kind: "text", placeholder: "例如 01_Resources/music" },
        encode: (raw) => raw.trim().replace(/^\/+|\/+$/g, ""),
      },
      {
        key: "audioExtensions",
        name: "音频扩展名",
        desc: "逗号或空格分隔，小写，不含点。无法解码的格式仍会列出，但标为不支持播放。",
        control: { kind: "text" },
        encode: (raw, current) =>
          parseExtensionList(raw, current.audioExtensions),
        decode: (v) => (Array.isArray(v) ? v.join(", ") : ""),
      },
    ],
    actions: [
      {
        key: "pickRoot",
        name: "从列表中选择音乐目录",
        desc: "列出 vault 里的全部目录，选一个作为音乐目录。",
        button: "浏览…",
      },
    ],
  },
  {
    title: "播放",
    settings: [
      {
        key: "seekStep",
        name: "快进 / 快退步长",
        desc: "⏪ ⏩ 按钮与键盘 ← → 每次移动的秒数。",
        control: { kind: "slider", min: 1, max: 30, step: 1 },
      },
      {
        key: "loopMode",
        name: "循环模式",
        desc: "播放栏上的循环按钮会切换这里。",
        control: { kind: "dropdown", options: LOOP_OPTIONS },
      },
      {
        key: "confirmDelete",
        name: "删除前确认",
        desc: "删除歌曲或歌单前先确认。删除走系统回收站。",
        control: { kind: "toggle" },
      },
    ],
  },
  {
    title: "界面",
    settings: [
      {
        key: "sortKey",
        name: "默认排序字段",
        desc: "歌曲列表的默认排序。",
        control: {
          kind: "dropdown",
          options: [
            { value: "name", label: "文件名" },
            { value: "title", label: "曲名" },
            { value: "artist", label: "歌手" },
            { value: "mtime", label: "修改时间" },
            { value: "size", label: "文件大小" },
          ],
        },
      },
      { key: "sortAsc", name: "升序", desc: "关闭则降序。", control: { kind: "toggle" } },
      {
        key: "showStatusBar",
        name: "在状态栏显示当前曲目",
        desc: "右下角显示曲名与播放/暂停，点击可回到播放器标签页。",
        control: { kind: "toggle" },
      },
      {
        key: "motion",
        name: "界面动效",
        desc: "控制悬停、行高亮、播放栏过渡的时长。",
        control: {
          kind: "dropdown",
          options: [
            { value: "full", label: "完整" },
            { value: "reduced", label: "精简" },
            { value: "none", label: "关闭" },
          ],
        },
      },
    ],
  },
  {
    title: "维护",
    settings: [],
    actions: [
      {
        key: "rescan",
        name: "重新扫描音乐库",
        desc: "文件被外部工具改动后可手动触发一次。",
        button: "重新扫描",
      },
      {
        key: "reset",
        name: "恢复默认设置",
        desc: "不影响你的音乐文件；上次播放位置也会保留。",
        button: "恢复默认",
        warning: true,
      },
    ],
  },
];

/** Flat list of every setting; test/logic.cjs asserts invariants over it. */
export function allSettings(): SettingSpec[] {
  return SETTINGS_GROUPS.flatMap((g) => g.settings);
}

export function encodeSetting(
  spec: SettingSpec,
  raw: string,
  current: VaultJukeboxSettings
): unknown {
  if (spec.encode) return spec.encode(raw, current);
  switch (spec.control.kind) {
    case "toggle":
      return raw === "true" || raw === "1";
    case "slider":
      return Number(raw);
    default:
      return raw;
  }
}

export function decodeSetting(spec: SettingSpec, value: unknown): string {
  if (spec.decode) return spec.decode(value);
  switch (spec.control.kind) {
    case "toggle":
      return value ? "true" : "false";
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

/** What "恢复默认设置" restores. Playback position is state, not a preference. */
export function defaultedSettings(current: VaultJukeboxSettings): VaultJukeboxSettings {
  return {
    ...DEFAULT_SETTINGS,
    lastPlaylist: current.lastPlaylist,
    lastTrackPath: current.lastTrackPath,
    lastPosition: current.lastPosition,
  };
}
