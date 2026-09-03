/*
 * The bat, back on the clock.
 *
 * It never left the grid — that was the whole point of it in lab 08, and lab
 * 09 changed nothing but the line that asks which cell the man is in. What
 * changes here is time. It used to hunt in seconds: a cruise speed, a path
 * followed by metres per frame, a bite on a cooldown. Now it hunts in turns,
 * and its speed is one number in the energy table instead of three tuned ones.
 *
 * That number is +10, which in `extract_energy` is exactly double. So it takes
 * two hexagons for every one of yours and bites twice while you cut once, and
 * nothing here implements that — it falls out of the table. The three constants
 * a cruise speed used to need are gone with it:
 *
 *   speed          -> `speed`, one row of the energy table
 *   bite cooldown  -> the 100 energy a bite costs, like every other action
 *   waypoint radius -> nothing. A step is one hexagon, so there is no line
 *                      between waypoints to be circled, and no path to be
 *                      checked between its corners.
 *
 * That last one is worth dwelling on. Lab 09 needed a keep-apart radius,
 * because A* would not route the bat through the man's hexagon but the flight
 * between two corners of the path went clean through him anyway. On a turn
 * clock there is no between: a move ends on a cell or does not happen, and two
 * creatures cannot occupy one cell. The whole class of problem is gone, and so
 * is the constant that patched it.
 *
 *   asleep -> hunting <-> returning -> asleep
 *
 * The states it lost are the ones that were only ever animations: waking,
 * striking, recovering and settling were phases of a clip, and a phase of a
 * clip is what an action already is.
 */

import {
	attachmentPosition,
	mixSparse,
	type SparsePose,
} from '@hexdelve/engine';
import {
	axialDistance,
	axialNeighbours,
	findPath,
	HEX_SPACING,
	type Axial,
	type Random,
} from '@hexdelve/shared';

import { Actor, clamp, turnTowards, wrapAngle, type ActorOptions } from './actor.js';
import { BAT_SKELETON, HOVER_Y, JAW_TIP } from './batrig.js';
import { flyPose, FLAP_PERIOD, LUNGE_CONTACT, lungePose, perchPose } from './batpose.js';
import { actionSeconds } from './pace.js';
import { ACTION_ENERGY, NORMAL_SPEED, type Action, type TurnTaker } from './turns.js';
import type { Tile, World } from '../scene/world.js';

const TAU = Math.PI * 2;

/** Terraces a pair of wings clears in one step. */
export const BAT_CLIMB = 2;
/** Tiles: how close you get before it notices you. */
export const WAKE_RANGE = 3;
/** Tiles: how far you get before it stops caring. */
export const LOSE_RANGE = 6;
/**
 * Its place in the energy table: +10, which is exactly twice normal. Every
 * "it is faster than you" in this file is this line and nothing else.
 */
export const BAT_SPEED = NORMAL_SPEED + 10;
/** How far off the ground the wings hold it, once awake. */
const HOVER_LIFT = 0.62;

/**
 * How far the jaws reach at the moment of the bite, measured off the lunge.
 *
 * The same question the sword had, asked of a different rig: the pose is
 * sampled at its contact key and the jaw tip's distance from the body read
 * off it, so re-timing the lunge moves this on its own.
 */
export const BAT_REACH = (() => {
	const pose = lungePose(LUNGE_CONTACT, {});
	const tip = attachmentPosition(BAT_SKELETON, pose, 'jaw', JAW_TIP);
	return { distance: Math.hypot(tip[0], tip[2]), height: tip[1] };
})();

/**
 * What the lunge cannot cover, taken out of the body — the bat's half of the
 * argument in `player.ts` under `LEAN_IN`. A creature rooted to a hexagon
 * whose reach is shorter than the grid bites at nothing, so the shortfall goes
 * in as forward root travel across the strike and comes back out.
 */
export const BAT_LEAN = Math.max(0, HEX_SPACING - BAT_REACH.distance);

export type HuntState = 'asleep' | 'hunting' | 'returning';

type BatActionKind = 'move' | 'bite' | 'wake' | 'settle' | 'reel' | 'wait';

