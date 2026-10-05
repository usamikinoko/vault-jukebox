/*
 * The player's part-model helper, mirroring `view/viewTypes.ts`.
 *
 * The engine is one stateful object by design — the queue, the transport and
 * the audio element read the same fields — so splitting it by responsibility
 * means splitting *methods*, not state. `ThisType` is what lets a plain object
 * literal call the other parts as if it were the class.
 */

import type { JukeboxPlayer } from "./player";

export type PlayerPart<T> = T & ThisType<JukeboxPlayer>;
