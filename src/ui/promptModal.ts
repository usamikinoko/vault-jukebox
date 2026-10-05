/* Minimal single-input prompt, since Obsidian exposes no public one. */

import type { App } from "obsidian";
import { Modal } from "obsidian";

export interface PromptOptions {
  heading: string;
  initial: string;
  placeholder?: string;
  submitLabel?: string;
  /** Return an error message to keep the modal open, or null to accept. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
}

export class PromptModal extends Modal {
  constructor(
    app: App,
    private options: PromptOptions
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("mp-modal");
    contentEl.createEl("h3", { text: this.options.heading });

    const input = contentEl.createEl("input", {
      cls: "mp-prompt-input",
      attr: { type: "text", placeholder: this.options.placeholder ?? "" },
    });
    input.value = this.options.initial;

    const errorEl = contentEl.createDiv({ cls: "mp-prompt-error" });

    const submit = () => {
      const value = input.value.trim();
      if (!value) {
        errorEl.setText("名称不能为空");
        return;
      }
      const problem = this.options.validate?.(value) ?? null;
      if (problem) {
        errorEl.setText(problem);
        return;
      }
      this.close();
      this.options.onSubmit(value);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", () => errorEl.setText(""));

    const row = contentEl.createDiv({ cls: "mp-modal-actions" });
    const cancel = row.createEl("button", { cls: "mp-btn", text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = row.createEl("button", {
      text: this.options.submitLabel ?? "确定",
      cls: "mp-btn mod-cta",
    });
    confirm.addEventListener("click", submit);

    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
