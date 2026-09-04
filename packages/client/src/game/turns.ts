/*
 * The clock, and it is not a clock made of seconds.
 *
 * Labs 06-09 all ran on real time: a frame arrived, everything in the world
 * got a slice of it, and how far anything moved was its speed times that
 * slice. That is the only clock a game needs right up until two creatures have
 * to take turns, and then it is the wrong one — because "twice as fast" has to
 * mean "acts twice as often", not "slides twice as far per frame".
 *
 * So the world keeps Angband's clock instead (docs/angband/02-time-energy-
 * speed.md, derived from `game-world.c`). There is a game-turn counter; every
 * game turn each creature gains energy at a rate set by its speed; a creature
 * acts when its reservoir reaches 100 and pays 100 to do it. Speed is
 * therefore a *rate* and not a turn order, which is the whole reason to do it
 * this way: nothing anywhere has to special-case "the fast one goes twice".
 * The bat is +10, gains 20 a turn against the man's 10, and falls out of the
 * arithmetic taking two steps to his one.
 *
 * Two things are deliberately not here. There is no wall clock — a member of
 * the schedule knows nothing about seconds, and how long an action takes to
 * *draw* is the simulation's business (see `actionSeconds`). And there is no
 * decision-making: this file answers "whose turn is it", never "what should
 * they do".
 */

/** What one ordinary action costs. Angband's `move_energy`. */
export const ACTION_ENERGY = 100;

/**
 * Normal speed. Angband stores speed with an offset of 110, so 120 is "+10"
 * and 100 is "-10", and the offset is kept rather than tidied away because
 * every number in the chapter this comes from is written that way.
 */
export const NORMAL_SPEED = 110;

/**
 * `extract_energy`: energy gained per game turn, indexed by speed.
 *
 * Every row up to +40 is the table as the chapter gives it. Above that the
 * chapter records only the decade anchors — +40 is 42, +50 is 45, +60 is 47,
 * +70 and beyond 49 — and the rows between them here climb monotonically to
 * those anchors. Nothing in this game is within forty points of that yet; it
 * is filled in so a hasted anything cannot fall off the end of the array.
 *
 * The shape worth knowing is in the middle: between -10 and +30 it is one
 * extra point per point of speed, so +10 is exactly double and +20 triple.
 * Past +30 it flattens hard, and below -10 it bottoms out at 1 — a creature
 * can be made slow, but never quite stopped.
 */
const EXTRACT_ENERGY: readonly number[] = [
	...filled(0, 50, 1), // -60 and slower: one point a turn, and no less
	...filled(50, 60, 1), // -50
	...filled(60, 70, 1),
	...filled(70, 80, 2), // -40
	2, 2, 2, 2, 2, 2, 2, 3, 3, 3, // -30
	3, 3, 3, 3, 3, 4, 4, 4, 4, 4, // -20
	5, 5, 5, 5, 6, 6, 7, 7, 8, 9, // -10
	10, 11, 12, 13, 14, 15, 16, 17, 18, 19, // normal
	20, 21, 22, 23, 24, 25, 26, 27, 28, 29, // +10
	30, 31, 32, 33, 34, 35, 36, 36, 37, 37, // +20
	38, 38, 39, 39, 40, 40, 40, 41, 41, 41, // +30
	42, 42, 42, 43, 43, 43, 44, 44, 44, 45, // +40
	45, 45, 45, 45, 46, 46, 46, 46, 46, 47, // +50
	47, 47, 47, 47, 48, 48, 48, 48, 48, 49, // +60
	...filled(180, 190, 49), // +70
	...filled(190, 200, 49), // and the fastest anything gets
];

function filled(from: number, to: number, value: number): number[] {
	return new Array<number>(to - from).fill(value);
}

/** Energy a creature of this speed gains each game turn. */
export function energyPerTurn(speed: number): number {
	const index = Math.max(0, Math.min(EXTRACT_ENERGY.length - 1, Math.round(speed)));
	return EXTRACT_ENERGY[index]!;
}

