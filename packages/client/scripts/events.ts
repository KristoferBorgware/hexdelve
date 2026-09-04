/*
 * The things that happen in this game, and what comes with each.
 *
 * One file, because an event is a contract between two scripts that must not
 * know about each other. If `Character` imported the sword and the sword
 * imported `Character`, the seam the events exist to create would already be
 * gone; both import this instead, and neither can see the other.
 *
 * A name here is matched by its STRING, so renaming the constant is free and
 * renaming the string is a change to every script that uses it. Keep the two
 * the same anyway, or the next reader has to look twice.
 */

import { defineEvent } from '@hexdelve/scripting';

/** Where something is standing, in world units. */
export interface Where {
	readonly x: number;
	readonly z: number;
}

/** A blow landing on somebody. */
export interface Blow {
	/** Hit points to take off. Always positive; healing is not this event. */
	readonly amount: number;
	/** What dealt it, by name, for the readout and for not hitting yourself. */
	readonly from: string;
}

/** Somebody has been hit. Sent to the one that was hit, never broadcast. */
export const Damage = defineEvent<Blow>('damage');

/** Somebody has run out of hit points. Announced to everyone. */
export const Died = defineEvent<{ readonly who: string }>('died');

/**
 * A swing has been made, and whatever is in front of it should be worked out.
 *
 * Announced rather than sent, because the swinger does not know what it hit —
 * that is exactly the question, and `Combat` is what answers it.
 */
export const Swing = defineEvent<{
	readonly by: string;
	readonly at: Where;
	/** Which way the swinger is facing, in radians about +Y. */
	readonly facing: number;
	readonly reach: number;
	readonly amount: number;
}>('swing');
