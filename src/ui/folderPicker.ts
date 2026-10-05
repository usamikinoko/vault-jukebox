/*
 * Vault folder picker.
 *
 * Obsidian's own folder suggestion is not public API, so this is a plain
 * filtered list — for choosing one music folder it is enough, and it keeps the
 * plugin free of an unofficial import.
 */

import type { App } from "obsidian";
import { Modal, TFolder } from "obsidian";

export class FolderPickerModal extends Modal {
  private listEl!: HTMLElement;
  private query = "";

  constructor(
    app: App,
    private onPick: (path: string) => void
  ) {
    super(app);
  }

  private folders(): string[] {
    const all = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder)
      .map((f) => (f.isRoot() ? "" : f.path))
      .filter((p) => p !== "");
    all.sort((a, b) => a.localeCompare(b, "zh"));
    return all;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mp-modal");
    contentEl.createEl("h3", { text: "选择音乐目录" });

    const input = contentEl.createEl("input", {
      cls: "mp-prompt-input",
      attr: { type: "text", placeholder: "输入以筛选目录…" },
    });
    this.listEl = contentEl.createDiv({ cls: "mp-folder-list" });

    const render = () => {
      this.listEl.empty();
      const q = this.query.toLowerCase();
      const matches = this.folders().filter((p) => !q || p.toLowerCase().includes(q));
      if (matches.length === 0) {
        this.listEl.createDiv({ cls: "mp-folder-empty", text: "没有匹配的目录" });
        return;
      }
      for (const path of matches) {
        const row = this.listEl.createDiv({ cls: "mp-folder-row", text: path });
        row.addEventListener("click", () => {
          this.close();
          this.onPick(path);
        });
      }
    };

    input.addEventListener("input", () => {
      this.query = input.value.trim();
      render();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = this.listEl.querySelector<HTMLElement>(".mp-folder-row");
        first?.click();
      }
    });

    render();
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
