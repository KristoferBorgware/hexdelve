/*
 * The act a creature is in the middle of, and how far through it it is.
 *
 * Named apart from `Action` in turns.ts, which is what a turn COST — a kind, an
 * energy price and a duration, handed to the schedule and then forgotten. This
 * is the thing itself while it plays out.
 *
 * Every action in this game has the same shape whatever it is: it takes a
 * known number of seconds, it may carry the creature from one hexagon to
 * another, and it may have a MOMENT in it — the instant the blade arrives, the
 * instant the jaws close, the instant a thing is lifted off the grass. What
 * differs between a step and a cut is what happens at that moment and what the
 * body looks like meanwhile, and neither of those is this.
 *
 * So this owns the clock, the placement and the latch, and the creature owns
 * the meaning. That is what lets a man and a bat share it: one strikes and the
 * other bites, and both are an action with a contact in the middle of it.
 *
 * ## Where a creature actually is
 *
 * `cell` is authoritative and the transform follows it. Between two hexagons
 * the transform is interpolated; at rest it is snapped to the tile. Nothing
 * else may write the position of something that takes turns, because "which
 * hexagon is it on" is the question the whole game is played in and a second
 * answer to it would be a creature that is somewhere it is not.
 *
 * ## Why it is a component and not a base class
 *
 * A thing that takes turns and a thing that is drawn are different questions,
 * and the second one already has components for it. Making this one too means
 * an entity file says a creature acts by listing it, and the order it is
 * listed in is the order it runs — before whatever drives the animation, which
 * is the ordering that stops a body being drawn one frame behind what it is
 * doing.
 */

import { Component } from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

import { terrainNear, type TerrainQuery, type Tile } from './terrain.js';

/** One action, while it is playing out. */
export interface Flight {
	/** What it is, in whatever words the creature uses — `move`, `bite`. */
	readonly kind: string;
	readonly seconds: number;
	clock: number;
	readonly from: Tile;
	readonly to: Tile;
	/** The hexagon it ends on, which is `from`'s for anything that stays put. */
	readonly cell: Axial;
	/** What it is aimed at, for an action that is aimed at something. */
	readonly target: Axial | null;
	/** True once the moment in the middle of it has been announced. */
	done: boolean;
}

export class Acting extends Component {
	/** The hexagon it is on. Authoritative — the transform is drawn from it. */
	cell: Axial = { q: 0, r: 0 };

	private current: Flight | null = null;

	/** The ground it stands on, found in the scene when it is first wanted. */
	private ground: TerrainQuery | null = null;

	get terrain(): TerrainQuery | null {
		return (this.ground ??= terrainNear(this.object));
	}

	/** The tile it is standing on, or null on ground that has none. */
	tile(): Tile | null {
		return this.terrain?.tileAt(this.cell.q, this.cell.r) ?? null;
	}

	/** What it is doing, or null while it is doing nothing. */
	get flight(): Flight | null {
		return this.current;
	}

	get busy(): boolean {
		return this.current !== null;
	}

	/** How far through the action it is, 0 to 1. One when there is none. */
	get phase(): number {
		const flight = this.current;
		if (!flight) return 1;
		return flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;
	}

	/** Put it on a hexagon, without playing anything out. */
	place(cell: Axial, yaw = this.object.transform.yaw): void {
		this.cell = { q: cell.q, r: cell.r };
		const tile = this.tile();
		if (tile) this.object.transform.setPosition(tile.x, tile.top, tile.z);
		this.object.transform.yaw = yaw;
	}

	/**
	 * Start one, and hand back the flight so the caller can say what it means.
	 *
	 * `to` is the tile it ends on. For anything that stays where it is that is
	 * the tile it is already on, which is why there is no separate kind of
	 * action for standing still.
	 */
	begin(kind: string, seconds: number, to: Tile, cell: Axial, target: Axial | null = null): Flight {
		const from = this.tile() ?? to;
		this.current = {
			kind,
			seconds,
			clock: 0,
			from,
			to,
			cell: { q: cell.q, r: cell.r },
			target: target ? { q: target.q, r: target.r } : null,
			done: false,
		};
		return this.current;
	}

	/** Drop whatever it was doing, without settling it. */
	clear(): void {
		this.current = null;
	}

	/**
	 * Wind the clock on, and carry it between hexagons while it runs.
	 *
	 * Called FIRST in a frame, before anything reads `phase`. Everything a
	 * creature does about the act it is in — turning to face what it is aimed
	 * at, announcing the blow, driving the animation — is a question about how
	 * far through it is NOW, and a caller that asked before this ran would be
	 * answering with last frame's.
	 *
	 * The travel is a straight line at a constant rate, deliberately: a stride
	 * is solved for exactly this speed, and easing the ends would put the feet
	 * back to sliding at both of them.
	 */
	advance(dt: number, carry = true): void {
		const flight = this.current;
		if (!flight) return;

		flight.clock += dt;
		if (!carry || flight.from === flight.to) return;

		const u = this.phase;
		this.object.transform.setPosition(
			flight.from.x + (flight.to.x - flight.from.x) * u,
			flight.from.top + (flight.to.top - flight.from.top) * u,
			flight.from.z + (flight.to.z - flight.from.z) * u,
		);
	}

	/**
	 * End it if its time is up, and hand back what ended.
	 *
	 * Called LAST, after the creature has had its say about the frame — a blow
	 * announced on the instant the act finishes is still that act's. What
	 * finishing MEANS is the caller's: a bat backs off after a bite, a man goes
	 * back to waiting, and neither is a thing this could know.
	 */
	settle(carry = true): Flight | null {
		const flight = this.current;
		if (!flight || flight.clock < flight.seconds) return null;

		this.cell = flight.cell;
		const settled = this.tile();
		if (settled && carry) {
			this.object.transform.setPosition(settled.x, settled.top, settled.z);
		}
		this.current = null;
		return flight;
	}

	/**
	 * Whether the moment in the middle has arrived, once.
	 *
	 * Latched, so a caller that asks every frame is told exactly once — which
	 * is what a blow needs, since announcing one twice would land it twice.
	 */
	reached(at: number): boolean {
		const flight = this.current;
		if (!flight || flight.done || this.phase < at) return false;
		flight.done = true;
		return true;
	}
}