export interface BatDeps {
	world: World;
	playerCell: () => Axial;
	playerPosition: () => { x: number; y: number; z: number };
	/** Called when the jaws actually reach him. */
	onBite: (x: number, y: number, z: number) => void;
	perch: Axial;
	/** For its starting energy, so it is not in lockstep with you from turn one. */
	random?: Random;
}

export interface BatOptions extends Omit<ActorOptions, 'x' | 'y' | 'z'> {
	/** The hexagon it sleeps on. */
	cell: Axial;
	speed?: number;
}

interface InFlight {
	readonly kind: BatActionKind;
	readonly seconds: number;
	clock: number;
	readonly from: Tile;
	readonly to: Tile;
	readonly cell: Axial;
	readonly target: Axial | null;
	done: boolean;
}

export class BatHunt extends Actor implements TurnTaker {
	readonly name = 'bat';
	readonly speed: number;
	energy: number;

	state: HuntState = 'asleep';
	message = 'asleep';
	cell: Axial;
	/** The route it is following, kept for the overlay rather than for flying. */
	path: Axial[] | null = null;

	private readonly deps: BatDeps;
	private flight: InFlight | null = null;
	private struck = false;

	/** 0 folded, 1 flying. */
	private wake = 0;
	private flap = 0;
	/** 0 to 1 across a bite. */
	private lunge = 0;
	private lungeBlend = 0;
	private lean = 0;
	bites = 0;
	missed = 0;

	// Pose buffers, allocated once.
	private readonly flyBuf: SparsePose = {};
	private readonly perchBuf: SparsePose = {};
	private readonly lungeBuf: SparsePose = {};

	constructor(options: BatOptions, deps: BatDeps) {
		const tile = deps.world.tileAt(options.cell.q, options.cell.r);
		if (!tile) throw new Error(`the bat cannot perch on ${options.cell.q},${options.cell.r}`);
		super({
			skeleton: options.skeleton,
			model: options.model,
			skeletonView: options.skeletonView,
			x: tile.x,
			z: tile.z,
			y: tile.top,
			...(options.yaw !== undefined ? { yaw: options.yaw } : {}),
		});
		this.deps = deps;
		this.cell = { q: options.cell.q, r: options.cell.r };
		this.speed = options.speed ?? BAT_SPEED;
		// Angband's `randint0(50)`: a monster starts part-way to its first move,
		// so a pack does not step in unison.
		this.energy = Math.floor((deps.random?.() ?? 0) * 50);
	}

	/** Where its body actually is, which is what the sword has to reach. */
	get bodyY(): number {
		return this.y + HOVER_Y;
	}

	get busy(): boolean {
		return this.flight !== null;
	}

	tilesToPlayer(): number {
		return axialDistance(this.cell, this.deps.playerCell());
	}

	/**
	 * The same ground asked the other way: a terrace is a step to him and a
	 * flap to it, and neither may enter the cell the other is in.
	 */
	private readonly flyable = (cell: Axial, from: Axial | null): boolean => {
		const player = this.deps.playerCell();
		if (cell.q === player.q && cell.r === player.r) return false;
		return this.deps.world.passable(cell, from, BAT_CLIMB);
	};

	/**
	 * Hit. It loses its next move to being thrown about, which is what a blow
	 * costs on a turn clock — there is no knockback in metres to apply and
	 * nothing to interrupt, because it was not in the middle of anything.
	 */
	reel(): void {
		this.struck = true;
		this.path = null;
		this.wake = 1;
		this.lunge = 0;
		this.lungeBlend = 0;
	}

	/* --------------------------------------------------------------- its turn -- */

