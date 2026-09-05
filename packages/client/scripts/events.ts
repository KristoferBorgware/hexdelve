/*
 * The things that happen in this game, and what comes with each.
 *
 * One file, because an event is a contract between two scripts that must not
 * know about each other. If `Character` imported the sword and the sword
 * imported `Character`, the seam the events exist to create would already be
 * gone; both import this instead, and neither can see the other.
 *
 * ## The client declares these too
 *
 * Scripts and the client's source cannot import each other — the scripts are
 * compiled apart from every module graph, which is what lets them use syntax
 * the applications cannot. So the client has its own copy of these tokens in
 * `packages/client/src/game/events.ts`, and the two agree because the host
 * matches an event by its NAME rather than by the identity of the token.
 *
 * That is a duplication, and it is the one place in this design that has any.
 * It is kept honest by a test that reads both files and fails if a name here
 * has no counterpart there. Renaming the constant is free; renaming the string
 * is a change to both files and to every prefab that mentions it.
 */

import { defineEvent } from '@hexdelve/engine';

/** Where something is, in world units. */
export interface Point {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** How far and how wide a weapon reaches, measured off the clip that swings it. */
export interface Reach {
	/** The arc it covers, as bearings either side of dead ahead, in radians. */
	readonly from: number;
	readonly to: number;
	/** How far the point gets, in world units. */
	readonly distance: number;
	/** How high the blade rides above the swinger's feet. */
	readonly height: number;
}

/** A blow landing on somebody. */
export interface Blow {
	/** Hit points to take off. Always positive; healing is not this event. */
	readonly amount: number;
	/** What dealt it, by name, for the readout and for not hitting yourself. */
	readonly from: string;
	/** Where it landed, for whatever draws the impact. */
	readonly at: Point;
}

/** Somebody has been hit. Sent to the one that was hit, never broadcast. */
export const Damage = defineEvent<Blow>('damage');

/** Somebody has run out of hit points. Announced to everyone. */
export const Died = defineEvent<{ readonly who: string }>('died');

/**
 * A blow has been thrown, and whatever is in front of it should be worked out.
 *
 * Announced rather than sent, because the swinger does not know what it hit —
 * that is exactly the question, and `Combat` is what answers it. The geometry
 * travels with it because only the swinger knows it: the reach and the arc are
 * measured off the animation clip as it plays, and a system that guessed at
 * them would disagree with what the picture shows.
 */
export const Swing = defineEvent<{
	readonly by: string;
	readonly at: Point;
	/** Which way the swinger is facing, in radians about +Y. */
	readonly facing: number;
	readonly reach: Reach;
	readonly amount: number;
}>('swing');

/**
 * A blow was thrown and connected with nothing.
 *
 * For the readout, which is the client's. `Combat` says so rather than staying
 * quiet, because "nothing happened" and "the rule never ran" look identical
 * from outside and only one of them is a bug.
 */
export const Missed = defineEvent<{ readonly by: string; readonly why: string }>('missed');

/**
 * A blow was thrown and connected.
 *
 * The mirror of `Missed`, and it exists for the same reason: a blow is `sent`
 * to the thing it hit, so the thing that threw it hears nothing. This is the
 * announcement it does hear, and a tally of cuts and hits is kept off it.
 */
export const Landed = defineEvent<{ readonly by: string; readonly on: string }>('landed');
