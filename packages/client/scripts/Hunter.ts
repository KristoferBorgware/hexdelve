/*
 * A creature that sleeps until it hears you, chases while it can, and goes
 * home when it loses you.
 *
 *   asleep -> hunting <-> returning -> asleep
 *
 * The whole of a hunt, as four numbers and a state. Nothing in it is about a
 * bat: the ranges, how many terraces a step clears and how far it bites from
 * are parameters the entity file sets, so a hound on the ground and a bat in
 * the air carry the same script at different settings. What differs between
 * them is the body beside this one, which knows what a wingbeat looks like.
 *
 * ## Why this is a script
 *
 * It is the half of the creature that is a decision. `BatHunt` beside it knows
 * how long an action takes, where the teeth get to, and what any of it looks
 * like; this knows the grid, the route and whether it has heard you. Splitting
 * them there means the rules of a hunt can be edited and reloaded while the
 * yard is running, and it means the body can be drawn on a bench with nothing
 * driving it.
 *
 * ## Speed is not here
 *
 * It takes two hexagons for every one of yours because its row in the energy
 * table is +10, which `extract_energy` makes exactly double. Nothing in this
 * file implements that, and nothing should: a cruise speed, a bite cooldown and
 * a waypoint radius were three tuned constants standing in for one row.
 */

import { param, Script } from '@hexdelve/engine';
import { axialDistance, axialNeighbours, findPath, type Axial } from '@hexdelve/shared';
import { BatHunt, NOWHERE, type HuntDecision, type HuntState } from '@hexdelve/client';

export class Hunter extends Script {
	/** Tiles: how close you get before it notices you. */
	wakeRange = param(3, { min: 0, max: 20, step: 1, hint: 'Tiles before it hears you' });

	/** Tiles: how far you get before it stops caring. */
	loseRange = param(6, { min: 0, max: 30, step: 1, hint: 'Tiles before it gives up' });

	/** Terraces one step clears. A pair of wings clears more than a pair of legs. */
	climb = param(2, { min: 0, max: 8, step: 1, hint: 'Terraces a step clears' });

	state: HuntState = 'asleep';
	path: Axial[] | null = null;
	home: Axial | null = null;

	private hit = false;

	/**
	 * The body this hunt drives.
	 *
	 * Looked up rather than kept, because a hot reload builds a new instance of
	 * this script and the body is added to the object after the prefab's
	 * components are — so there is no moment at load when caching it would be
	 * both possible and correct.
	 */
	private get body(): BatHunt | null {
		return this.object.getComponent(BatHunt);
	}

	struck(): void {
		this.hit = true;
		this.path = null;
	}

	/**
	 * The same ground asked the other way: a terrace is a step to him and a
	 * flap to it, and neither may enter the cell the other is in.
	 */
	private readonly flyable = (cell: Axial, from: Axial | null): boolean => {
		const body = this.body;
		if (!body) return false;
		const player = body.opponent?.cell ?? NOWHERE;
		if (cell.q === player.q && cell.r === player.r) return false;
		return body.ground.passable(cell, from, this.climb);
	};

	/**
	 * Path to a tile beside the man, not onto him: the grid is for getting
	 * there, the last hexagon is the bite's business.
	 */
	private approach(goal: Axial): Axial | null {
		const body = this.body;
		if (!body) return null;
		let best: Axial | null = null;
		let bestScore = Infinity;
		for (const n of axialNeighbours(goal)) {
			if (!this.flyable(n, null)) continue;
			const d = axialDistance(body.cell, n);
			if (d < bestScore) {
				bestScore = d;
				best = n;
			}
		}
		return best;
	}

	/** One hexagon towards a goal, re-pathed every turn because the quarry moves. */
	private step(goal: Axial, message: string): HuntDecision {
		const body = this.body;
		if (!body) return { kind: 'pass', message };
		const route = findPath(body.cell, goal, { passable: this.flyable });
		this.path = route && route.length > 1 ? route.slice(1) : null;
		const next = this.path?.[0];
		if (!next) return { kind: 'pass', message: message === 'hunting' ? 'cornered' : message };
		if (!body.ground.tileAt(next.q, next.r)) return { kind: 'pass', message };
		return { kind: 'move', to: next, message };
	}

	decide(): HuntDecision {
		const body = this.body;
		if (!body) return { kind: 'pass', message: 'asleep' };

		// Where it sleeps is where it was put, learned the first time it acts.
		this.home ??= { q: body.cell.q, r: body.cell.r };
		const home = this.home;

		const player = body.opponent?.cell ?? NOWHERE;
		const range = axialDistance(body.cell, player);

		if (this.hit) {
			this.hit = false;
			this.state = 'hunting';
			return { kind: 'reel' };
		}

		if (this.state === 'asleep') {
			// It hears you coming, measured on the grid it lives on.
			if (range > this.wakeRange) return { kind: 'pass', message: 'asleep' };
			this.state = 'hunting';
			return { kind: 'wake' };
		}

		if (this.state === 'hunting') {
			if (range > this.loseRange) {
				this.state = 'returning';
				return this.step(home, 'losing you');
			}
			// It attacks from the hexagon it is on, so the condition is about
			// the grid and nothing else: next to him, and it is its turn.
			if (range <= 1) return { kind: 'bite', target: { q: player.q, r: player.r } };
			return this.step(this.approach(player) ?? player, 'hunting');
		}

		// Returning.
		if (range <= this.wakeRange) {
			this.state = 'hunting';
			return this.step(this.approach(player) ?? player, 'hunting');
		}
		if (body.cell.q === home.q && body.cell.r === home.r) {
			this.state = 'asleep';
			this.path = null;
			return { kind: 'settle' };
		}
		return this.step(home, 'going home');
	}
}