	beginTurn(): Action {
		const player = this.deps.playerCell();
		const range = axialDistance(this.cell, player);

		if (this.struck) {
			this.struck = false;
			this.state = 'hunting';
			return this.start('reel', 'hit', this.tile(), this.cell, null);
		}

		if (this.state === 'asleep') {
			// It hears you coming. Three tiles, measured on the grid it lives on.
			if (range > WAKE_RANGE) return this.pass('asleep');
			this.state = 'hunting';
			return this.start('wake', 'waking', this.tile(), this.cell, null);
		}

		if (this.state === 'hunting') {
			if (range > LOSE_RANGE) {
				this.state = 'returning';
				return this.fly(this.deps.perch, 'losing you');
			}
			// It attacks from the hexagon it is on, so the condition is about
			// the grid and nothing else: next to him, and it is its turn.
			if (range <= 1) return this.start('bite', 'biting', this.tile(), this.cell, player);
			return this.fly(this.approach(player) ?? player, 'hunting');
		}

		// Returning.
		if (range <= WAKE_RANGE) {
			this.state = 'hunting';
			return this.fly(this.approach(player) ?? player, 'hunting');
		}
		if (this.cell.q === this.deps.perch.q && this.cell.r === this.deps.perch.r) {
			this.state = 'asleep';
			this.path = null;
			return this.start('settle', 'settling', this.tile(), this.cell, null);
		}
		return this.fly(this.deps.perch, 'going home');
	}

	/**
	 * Path to a tile beside the man, not onto him: the grid is for getting
	 * there, the last hexagon is the bite's business.
	 */
	private approach(goal: Axial): Axial | null {
		let best: Axial | null = null;
		let bestScore = Infinity;
		for (const n of axialNeighbours(goal)) {
			if (!this.flyable(n, null)) continue;
			const d = axialDistance(this.cell, n);
			if (d < bestScore) {
				bestScore = d;
				best = n;
			}
		}
		return best;
	}

	/** One hexagon towards a goal, re-pathed every turn because the quarry moves. */
	private fly(goal: Axial, message: string): Action {
		const route = findPath(this.cell, goal, { passable: this.flyable });
		this.path = route && route.length > 1 ? route.slice(1) : null;
		const step = this.path?.[0];
		if (!step) return this.pass(message === 'hunting' ? 'cornered' : message);
		const tile = this.deps.world.tileAt(step.q, step.r);
		if (!tile) return this.pass(message);
		return this.start('move', message, tile, step, null);
	}

	private start(
		kind: BatActionKind,
		message: string,
		to: Tile,
		cell: Axial,
		target: Axial | null,
	): Action {
		const seconds = actionSeconds(ACTION_ENERGY, this.speed);
		this.flight = {
			kind,
			seconds,
			clock: 0,
			from: this.tile(),
			to,
			cell: { q: cell.q, r: cell.r },
			target: target ? { q: target.q, r: target.r } : null,
			done: false,
		};
		this.message = message;
		if (kind === 'bite') this.lunge = 0;
		return { kind, cost: ACTION_ENERGY, seconds };
	}

	/**
	 * A turn with nothing to watch — asleep, or hemmed in. It still costs a
	 * full action, because an Angband monster that cannot act spends its turn
	 * doing nothing rather than banking the energy; but it takes no time on
	 * screen, or a sleeping bat would hold the whole world up.
	 */
	private pass(message: string): Action {
		this.message = message;
		return { kind: 'wait', cost: ACTION_ENERGY, seconds: 0 };
	}

	private tile(): Tile {
		return this.deps.world.tileAt(this.cell.q, this.cell.r)!;
	}

	/* ------------------------------------------------------------ the drawing -- */

