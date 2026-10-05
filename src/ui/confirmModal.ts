/* A yes/no dialog, since Obsidian ships no public one. */

import type { App } from "obsidian";
import { Modal } from "obsidian";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private heading: string,
    private body: string,
    private confirmLabel: string,
    private onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mp-modal");
    contentEl.createEl("h3", { text: this.heading });
    contentEl.createDiv({ cls: "mp-modal-body", text: this.body });

    const row = contentEl.createDiv({ cls: "mp-modal-actions" });
    const cancel = row.createEl("button", { cls: "mp-btn", text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = row.createEl("button", {
      text: this.confirmLabel,
      cls: "mp-btn is-danger",
    });
    confirm.addEventListener("click", () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
