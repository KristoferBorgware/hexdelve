/*
 * What a hunting creature has decided to do, as the body driving it sees it.
 *
 * The hunt itself is a SCRIPT — `packages/client/scripts/Hunter.ts` — because
 * whether it has heard you, whether it has lost you, and which hexagon it moves
 * to are decisions, and decisions belong where they can be edited and reloaded
 * without rebuilding anything. Scripts are compiled apart from this module
 * graph, so nothing here can import that class. This is the shape it satisfies,
 * declared on the side that calls it.
 *
 * The seam is the same one the man has — see `orders.ts`. One side decides; the
 * other knows how long an action takes, what it looks like, and where the teeth
 * end up. Neither can do the other's half.
 *
 * `huntOrders` finds it by name, since the name is the only handle a
 * compiled-apart class has. Null is an ordinary answer: a bat previewed on a
 * bench has wings and nothing telling it to hunt, and every caller here reads
 * that as a creature asleep with nothing to do.
 */

import type { GameObject } from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

/** The name the entity file writes, and the class the script exports. */
export const HUNTER = 'Hunter';

/**
 * Asleep until it hears you, hunting until it loses you, returning until it is
 * home. The states it does not have are the ones that were only ever
 * animations: waking, striking and settling are phases of a clip, and a phase
 * of a clip is what an action already is.
 */
export type HuntState = 'asleep' | 'hunting' | 'returning';

/** What it should spend this turn on. */
export type HuntDecision =
	/** Thrown about by a blow. It loses the turn. */
	| { readonly kind: 'reel' }
	/** It has heard you. */
	| { readonly kind: 'wake' }
	/** Home, and folding its wings. */
	| { readonly kind: 'settle' }
	| { readonly kind: 'bite'; readonly target: Axial }
	| { readonly kind: 'move'; readonly to: Axial; readonly message: string }
	/** Nothing to watch — asleep, or hemmed in. */
	| { readonly kind: 'pass'; readonly message: string };

export interface HuntOrders {
	readonly state: HuntState;
	/** The route it is following, kept for the overlay rather than for flying. */
	readonly path: readonly Axial[] | null;
	/**
	 * Where it sleeps: the hexagon it was standing on when it first acted.
	 *
	 * Learned rather than given, because a perch is where somebody put the
	 * creature — a second way of saying it is a second thing able to disagree
	 * with where it actually is.
	 */
	readonly home: Axial | null;
	/** How close you get before it notices you, and how far before it forgets. */
	readonly wakeRange: number;
	readonly loseRange: number;

	/**
	 * Tell it that it has been hit.
	 *
	 * It loses its next move to being thrown about, which is what a blow costs
	 * on a turn clock — there is no knockback in metres to apply and nothing to
	 * interrupt, because it was not in the middle of anything.
	 */
	struck(): void;

	/** What to do with this turn. Consumes what it hands back. */
	decide(): HuntDecision;
}

/** The hunt on an object, or null where nothing has put one there. */
export function huntOrders(object: GameObject): HuntOrders | null {
	return (object.getComponentNamed(HUNTER) as unknown as HuntOrders | null) ?? null;
}
