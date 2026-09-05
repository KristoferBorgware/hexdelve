/*
 * What a blow costs, and what came of it.
 *
 * The `Melee` script's side of the fence, declared here because the script is
 * compiled apart from this package and nothing in it can be imported — the same
 * arrangement `orders.ts`, `hunt.ts` and `terrain.ts` describe. The interface
 * is the client's; the class that answers to it is a script somebody can edit
 * and reload.
 *
 * The split runs between the picture and the rule. A body knows when its blade
 * is at the point of its arc, where the point actually got to and which arc it
 * swept, because all three are measured off the clip as it plays. It does not
 * know what a blow takes off, whether the hexagon it aimed at still means
 * anything, or how many of its cuts have connected. Those are rules, and this
 * is where they are asked for.
 */

import type { GameObject } from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

import type { Point, Reach } from './events.js';

/** The class the script declares. One string, so a rename is one edit. */
export const MELEE = 'Melee';

/** A blow, as the body throwing it knows it at the instant of contact. */
export interface Strike {
	/** Where the blow comes FROM — the hand for a sword, the teeth for a bite. */
	readonly at: Point;
	/** Which way the thrower is facing, in radians about +Y. */
	readonly facing: number;
	/** How far it gets and between which two bearings it passes. */
	readonly reach: Reach;
}

/** The rule half of a melee: whether a blow connected, and the tally of them. */
export interface MeleeStrikes {
	/** Blows thrown, connected and not. */
	readonly thrown: number;
	readonly hits: number;
	readonly missed: number;
	/** What came of the last one, in words, for the readout. */
	readonly message: string;
	/** A blow begun, counted at the moment the body commits to throwing it. */
	begin(): void;
	/** Contact: the blow as thrown, and the hexagon it was aimed at. */
	land(blow: Strike, target: Axial | null): void;
}

/**
 * The melee on an object, or null when it has none.
 *
 * Looked up each time rather than kept: a hot reload replaces the instance, and
 * a reference taken once would name the version it replaced. Null is an
 * ordinary answer — a body on a bench throws blows at nothing, and a creature
 * with no `Melee` in its entity file cannot fight.
 */
export function melee(object: GameObject): MeleeStrikes | null {
	return (object.getComponentNamed(MELEE) as unknown as MeleeStrikes | null) ?? null;
}
