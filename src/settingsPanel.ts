/*
 * One renderer for the settings, used twice.
 *
 * Obsidian's plugin tab and the panel inside the view call this same function,
 * so the two cannot drift. Rows are Obsidian's own `Setting` component, which
 * means the controls inherit the theme's styling for free.
 */

import { Notice, Setting } from "obsidian";
import type VaultJukeboxPlugin from "./main";
import {
  SETTINGS_GROUPS,
  decodeSetting,
  defaultedSettings,
  encodeSetting,
  type ActionSpec,
  type SettingSpec,
} from "./settingSpec";

export interface PanelOptions {
  cls?: string;
}

/** Typing in the path field should not rescan the vault on every keystroke. */
const TEXT_DEBOUNCE_MS = 400;

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer = 0;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export function renderSettingsPanel(
  container: HTMLElement,
  plugin: VaultJukeboxPlugin,
  options: PanelOptions = {}
): void {
  container.empty();
  container.addClass("mp-settings");
  if (options.cls) container.addClass(options.cls);

  const commit = async (spec: SettingSpec, raw: string) => {
    const next = encodeSetting(spec, raw, plugin.settings);
    if ((plugin.settings[spec.key] as unknown) === next) return;
    (plugin.settings[spec.key] as unknown) = next;
    await plugin.saveSettings();
    plugin.refreshViews();
  };

  for (const group of SETTINGS_GROUPS) {
    const section = container.createDiv({ cls: "mp-settings-group" });
    section.createEl("h3", { cls: "mp-settings-title", text: group.title });
    if (group.hint) section.createDiv({ cls: "mp-settings-hint", text: group.hint });

    for (const spec of group.settings) {
      if (spec.visible && !spec.visible(plugin.settings)) continue;
      renderRow(section, plugin, spec, commit);
    }
    for (const action of group.actions ?? []) {
      renderAction(section, plugin, action);
    }
  }

  container.createDiv({
    cls: "mp-settings-stamp",
    text: `Vault Jukebox v${plugin.manifest.version}`,
  });
}

function renderRow(
  host: HTMLElement,
  plugin: VaultJukeboxPlugin,
  spec: SettingSpec,
  commit: (spec: SettingSpec, raw: string) => void
): void {
  const setting = new Setting(host).setName(spec.name).setDesc(spec.desc);
  const value = plugin.settings[spec.key];
  const current = decodeSetting(spec, value);

  if (spec.control.kind === "toggle") {
    setting.addToggle((toggle) =>
      toggle.setValue(value === true).onChange((v) => void commit(spec, String(v)))
    );
    return;
  }

  if (spec.control.kind === "slider") {
    const { min = 0, max = 100, step = 1 } = spec.control;
    setting.addSlider((slider) =>
      slider
        .setLimits(min, max, step)
        .setValue(Number(value))
        .setDynamicTooltip()
        .onChange((v) => void commit(spec, String(v)))
    );
    return;
  }

  if (spec.control.kind === "dropdown") {
    setting.addDropdown((drop) => {
      for (const option of spec.control.options ?? []) {
        drop.addOption(option.value, option.label);
      }
      drop.setValue(current).onChange((v) => void commit(spec, v));
    });
    return;
  }

  setting.addText((text) => {
    if (spec.control.placeholder) text.setPlaceholder(spec.control.placeholder);
    text.setValue(current);
    const fire = debounce(() => void commit(spec, text.inputEl.value), TEXT_DEBOUNCE_MS);
    text.inputEl.addEventListener("input", () => fire());
    text.inputEl.addEventListener("blur", () => void commit(spec, text.inputEl.value));
  });
}

function renderAction(host: HTMLElement, plugin: VaultJukeboxPlugin, action: ActionSpec): void {
  const describe = (): string => {
    if (action.key !== "pickRoot") return action.desc;
    return plugin.settings.musicRoot
      ? `当前：${plugin.settings.musicRoot}`
      : "还没有选择音乐目录。";
  };

  const setting = new Setting(host).setName(action.name).setDesc(describe());
  setting.addButton((button) => {
    button.setButtonText(action.button);
    if (action.warning) button.setWarning();
    button.onClick(async () => {
      if (action.key === "reset") {
        plugin.settings = defaultedSettings(plugin.settings);
        await plugin.saveSettings();
        plugin.refreshViews();
        new Notice("已恢复默认设置");
        return;
      }
      if (action.key === "rescan") {
        plugin.refreshViews();
        new Notice("已重新扫描音乐库");
        return;
      }
      plugin.pickMusicRoot();
    });
  });
}
