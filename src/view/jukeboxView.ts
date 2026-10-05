/*
 * The music view.
 *
 * This file holds the *state* and nothing else: behaviour lives in the `*Part`
 * objects assembled onto the prototype at the bottom. The split is by
 * responsibility, not by state, because every part reads the same library,
 * list, selection and drag fields — passing them around would be a fiction.
 *
 * Fields are public on purpose: the parts are plain objects installed onto
 * `VaultJukeboxView.prototype`, and TypeScript will not let a `private` field be
 * reached through `ThisType<VaultJukeboxView>` from outside the class body.
 */

import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type VaultJukeboxPlugin from "../main";
import type { JukeboxPlayer, PlayerSnapshot } from "../player";
import type { Library, Playlist, Track } from "../types";
import { VIEW_TYPE_VAULT_JUKEBOX, type DragPayload } from "./viewTypes";
import { lifecyclePart, type LifecyclePart } from "./lifecycle";
import { treePart, type TreePart } from "./playlistTree";
import { listPart, type ListPart } from "./trackList";
import { rowPart, type RowPart } from "./trackRows";
import { playerBarPart, type PlayerBarPart } from "./playerBar";
import { selectionPart, type SelectionPart } from "./selection";
import { dragPart, type DragPart } from "./dragState";
import { opsPart, type OpsPart } from "./trackOps";
import { menuPart, type MenuPart } from "./menus";
import { keyboardPart, type KeyboardPart } from "./keyboard";

export { VIEW_TYPE_VAULT_JUKEBOX };

export class VaultJukeboxView extends ItemView {
  plugin: VaultJukeboxPlugin;
  player: JukeboxPlayer;

  /** Last successful scan; null when the root is unset or missing. */
  library: Library | null = null;
  playlists: Playlist[] = [];
  /** Name (not path) of the playlist whose tracks are on screen. */
  activePlaylist = "";
  /** The active playlist's tracks, after sorting and filtering. */
  tracks: Track[] = [];
  query = "";
  /** Vault paths of selected tracks. */
  selection = new Set<string>();
  /** Anchor for shift-click range selection. */
  anchor: string | null = null;
  drag: DragPayload | null = null;
  focusIndex = -1;

  /** Why the library could not be shown; null means "show the list". */
  problem: "unset" | "missing" | null = null;

  // --- DOM ---
  treeEl!: HTMLElement;
  mainEl!: HTMLElement;
  listEl!: HTMLElement;
  listWrapEl!: HTMLElement;
  headTitleEl!: HTMLElement;
  headCountEl!: HTMLElement;
  searchEl: HTMLInputElement | null = null;
  sortBtnEl!: HTMLElement;
  sortValueEl!: HTMLElement;
  sortDirEl!: HTMLElement;
  selectAllEl!: HTMLElement;
  selBarEl!: HTMLElement;
  playerEl!: HTMLElement;
  seekEl!: HTMLInputElement;
  curTimeEl!: HTMLElement;
  totalTimeEl!: HTMLElement;
  playBtnEl!: HTMLElement;
  backBtnEl!: HTMLElement;
  fwdBtnEl!: HTMLElement;
  loopBtnEl!: HTMLElement;
  rateBtnEl!: HTMLElement;
  volEl!: HTMLInputElement;
  muteBtnEl!: HTMLElement;
  nowTitleEl!: HTMLElement;
  nowArtistEl!: HTMLElement;
  errEl!: HTMLElement;

  /** path -> row element, so a track change repaints two rows instead of all. */
  rowEls = new Map<string, HTMLElement>();
  /** The track the rows were last painted for. */
  paintedPath: string | null = null;
  /** The row the keyboard cursor was last painted on. */
  paintedFocus: string | null = null;
  lastSnapshot: PlayerSnapshot | null = null;
  /** True while the user is dragging the seek slider; `timeupdate` stands down. */
  seeking = false;

  searchTimer = 0;
  unsubPlayer: (() => void) | null = null;
  /** Guards against a second scan while the first is still moving files. */
  scanning = false;
  /** Selection the toolbar was last built for, so a no-op repaint cannot churn it. */
  selSignature: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultJukeboxPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.player = plugin.player;
  }
}

/*
 * Declaration merging, so the parts' methods are visible on the class type.
 *
 * Without this, `Object.assign` is opaque to the compiler: `ThisType<VaultJukeboxView>`
 * would resolve to a view without any of the methods the parts call on each
 * other, and every cross-part call would be an error. The interface is what the
 * compiler sees; `Object.assign` below is what makes it true at runtime.
 */
export interface VaultJukeboxView
  extends LifecyclePart,
    TreePart,
    ListPart,
    RowPart,
    PlayerBarPart,
    SelectionPart,
    DragPart,
    OpsPart,
    MenuPart,
    KeyboardPart {}

Object.assign(
  VaultJukeboxView.prototype,
  lifecyclePart,
  treePart,
  listPart,
  rowPart,
  playerBarPart,
  selectionPart,
  dragPart,
  opsPart,
  menuPart,
  keyboardPart
);