/**
 * How this speed compares with normal, as a multiplier — the number
 * `mon-lore.c` uses to tell you a thing "moves at double normal speed".
 */
export function speedFactor(speed: number): number {
	return energyPerTurn(speed) / energyPerTurn(NORMAL_SPEED);
}

/** Game turns a creature of this speed takes to afford one ordinary action. */
export function gameTurnsPerAction(speed: number): number {
	return ACTION_ENERGY / energyPerTurn(speed);
}

/**
 * Anything that takes turns. The schedule owns the energy and nothing else:
 * what a member *is* — a man, a bat — it never asks.
 */
export interface TurnMember {
	/** For the readout, and for telling two members apart in a log. */
	readonly name: string;
	/** Angband-style, offset by 110. See NORMAL_SPEED. */
	readonly speed: number;
	energy: number;
}

/**
 * Whose turn it is.
 *
 * `next` winds the clock forward until somebody can afford to act and hands
 * that member back; the caller decides what they do, then pays for it with
 * `spend`. Two properties make it worth having as its own object: it is pure
 * bookkeeping, so it can be tested without a world, and it cannot advance
 * time on its own — the simulation only calls it when the player has actually
 * asked for something, which is what makes a turn-based world stand still
 * while you think.
 */
export class Schedule<T extends TurnMember = TurnMember> {
	/** Game turns since the world started. */
	gameTurn = 0;

	private readonly list: T[];

	constructor(members: readonly T[]) {
		this.list = [...members];
	}

	/** Who is still taking turns, in the order ties are broken. */
	get members(): readonly T[] {
		return this.list;
	}

	/**
	 * Take somebody out of the order.
	 *
	 * For a creature that has stopped being a participant — killed, usually.
	 * Removing rather than flagging, because a flag would have to be checked in
	 * `next`, and `next` winds the clock forward until somebody can act: a list
	 * of members that can never act again is a loop that never ends.
	 *
	 * Returns whether it was there. Removing something twice is not an error —
	 * an event can be announced more than once and the second one should be
	 * quiet.
	 */
	remove(member: T): boolean {
		const at = this.list.indexOf(member);
		if (at < 0) return false;
		this.list.splice(at, 1);
		return true;
	}

	/**
	 * The member with the most energy of those that can act, winding the clock
	 * forward as far as it takes.
	 *
	 * Ties go to whoever comes first in the list, so putting the player at the
	 * head of it gives them Angband's own tie-break: among creatures ready on
	 * the same turn, the ones strictly faster than you go first, then you, then
	 * the rest.
	 */
	next(): T | null {
		if (this.members.length === 0) return null;
		for (;;) {
			let best: T | null = null;
			for (const member of this.members) {
				if (member.energy < ACTION_ENERGY) continue;
				if (!best || member.energy > best.energy) best = member;
			}
			if (best) return best;
			this.gameTurn++;
			for (const member of this.members) member.energy += energyPerTurn(member.speed);
		}
	}

	/**
	 * Charge a member for what it just did.
	 *
	 * The remainder is kept rather than cleared, which is the whole of how a
	 * speed that is not a neat multiple still comes out right over time: a +5
	 * creature banks the change and every other action arrives a game turn
	 * earlier.
	 */
	spend(member: T, cost = ACTION_ENERGY): void {
		member.energy -= cost;
	}
}

/** One thing a creature does on its turn: what it was, and what it cost. */
export interface Action {
	readonly kind: string;
	/** Energy spent. `ACTION_ENERGY` for anything ordinary. */
	readonly cost: number;
	/** Seconds it is drawn over. Zero for something with nothing to show. */
	readonly seconds: number;
}

/**
 * A member of the schedule that can actually be asked to do something.
 *
 * `busy` is how the simulation knows to stop handing out turns: while anything
 * is still playing out its last one, the clock does not move.
 */
export interface TurnTaker extends TurnMember {
	readonly busy: boolean;
	/** Decide, start, and say what it cost. */
	beginTurn(): Action;
}
