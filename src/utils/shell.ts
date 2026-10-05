/*
 * Reading files that live outside the vault (the "add songs" import) and
 * handing paths to the OS.
 *
 * Neither Electron nor the shell is part of Obsidian's public API, so every
 * step is guarded and every failure has a visible fallback: a plugin that
 * cannot reveal a file in Explorer still has to keep working.
 */

import type { App } from "obsidian";
import { Notice } from "obsidian";
import { nodeRequire } from "../nodeRequire";

interface ElectronShell {
  showItemInFolder?: (fullPath: string) => void;
  openPath?: (fullPath: string) => Promise<string>;
}

function electronShell(): ElectronShell | null {
  try {
    return nodeRequire<{ shell?: ElectronShell } | null>("electron")?.shell ?? null;
  } catch {
    return null;
  }
}

/** Absolute OS path for a vault-relative path, or null if unavailable. */
export function fullPathOf(app: App, vaultPath: string): string | null {
  try {
    const adapter = app.vault.adapter as unknown as {
      getFullPath?: (p: string) => string;
    };
    return typeof adapter.getFullPath === "function"
      ? adapter.getFullPath(vaultPath)
      : null;
  } catch {
    return null;
  }
}

/** Reveal an absolute path in the OS file manager. False when it could not. */
export function revealFullPath(fullPath: string): boolean {
  const shell = electronShell();
  if (shell?.showItemInFolder) {
    shell.showItemInFolder(fullPath);
    return true;
  }
  return false;
}

/** Reveal a vault file in the OS file manager. */
export function revealInOS(app: App, vaultPath: string): void {
  const full = fullPathOf(app, vaultPath);
  if (full && revealFullPath(full)) return;
  new Notice("无法在系统资源管理器中定位该文件");
}

/** Hand a vault file to the OS default application (for a format we cannot decode). */
export function openWithOS(app: App, vaultPath: string): void {
  const full = fullPathOf(app, vaultPath);
  const shell = electronShell();
  if (full && shell?.openPath) {
    void shell.openPath(full);
    return;
  }
  new Notice("无法用系统默认应用打开该文件");
}

/** Imported audio keeps its bytes; this only ever reads, never re-encodes. */
export function readFileBytes(absPath: string): ArrayBuffer | null {
  try {
    const fs = nodeRequire<{
      readFileSync(p: string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    }>("fs");
    const buf = fs.readFileSync(absPath);
    // Slice so the ArrayBuffer is exactly the file, not a view into a shared
    // pool — `createBinary` writes the whole buffer it is handed.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    return null;
  }
}

/** Absolute path of a dropped/picked `File`, or null when Electron withholds it. */
export function absPathOfFile(file: File): string | null {
  const direct = (file as unknown as { path?: string }).path;
  if (typeof direct === "string" && direct) return direct;
  // Electron 32 removed `File.path`; `webUtils.getPathForFile` is its successor.
  try {
    const webUtils = nodeRequire<{ webUtils?: { getPathForFile?: (f: File) => string } }>(
      "electron"
    )?.webUtils;
    return webUtils?.getPathForFile?.(file) ?? null;
  } catch {
    return null;
  }
}
