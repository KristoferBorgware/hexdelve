/*
 * What the man has been asked to do, as the rest of the game sees it.
 *
 * The orders themselves are a SCRIPT — `packages/client/scripts/PlayerInput.ts`
 * — because deciding what a click means is behaviour, and behaviour belongs
 * where it can be edited and reloaded without rebuilding anything. Scripts are
 * compiled apart from this module graph, so nothing here can import that class.
 * This is the shape it satisfies, declared on the side that needs to call it.
 *
 * The seam it draws is worth the interface. One side decides — is that hexagon
 * reachable, is the click a walk or a cut or a stoop, which hexagon is next —
 * and the other executes and draws it. Neither can do the other's half, which
 * is what stops the man being a class that grows a field every time the game
 * learns a verb.
 *
 * `playerOrders` is how a caller gets one: by name, since the name is the only
 * handle a compiled-apart class has. Null is an ordinary answer — a bench
 * previewing the yard with no scripts loaded has a body and no orders on it —
 * and every caller here treats it as "he has been asked for nothing".
 */

import type { GameObject } from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

import type { Item } from './items.js';

/** The name the entity file writes, and the class the script exports. */
export const PLAYER_INPUT = 'PlayerInput';

/** What he should spend this turn on. */
export type PlayerDecision =
	| { readonly kind: 'strike'; readonly target: Axial }
	| { readonly kind: 'pickup'; readonly item: Item }
	| { readonly kind: 'move'; readonly to: Axial }
	| { readonly kind: 'wait'; readonly message: string };

export interface PlayerOrders {
	/**
	 * Whether the clock should be turning.
	 *
	 * This one question is what makes the world turn-based rather than merely
	 * hex-based. Nothing anywhere gains energy while it is false, so the bat
	 * mid-hunt is frozen with its wings out until he decides to do something —
	 * and it is a question about his ORDERS rather than a pause flag, so there
	 * is no state to get out of step with what he is actually doing.
	 */
	readonly hasOrders: boolean;

	/**
	 * Where he is headed, for the readout and the route markers.
	 *
	 * A chase reports where the quarry *is*, not the hexagon it was on when you
	 * clicked it — the marker is what he is going for, and by the time he gets
	 * there the bat will have moved twice.
	 */
	readonly goal: Axial | null;

	readonly targetingEnemy: boolean;

	/** Hexagons still to walk, nearest first. Never includes the one he is on. */
	readonly path: readonly Axial[];

	/** Whether a hexagon can be walked to at all, for the hover marker. */
	reachable(cell: Axial): boolean;

	/**
	 * A click on a hexagon. False when there is no route, so the marker can say
	 * so rather than having him set off and stop.
	 */
	orderTo(cell: Axial): boolean;

	/** Spend one turn doing nothing. */
	hold(): void;

	/** Forget where he was going. */
	cancel(): void;

	/**
	 * What to do with this turn.
	 *
	 * Consumes what it hands back: the step it returns is taken off the route,
	 * and an order that has been arrived at is cleared. Called once per turn,
	 * by whoever is about to start the action.
	 */
	decide(): PlayerDecision;
}

/** The orders on an object, or null where nothing has put any there. */
export function playerOrders(object: GameObject): PlayerOrders | null {
	return (object.getComponentNamed(PLAYER_INPUT) as unknown as PlayerOrders | null) ?? null;
}
