import type { VaultJukeboxView } from "./jukeboxView";

export const VIEW_TYPE_VAULT_JUKEBOX = "vault-jukebox-view";

/** What is being dragged inside the view. Tracks always travel as a group. */
export type DragPayload = { kind: "tracks"; paths: string[] };

/**
 * A group of methods installed onto `VaultJukeboxView.prototype`.
 *
 * The view is one stateful object by design — the tree, the list, the selection
 * and the player bar read the same fields — so splitting it by responsibility
 * means splitting *methods*, not state.
 */
export type ViewPart<T> = T & ThisType<VaultJukeboxView>;
