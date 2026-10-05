/*
 * Commands and the vault listener.
 *
 * Kept outside the plugin class so `main.ts` stays about wiring, and so the
 * debounce timers have one owner.
 */

import type VaultJukeboxPlugin from "./main";

/** A rename in the native explorer must not leave the list showing a dead path. */
const VAULT_DEBOUNCE_MS = 300;

export function registerCommands(plugin: VaultJukeboxPlugin): void {
  plugin.addCommand({
    id: "open",
    name: "打开音乐播放器",
    callback: () => void plugin.activateView(),
  });
  plugin.addCommand({
    id: "toggle",
    name: "播放 / 暂停",
    callback: () => plugin.player.toggle(),
  });
  plugin.addCommand({
    id: "next",
    name: "下一首",
    callback: () => plugin.player.step(1),
  });
  plugin.addCommand({
    id: "prev",
    name: "上一首",
    callback: () => plugin.player.step(-1),
  });
  plugin.addCommand({
    id: "volume-up",
    name: "增大音量",
    callback: () => plugin.player.setVolume(plugin.player.audio.volume + 0.05),
  });
  plugin.addCommand({
    id: "volume-down",
    name: "减小音量",
    callback: () => plugin.player.setVolume(plugin.player.audio.volume - 0.05),
  });
  plugin.addCommand({
    id: "rescan",
    name: "重新扫描音乐库",
    callback: () => plugin.refreshViews(),
  });
}

export function registerVaultHooks(plugin: VaultJukeboxPlugin): void {
  const refresh = () => {
    window.clearTimeout(plugin.vaultTimer);
    plugin.vaultTimer = window.setTimeout(() => {
      plugin.vaultTimer = 0;
      plugin.refreshViews();
    }, VAULT_DEBOUNCE_MS);
  };

  plugin.registerEvent(plugin.app.vault.on("create", refresh));
  plugin.registerEvent(plugin.app.vault.on("delete", refresh));
  plugin.registerEvent(plugin.app.vault.on("rename", refresh));
}

export function clearVaultHooks(plugin: VaultJukeboxPlugin): void {
  window.clearTimeout(plugin.vaultTimer);
  plugin.vaultTimer = 0;
}
