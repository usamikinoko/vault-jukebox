/* Obsidian's plugin tab: the same renderer the view's settings page uses. */

import { PluginSettingTab } from "obsidian";
import type { App } from "obsidian";
import type VaultJukeboxPlugin from "./main";
import { renderSettingsPanel } from "./settingsPanel";

export class VaultJukeboxSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: VaultJukeboxPlugin
  ) {
    super(app, plugin);
  }

  display(): void {
    renderSettingsPanel(this.containerEl, this.plugin, { cls: "mp-settings-tab" });
  }
}
