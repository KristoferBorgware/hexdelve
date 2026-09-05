/*
 * Where the rules meet the drawing.
 *
 * `turns.ts` is in game turns, and a game turn has no length. But a step still
 * has to be *watched*, and how long it takes on screen cannot be a number
 * somebody liked the feel of — because then a creature's speed and the speed
 * it appears to move at would be two unrelated facts, and the readout would be
 * lying about the fight.
 *
 * So one game turn is given a length, and it is taken from the walk. A man at
 * normal speed pays 100 energy to cross one hexagon and gains 10 a turn, so
 * his step is ten game turns; make those ten turns exactly as long as his legs
 * take to walk 1.73 m and everything else follows from the table. The bat at
 * +10 gains 20 a turn, so its step is five game turns, so it crosses a hexagon
 * in half the time — and it looks twice as fast because it *is* twice as fast,
 * by the same number that makes it act twice as often.
 *
 * The consequence worth saying out loud: this is why speed can be read off the
 * screen at all. Haste the man by +10 and his step halves, which is a speed
 * his walk cannot deliver — so his blend tree puts him into a run, and a row
 * of the energy table has visibly turned into a gait.
 *
 * It lives apart from `turns.ts` so that file stays what it is: a table and a
 * queue, with no rig, no grid and no seconds in it.
 */

import { HEX_SPACING } from '@hexdelve/shared';

import { energyPerTurn, gameTurnsPerAction, NORMAL_SPEED } from './turns.js';

/*
 * The walk this clock is set from, in metres a second.
 *
 * Set rather than computed, because what a walk carries him at is measured off
 * the clip he is drawn with and a clip comes off disk. It cannot be known at
 * import, only once the cast is loaded — which is where `Simulation` sets it,
 * beside the other numbers it reads off the player's own files.
 *
 * Unset is an error rather than a default. A clock quietly running at somebody's
 * guessed speed would put every creature's step slightly out of step with the
 * energy table, and nothing would say so.
 */
let walk = 0;

/** Measured off the walk the player is actually drawn with. */
export function setWalkSpeed(metresPerSecond: number): void {
	if (!(metresPerSecond > 0)) {
		throw new Error(`the turn clock needs a walk that goes somewhere, not ${metresPerSecond}`);
	}
	walk = metresPerSecond;
}

/**
 * Seconds one game turn is drawn over: a normal-speed step, divided by its ten
 * turns.
 */
export function secondsPerGameTurn(): number {
	if (walk === 0) {
		throw new Error('the turn clock has no walk yet — setWalkSpeed before anything asks the time');
	}
	return HEX_SPACING / walk / gameTurnsPerAction(NORMAL_SPEED);
}

/** How long an action of this cost takes on screen, for a creature of this speed. */
export function actionSeconds(cost: number, speed: number): number {
	return (cost / energyPerTurn(speed)) * secondsPerGameTurn();
}

/** How fast a creature of this speed must travel to cross one hexagon in one action. */
export function hexSpeed(speed: number): number {
	return HEX_SPACING / actionSeconds(100, speed);
}
