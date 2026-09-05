/*
 * What a click means, and what the man should do about it next turn.
 *
 * The whole of the game's input. A click arrives as a hexagon, and on a grid
 * every meaning it has is the same request with a different ending: walk to
 * that hexagon, walk to the thing lying on it and stoop, walk up to the bat
 * and cut it, or — clicking where he stands — wait a turn. What decides which
 * is what is standing there, not which mouse button.
 *
 * ## Why this is a script
 *
 * It is the half of the man that is a decision. `Player` beside it knows how
 * long each action takes and what it looks like; this knows the grid, the
 * route, and what he is carrying. Splitting them there means the rules of
 * moving about can be edited and reloaded while the yard is running, and it
 * means the body can be drawn on a bench with nobody driving it.
 *
 * ## The clock
 *
 * `hasOrders` is what makes the world turn-based rather than merely hex-based.
 * Nothing anywhere gains energy while it is false, so the bat mid-hunt is
 * frozen with its wings out until he asks for something. It is a question
 * about the standing order rather than a pause flag, so there is no second
 * piece of state to get out of step with what he is actually doing.
 */

import { Script } from '@hexdelve/engine';
import { axialDistance, axialNeighbours, findPath, type Axial } from '@hexdelve/shared';
import { MAX_CLIMB, NOWHERE, Player, type Item, type PlayerDecision } from '@hexdelve/client';

/** A goal standing until it is finished or replaced. */
interface Order {
	readonly goal: Axial;
	/** Whether the goal is the enemy, which moves — so the route is re-laid. */
	readonly attack: boolean;
}

export class PlayerInput extends Script {
	private order: Order | null = null;
	private holdOnce = false;
	private route: Axial[] = [];

	/**
	 * The body these orders drive.
	 *
	 * Looked up rather than kept, because a hot reload builds a new instance of
	 * this script and `Player` is added to the object after the prefab's
	 * components are — so there is no moment at load when caching it would be
	 * both possible and correct.
	 */
	private get body(): Player | null {
		return this.object.getComponent(Player);
	}

	/* -------------------------------------------------------------- the grid -- */

	/** May he stand on `cell`, having come from `from`? */
	private readonly walkable = (cell: Axial, from: Axial | null): boolean => {
		const body = this.body;
		if (!body) return false;
		const enemy = body.opponent?.cell ?? NOWHERE;
		if (cell.q === enemy.q && cell.r === enemy.r) return false;
		return body.ground.passable(cell, from, MAX_CLIMB);
	};

	reachable(cell: Axial): boolean {
		const body = this.body;
		if (!body) return false;
		if (this.walkable(cell, null)) {
			return findPath(body.cell, cell, { passable: this.walkable }) !== null;
		}
		return this.approach(cell) !== null;
	}

	/**
	 * The best hexagon to stand on to deal with something on `cell`.
	 *
	 * The two cases where the click is not a place to walk: the anvil, which is
	 * solid, and the bat, which is occupied. Both come out the same way — the
	 * nearest neighbour he can stand on.
	 */
	private approach(cell: Axial): Axial | null {
		const body = this.body;
		if (!body) return null;
		let best: Axial | null = null;
		let bestScore = Infinity;
		for (const n of axialNeighbours(cell)) {
			if (!this.walkable(n, null)) continue;
			const score = axialDistance(body.cell, n);
			if (score < bestScore) {
				bestScore = score;
				best = n;
			}
		}
		return best;
	}

	private itemUnderfoot(): Item | null {
		const body = this.body;
		if (!body) return null;
		for (const item of body.items) {
			if (item.worn) continue;
			if (item.cell.q === body.cell.q && item.cell.r === body.cell.r) return item;
		}
		return null;
	}

	/** Lay a route to a goal. False if there is no way to it at all. */
	private plan(order: Order): boolean {
		const body = this.body;
		if (!body) return false;
		const stand =
			this.walkable(order.goal, null) && !order.attack ? order.goal : this.approach(order.goal);
		if (!stand) return false;
		if (stand.q === body.cell.q && stand.r === body.cell.r) {
			this.route = [];
			return true;
		}
		const found = findPath(body.cell, stand, { passable: this.walkable });
		if (!found) return false;
		this.route = found.slice(1);
		return true;
	}

	/* ------------------------------------------------------------- the orders -- */

	get hasOrders(): boolean {
		return this.order !== null || this.holdOnce || this.itemUnderfoot() !== null;
	}

	get goal(): Axial | null {
		if (!this.order) return null;
		return this.order.attack ? (this.body?.opponent?.cell ?? NOWHERE) : this.order.goal;
	}

	get targetingEnemy(): boolean {
		return this.order?.attack ?? false;
	}

	get path(): readonly Axial[] {
		return this.route;
	}

	orderTo(cell: Axial): boolean {
		const body = this.body;
		if (!body) return false;
		const enemy = body.opponent?.cell ?? NOWHERE;
		const attack = cell.q === enemy.q && cell.r === enemy.r;

		// Clicking where he already stands is how you wait a turn with a mouse.
		if (!attack && cell.q === body.cell.q && cell.r === body.cell.r) {
			this.hold();
			return true;
		}

		const order: Order = { goal: { q: cell.q, r: cell.r }, attack };
		if (attack && axialDistance(body.cell, enemy) <= 1) {
			this.order = order;
			this.route = [];
			this.holdOnce = false;
			return true;
		}
		if (!this.plan(order)) return false;
		this.order = order;
		this.holdOnce = false;
		return true;
	}

	hold(): void {
		this.holdOnce = true;
	}

	cancel(): void {
		this.order = null;
		this.route = [];
		this.holdOnce = false;
	}

	/* --------------------------------------------------------------- the turn -- */

	/**
	 * What he should spend this turn on.
	 *
	 * The order of the tests is the priority: a blow he is in position to
	 * throw, then a thing under his feet, then the next hexagon of the route.
	 */
	decide(): PlayerDecision {
		const body = this.body;
		this.holdOnce = false;
		if (!body) return { kind: 'wait', message: 'waiting' };

		const enemy = body.opponent?.cell ?? NOWHERE;
		if (this.order?.attack && axialDistance(body.cell, enemy) <= 1) {
			return { kind: 'strike', target: { q: enemy.q, r: enemy.r } };
		}

		const item = this.itemUnderfoot();
		if (item) return { kind: 'pickup', item };

		const order = this.order;
		if (!order) return { kind: 'wait', message: 'waiting' };

		// The route is re-laid when it is chasing something that moves, and when
		// the next hexagon has become someone else's since it was laid.
		const next = this.route[0];
		if ((order.attack || !next || !this.walkable(next, body.cell)) && !this.plan(order)) {
			this.order = null;
			return { kind: 'wait', message: 'there is no way through' };
		}

		const step = this.route[0];
		if (step) {
			this.route.shift();
			if (this.route.length === 0 && !order.attack) this.order = null;
			return { kind: 'move', to: step };
		}

		/*
		 * Standing where he meant to stand with nothing left to do there. For a
		 * walk that is arrival; for a chase it cannot happen, because every
		 * hexagon `approach` offers is a neighbour of the quarry and standing on
		 * one of those is caught by the strike test above.
		 */
		this.order = null;
		return { kind: 'wait', message: 'waiting' };
	}
}
