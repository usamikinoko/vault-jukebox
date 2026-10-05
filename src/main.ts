import { Notice, Plugin, TFile } from "obsidian";
import { normalizeSettings, type VaultJukeboxSettings } from "./types";
import { JukeboxPlayer } from "./player";
import { scanLibrary } from "./library";
import { VaultJukeboxView, VIEW_TYPE_VAULT_JUKEBOX } from "./view/jukeboxView";
import { VaultJukeboxSettingTab } from "./settingsTab";
import { StatusBarControl } from "./statusBar";
import { FolderPickerModal } from "./ui/folderPicker";
import { clearVaultHooks, registerCommands, registerVaultHooks } from "./pluginCommands";
import { cleanPath } from "./utils/paths";

/** A checkpoint write is coalesced for this long, so a burst is one disk write. */
const SAVE_DEBOUNCE_MS = 600;

export default class VaultJukeboxPlugin extends Plugin {
  settings!: VaultJukeboxSettings;
  /** One engine for the whole app: playback outlives every view. */
  player!: JukeboxPlayer;
  statusBar: StatusBarControl | null = null;

  /** Written by ./pluginCommands, which owns the debounced vault handling. */
  vaultTimer = 0;
  private saveTimer = 0;
  private unsubPlayer: (() => void) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyMotion();

    this.player = new JukeboxPlayer();
    this.player.loopMode = this.settings.loopMode;
    // `setRate` before `setPersistHook` on purpose: the rate is being restored,
    // not changed, and there is nothing to write back yet.
    this.player.setRate(this.settings.rate);
    this.player.audio.volume = this.settings.volume;
    this.player.setUrlResolver((track) => this.resolveAudioUrl(track));
    this.player.setPersistHook(() => this.scheduleSave());

    this.registerView(VIEW_TYPE_VAULT_JUKEBOX, (leaf) => new VaultJukeboxView(leaf, this));
    // The left-rail entry point. The command palette has the same action, but
    // a music player you cannot see is one you forget is running.
    this.addRibbonIcon("music", "打开音乐播放器", () => void this.activateView());
    registerCommands(this);
    this.addSettingTab(new VaultJukeboxSettingTab(this.app, this));
    this.mountStatusBar();
    registerVaultHooks(this);
    this.registerDomEvent(window, "beforeunload", () => void this.flushSave());

    await this.restoreSession();
  }

  onunload(): void {
    document.body.removeAttribute("data-mp-motion");
    clearVaultHooks(this);
    window.clearTimeout(this.saveTimer);
    this.unsubPlayer?.();
    this.unsubPlayer = null;
    // The engine is not in the DOM, so nothing else would ever stop it.
    this.player?.pause();
    void this.flushSave();
    this.statusBar?.dispose();
    this.statusBar = null;
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_VAULT_JUKEBOX);
  }

  // ------------------------------------------------------------ plumbing

  private mountStatusBar(): void {
    this.statusBar = new StatusBarControl(this.addStatusBarItem(), () =>
      void this.activateView()
    );
    this.statusBar.setVisible(this.settings.showStatusBar);
    this.statusBar.update(this.player.snapshot());
    this.unsubPlayer = this.player.subscribe((event) => {
      if (event === "track" || event === "state") {
        this.statusBar?.update(this.player.snapshot());
      }
    });
  }

  resolveAudioUrl(track: { file: TFile }): string | null {
    try {
      return this.app.vault.getResourcePath(track.file);
    } catch {
      return null;
    }
  }

  /**
   * Publish the motion preference as one attribute on <body>.
   *
   * The setting drives the CSS duration tokens in styles.css; a document-level
   * attribute is the one scope that reaches the view and the modals (which
   * Obsidian appends to <body>, outside the view's DOM) without threading the
   * value through every constructor in between.
   */
  applyMotion(): void {
    document.body.setAttribute("data-mp-motion", this.settings.motion);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_VAULT_JUKEBOX)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_VAULT_JUKEBOX, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Re-scan every open view. The library is not cached, so this is the refresh. */
  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_JUKEBOX)) {
      if (leaf.view instanceof VaultJukeboxView) void leaf.view.reloadLibrary();
    }
  }

  pickMusicRoot(): void {
    new FolderPickerModal(this.app, (path) => {
      this.settings.musicRoot = cleanPath(path);
      void this.saveSettings().then(() => {
        void this.activateView();
        this.refreshViews();
      });
    }).open();
  }

  /**
   * Jump straight to this plugin's row in Obsidian's settings.
   *
   * `app.setting` is internal API, so it is guarded: on a build that renames it
   * the button simply does nothing instead of throwing.
   */
  openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;
    if (!setting?.open || !setting.openTabById) {
      this.notify("请在「设置 → 第三方插件 → Vault Jukebox」中调整");
      return;
    }
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  /**
   * Bring back the track that was playing when the app last closed, paused at
   * the position it had reached. Never autoplays — the user asked for "paused
   * at the corresponding progress", and starting a sound unprompted at launch
   * is the one thing a music plugin must not do.
   */
  private async restoreSession(): Promise<void> {
    const path = this.settings.lastTrackPath;
    const root = cleanPath(this.settings.musicRoot);
    if (!path || !root) return;
    if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFile)) return;

    const library = scanLibrary(this.app, root, this.settings.audioExtensions);
    if (!library) return;
    const playlist = library.playlists.find((p) =>
      p.tracks.some((t) => t.path === path)
    );
    if (!playlist) return;
    this.player.restore(playlist.tracks, path, this.settings.lastPosition);
  }

  // --------------------------------------------------------- persistence

  scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  async flushSave(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    const track = this.player?.current() ?? null;
    this.settings.volume = this.player?.audio.volume ?? this.settings.volume;
    this.settings.rate = this.player?.rate ?? this.settings.rate;
    this.settings.loopMode = this.player?.loopMode ?? this.settings.loopMode;
    this.settings.lastTrackPath = track?.path ?? "";
    this.settings.lastPosition = this.player?.position ?? 0;
    await this.saveData(this.settings);
  }

  async loadSettings(): Promise<void> {
    // `normalizeSettings` is the merge *and* the repair — see types.ts for the
    // failure mode behind each field. Everything downstream (the player's rate,
    // the volume assignment, the `data-mp-motion` attribute) assumes clean
    // values and none of them check.
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.applyMotion();
    this.statusBar?.setVisible(this.settings.showStatusBar);
  }

  notify(message: string): void {
    new Notice(message);
  }
}