	update(dt: number, time: number): void {
		const player = this.deps.playerPosition();
		const flight = this.flight;
		let flapAmp = 1;
		let speed = 0;

		if (flight) {
			flight.clock += dt;
			const u = flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;

			switch (flight.kind) {
				case 'move': {
					this.x = flight.from.x + (flight.to.x - flight.from.x) * u;
					this.z = flight.from.z + (flight.to.z - flight.from.z) * u;
					speed = HEX_SPACING / flight.seconds;
					const ahead = Math.atan2(flight.to.x - flight.from.x, flight.to.z - flight.from.z);
					this.yaw += clamp(wrapAngle(ahead - this.yaw), -6 * dt, 6 * dt);
					break;
				}
				case 'bite': {
					// Rooted to its cell. The only movement is turning to face
					// him and the lunge itself.
					turnTowards(this, player.x, player.z, dt, 6);
					this.lunge = u;
					this.lungeBlend = Math.min(1, this.lungeBlend + dt * 7);
					flapAmp = 0.5;
					if (!flight.done && u >= LUNGE_CONTACT) {
						flight.done = true;
						this.landBite(flight.target);
					}
					break;
				}
				case 'reel':
					flapAmp = 1.45; // thrashing, not cruising
					turnTowards(this, player.x, player.z, dt, 1.6);
					this.lungeBlend = Math.max(0, this.lungeBlend - dt * 5);
					break;
				case 'wake':
					turnTowards(this, player.x, player.z, dt, 2.4);
					break;
				case 'settle':
					flapAmp = 0.4;
					break;
				default:
					break;
			}

			if (flight.clock >= flight.seconds) {
				this.cell = flight.cell;
				const settled = this.tile();
				if (flight.kind === 'move') {
					this.x = settled.x;
					this.z = settled.z;
				}
				this.flight = null;
				if (flight.kind === 'bite') {
					this.lunge = 0;
					this.message = 'backing off';
				}
			}
		}

		if (this.flight?.kind !== 'bite') {
			this.lungeBlend = Math.max(0, this.lungeBlend - dt * 5);
		}

		/*
		 * The lean into the bite: what the lunge cannot reach across a
		 * hexagon, out and back. The bat's copy of `LEAN_IN`.
		 */
		const biting = this.flight?.kind === 'bite';
		const wantLean = biting ? BAT_LEAN * Math.sin(Math.PI * this.lunge) : 0;
		this.lean += (wantLean - this.lean) * Math.min(1, dt * 12);

		/*
		 * Height and wings run on the wall clock, not on the turn clock, and
		 * that is deliberate: a bat's wings beat whether or not it is its move,
		 * and freezing them between turns would make the world look paused
		 * rather than waiting.
		 */
		// The state is set before the wake or settle action starts, so this one
		// line covers both ramps and the two steady values.
		this.wake += ((this.state === 'asleep' ? 0 : 1) - this.wake) * Math.min(1, dt * 2.2);
		const under = this.deps.world.groundAt(this.x, this.z) + HOVER_LIFT * this.wake;
		this.y += (under - this.y) * Math.min(1, dt * 6);

		const cruise = HEX_SPACING / actionSeconds(ACTION_ENERGY, this.speed);
		this.flap += (TAU / FLAP_PERIOD) * (0.55 + 0.55 * Math.min(1, speed / cruise)) * dt;
		if (this.flap > TAU) this.flap -= TAU;
		const amp = flapAmp * Math.max(0.35, Math.min(1, 0.45 + speed / cruise));

		if (this.wake >= 0.999) {
			flyPose(this.flap, amp, time, this.pose);
		} else if (this.wake <= 0.001) {
			perchPose(time, this.pose);
		} else {
			const u = this.wake * this.wake * (3 - 2 * this.wake);
			mixSparse(this.pose, perchPose(time, this.perchBuf), flyPose(this.flap, amp, time, this.flyBuf), u);
		}

		// The strike is laid over whatever it was doing, and taken off again.
		if (this.lungeBlend > 0.001) {
			mixSparse(this.pose, this.pose, lungePose(this.lunge, this.lungeBuf), this.lungeBlend);
		}

		if (this.lean > 1e-4) {
			const root = (this.pose.root ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[2]! += this.lean;
		}
	}

	/**
	 * The moment the jaws arrive.
	 *
	 * As with the sword: on the grid the answer is whether he is on the hexagon
	 * it aimed at, and nothing could have moved since. The jaw tip is still
	 * asked where it got to, because that is what `BAT_LEAN` is built from and
	 * a lunge that stopped reaching should say so.
	 */
	private landBite(target: Axial | null): void {
		const player = this.deps.playerCell();
		if (!target || player.q !== target.q || player.r !== target.r) {
			this.missed++;
			this.message = 'bit at nothing';
			return;
		}
		const jaws = attachmentPosition(BAT_SKELETON, this.pose, 'jaw', JAW_TIP);
		const w = this.toWorldXZ(jaws[0], jaws[2]);
		const at = this.deps.playerPosition();
		if (Math.hypot(w.x - at.x, w.z - at.z) > HEX_SPACING * 0.75) {
			this.missed++;
			this.message = 'the lunge fell short';
			return;
		}
		this.bites++;
		this.message = 'bit you';
		this.deps.onBite(w.x, this.y + jaws[1], w.z);
	}
}
