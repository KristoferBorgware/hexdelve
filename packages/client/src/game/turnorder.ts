/*
 * Whose turn it is, as the yard's readout sees it.
 *
 * The turn system is a SCRIPT — `packages/client/scripts/Turns.ts` — because
 * who acts next is the game's central rule and a rule belongs where it can be
 * edited and reloaded. Scripts are compiled apart from this module graph, so
 * nothing here can import that class. This is the shape it satisfies, declared
 * on the side that reads it.
 *
 * Reading is all this side does. Nothing here hands out a turn or spends
 * energy: the schedule is asked what has happened so a status line can say it,
 * and that is the whole of the interface.
 *
 * Null is an ordinary answer, as it is for the other two seams — a yard built
 * with no systems in it is one where nothing takes turns, which is exactly what
 * a bench previewing a body wants.
 */

import type { Scene } from '@hexdelve/engine';

import { Schedule, type TurnTaker } from './turns.js';

/** The name the system prefab writes, and the class the script exports. */
export const TURNS = 'Turns';

export interface TurnOrder {
	/** The energy and the game turn. Read, never spent, from this side. */
	readonly schedule: Schedule<TurnTaker>;
	/** How many actions have been taken since the world started. */
	readonly actions: number;
	/** The last one, in the words the readout shows. */
	readonly last: string;
}

/**
 * What a yard with no turn system has: nobody in the order, and no clock.
 *
 * Shared and empty rather than built per call, because it is read every frame
 * by a readout and is the same answer every time. Nothing writes to it — a
 * caller that could hand out a turn would be handing one out to nobody.
 */
export const EMPTY_SCHEDULE: Schedule<TurnTaker> = new Schedule<TurnTaker>([]);

/** The turn system in a scene, or null where nothing put one there. */
export function turnOrder(scene: Scene): TurnOrder | null {
	for (const object of scene.root.walk()) {
		const found = object.getComponentNamed(TURNS);
		if (found) return found as unknown as TurnOrder;
	}
	return null;
}
