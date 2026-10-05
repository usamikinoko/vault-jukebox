/*
 * "Add songs": ask the OS for audio files.
 *
 * The native dialog is the path the feature is specified around — it opens the
 * system file manager. It is not part of Obsidian's public API though, so there
 * is a second, dialog-free path via a file input; Electron renderers hand back
 * the absolute path for a picked file (`File.path`, or `webUtils` on Electron
 * 32+), which is all the importer needs.
 */

import { nodeRequire } from "../nodeRequire";
import { absPathOfFile } from "../utils/shell";

interface OpenDialogOptions {
  title?: string;
  properties?: string[];
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface DialogModule {
  showOpenDialog?: (options: OpenDialogOptions) => Promise<OpenDialogResult>;
}

function electronDialog(): DialogModule | null {
  for (const moduleName of ["@electron/remote", "electron"]) {
    try {
      const mod = nodeRequire<{
        dialog?: DialogModule;
        remote?: { dialog?: DialogModule };
      }>(moduleName);
      const dialog = mod?.dialog ?? mod?.remote?.dialog;
      if (dialog?.showOpenDialog) return dialog;
    } catch {
      // Module missing or sandboxed — try the next one.
    }
  }
  return null;
}

async function pickViaDialog(extensions: readonly string[]): Promise<string[] | null> {
  const dialog = electronDialog();
  if (!dialog?.showOpenDialog) return null;
  try {
    const result = await dialog.showOpenDialog({
      title: "选择要加入歌单的音频文件",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "音频文件", extensions: [...extensions] },
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    if (!result || result.canceled) return [];
    return result.filePaths ?? [];
  } catch {
    return null;
  }
}

/** Absolute paths of the chosen audio files; empty when the user cancelled. */
export function pickAudioFiles(extensions: readonly string[]): Promise<string[]> {
  return pickViaDialog(extensions).then((paths) => {
    if (paths !== null) return paths;
    return pickViaInput(extensions);
  });
}

function pickViaInput(extensions: readonly string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = extensions.map((e) => `.${e}`).join(",");

    let settled = false;
    const finish = (paths: string[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      resolve(paths);
    };
    // A cancelled dialog fires no `change`; the window regaining focus is the
    // only signal that the round trip ended, so give it a beat to be sure.
    const onFocus = () => {
      window.setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 500);
    };

    input.addEventListener("change", () => {
      const paths = Array.from(input.files ?? [])
        .map((f) => absPathOfFile(f))
        .filter((p): p is string => !!p);
      finish(paths);
    });
    window.addEventListener("focus", onFocus);
    input.click();
  });
}
