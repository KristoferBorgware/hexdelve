/*
 * The man, back on the grid.
 *
 * Lab 09 took him off it: the keys gave a heading, the mouse gave a facing,
 * and the two were different numbers travelling in real time. This is the
 * other side of that experiment. He stands on a hexagon, you click a hexagon,
 * and he walks there one hexagon per turn — so facing and travel are one
 * number again, and the interesting question moves from "which way is he
 * going" to "who acts next".
 *
 * What that buys is worth naming, because it is most of why the grid is back:
 *
 *   nothing is ever between two cells        so "can I stand there" and "am I
 *                                           standing there" are the same test,
 *                                           and no body radius is needed to
 *                                           keep him out of a wall
 *   nothing acts while he is acting          so a blow cannot be thrown at a
 *                                           thing that moves out of the way
 *                                           mid-swing
 *   the world stands still while he thinks   the clock only turns when he has
 *                                           asked for something
 *
 * What it costs is the whiff. In lab 09 a cut thrown at where the bat *was*
 * missed, because nothing aimed for you; here adjacency is the whole of reach,
 * and a blow at the next hexagon lands. That is not a shortcut — it is what
 * melee on a grid means — but it is a thing the lab had and this does not.
 *
 * The reach is still measured off the clip, and now it is measured for a
 * different reason: see `LEAN_IN`.
 */

import {
	attachmentPosition,
	bindClip,
	createPose,
	denseToSparse,
	lerpPose,
	lerpPoseMasked,
	levelBone,
	makeMask,
	samplePose,
	sampleBound,
	solveTwoBone,
	solveWorld,
	sparseToDense,
	type BoundClip,
	type DensePose,
	type SparsePose,
} from '@hexdelve/engine';
import {
	axialDistance,
	axialNeighbours,
	findPath,
	HEX_SPACING,
	type Axial,
} from '@hexdelve/shared';

import { Actor, clamp, wrapAngle, type ActorOptions } from './actor.js';
import { DUCK, GUARD, SLASH, SWING_CONTACT } from './clips.js';
import type { Item } from './items.js';
import { actionSeconds, hexSpeed } from './pace.js';
import { BONES, BONE_INDEX, SKELETON, UPPER_BODY } from './skeleton.js';
import { SWORD_TIP } from '../models/props.js';
import { stridePeriod, stridePose, strideFor, type Direction, type StrideSetting } from './stride.js';
import { ACTION_ENERGY, NORMAL_SPEED, type Action, type TurnTaker } from './turns.js';
import type { Tile, World } from '../scene/world.js';

const PI = Math.PI;
const TAU = PI * 2;

const SOLE = 0.12;
/** Terraces he can step up or down in one move. */
export const MAX_CLIMB = 1;

/** On the grid he walks where he faces, so the stride only ever needs one direction. */
const FORWARD: Direction = { x: 0, z: 1 };

/**
 * How fast he comes round to the hexagon he is stepping into. Fast, because a
 * step and the turn into it are one movement — he is not aiming at anything
 * any more, so there is nothing for a slow turn to express.
 */
const TURN_RATE = 11;

/** Where in the stoop the thing actually leaves the ground, as a fraction of it. */
const STOOP_GRAB = 0.42;
/** Where in the cut the blade arrives, as a fraction of it. */
const SWING_LAND = SWING_CONTACT / SLASH.duration;

/** A body is not a point, so the cut's arc gets a little either side of it. */
const ARC_PAD = 0.35;

const GUARD_AT_SPEED = 0.65;

export type PlayerActionKind = 'move' | 'strike' | 'pickup' | 'wait';

export interface PlayerStats {
	/** How fast the current action is carrying him, in m/s. */
	speed: number;
	/** Metres per second the calibration could not deliver. Zero below a full run. */
	slip: number;
	amp: number;
	gait: number;
	pelvisDrop: number;
	state: string;
	message: string;
	cuts: number;
	hits: number;
	missed: number;
	carrying: string[];
	cell: Axial;
	terrace: number | null;
	/** Hexagons still to walk, if he is on his way somewhere. */
	stepsLeft: number;
	energy: number;
	speedRating: number;
}

/**
 * How far he can cut, measured off the clip rather than typed in.
 *
 * The blade is sampled right through the strike, not at the contact key alone,
 * because a cut sweeps: what comes back is how far it reaches and between
 * which two bearings it passes. The follow-through behind his shoulder is
 * thrown away, since a sword finishing its arc back there is not cutting
 * anything he is fighting.
 */
export const REACH = (() => {
	let distance = 0;
	let height = 0;
	let from = Infinity;
	let to = -Infinity;
	for (let t = 0.34; t <= 0.58; t += 0.02) {
		const tip = attachmentPosition(SKELETON, samplePose(SLASH, t) as SparsePose, 'handR', SWORD_TIP);
		const bearing = Math.atan2(tip[0], tip[2]);
		if (Math.abs(bearing) > 1.9) continue;
		const d = Math.hypot(tip[0], tip[2]);
		if (d > distance) {
			distance = d;
			height = tip[1];
		}
		from = Math.min(from, bearing);
		to = Math.max(to, bearing);
	}
	return { distance, height, from, to };
})();

/**
 * The shortfall between his reach and the grid, closed by leaning into the blow.
 *
 * This is the problem the README calls "the grid is for navigation, not for
 * reach": tile centres are 1.73 m apart and his arm plus the blade spans about
 * 1.5 m, so a man rooted to a tile centre swings at nothing. Lab 06 solved it
 * by stepping off the grid into a stance derived from the swing. Turn-based
 * melee cannot do that — the hexagon *is* the position, and a fighter halfway
 * between two of them is not on the board — so the difference is taken out of
 * his body instead: the root goes forward by exactly the shortfall at the
 * moment of contact, and comes back.
 *
 * It is a lean, not a step. He never leaves his hexagon, the two numbers it is
 * made of are both measured, and re-timing the swing moves it on its own.
 */
export const LEAN_IN = Math.max(0, HEX_SPACING - REACH.distance);

export interface PlayerDeps {
	world: World;
	/** The hexagon the enemy is on, which he may neither enter nor path through. */
	enemyCell: () => Axial;
	enemyPosition: () => { x: number; y: number; z: number };
	/** Called on the turn a cut connects. */
	onHit: (x: number, y: number, z: number) => void;
	items: Item[];
}

/** Where the world is placed comes from the grid, so x, y and z are not given. */
export interface PlayerOptions extends Omit<ActorOptions, 'x' | 'y' | 'z'> {
	/** The hexagon he starts on. */
	cell: Axial;
	/** Angband-style, offset by 110. Normal unless something hastes him. */
	speed?: number;
}

/** An order standing until it is finished or replaced. */
interface Order {
	readonly goal: Axial;
	/** True when the goal is the enemy and the point of going there is to hit it. */
	readonly attack: boolean;
}

/** The action in flight, and everything needed to draw it. */
interface InFlight {
	readonly kind: PlayerActionKind;
	readonly seconds: number;
	clock: number;
	/** Where the step starts and ends. Equal for anything that is not a move. */
	readonly from: Tile;
	readonly to: Tile;
	/** The hexagon he is on when this finishes. */
	readonly cell: Axial;
	/** The hexagon a cut is aimed at. */
	readonly target: Axial | null;
	readonly item: Item | null;
	done: boolean;
}

export class Player extends Actor implements TurnTaker {
	readonly name = 'you';
	readonly speed: number;
	energy = ACTION_ENERGY;

	/** The hexagon he is on. Authoritative — x and z are drawn from it. */
	cell: Axial;

	/** Hexagons still to walk, nearest first. Never includes the one he is on. */
	path: Axial[] = [];

	private readonly deps: PlayerDeps;
	private order: Order | null = null;
	private holdOnce = false;
	private flight: InFlight | null = null;

	/**
	 * The stride that covers a hexagon in the time his speed allows — solved
	 * once, because his place in the energy table does not change per frame.
	 */
	private readonly stride: StrideSetting;

	private theta = 0;
	amp = 0;
	gait = 0;
	private yawRate = 0;
	private bank = 0;
	/** Forward offset from the lean into a blow, in metres. */
	private lean = 0;

	private readonly strideBuf: SparsePose = {};
	private readonly basePose: DensePose;
	private readonly guardPose: DensePose;
	private readonly stancePose: DensePose;
	private readonly overlayPose: DensePose;
	private readonly playerPose: DensePose;

	private readonly duckClip: BoundClip;
	private readonly slashClip: BoundClip;
	private readonly guardClip: BoundClip;

	/*
	 * The guard masks. The shield arm holds it out whatever his legs are doing,
	 * the sword side eases off as he speeds up so a run gets some counter-swing
	 * back, and the bladed stance at the root is only for a man standing still.
	 */
	private readonly GUARD_SHIELD = makeMask(BONES, { armL: 1, forearmL: 1, handL: 1 }, 0);
	private readonly GUARD_SWORD = makeMask(
		BONES,
		{ armR: 1, forearmR: 1, handR: 1, spine: 0.45, chest: 1, neck: 1, head: 1 },
		0,
	);
	private readonly ROOT_ONLY = makeMask(BONES, { root: 1 }, 0);
	private readonly UPPER = makeMask(BONES, UPPER_BODY, 0);

	private guardWeight = 0;
	private stoopBlend = 0;
	private swingBlend = 0;
	readonly swing = { cuts: 0, hits: 0, missed: 0 };
	readonly control = { state: 'idle' as PlayerActionKind | 'idle', message: 'waiting' };

	constructor(options: PlayerOptions, deps: PlayerDeps) {
		const tile = deps.world.tileAt(options.cell.q, options.cell.r);
		if (!tile) throw new Error(`the player cannot start on ${options.cell.q},${options.cell.r}`);
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
		this.speed = options.speed ?? NORMAL_SPEED;
		this.stride = strideFor(hexSpeed(this.speed));

		this.basePose = createPose(BONES.length);
		this.guardPose = createPose(BONES.length);
		this.stancePose = createPose(BONES.length);
		this.overlayPose = createPose(BONES.length);
		this.playerPose = createPose(BONES.length);

		this.duckClip = bindClip(DUCK, BONE_INDEX);
		this.slashClip = bindClip(SLASH, BONE_INDEX);
		this.guardClip = bindClip(GUARD, BONE_INDEX);
	}

	get armed(): boolean {
		return this.deps.items.some((i) => i.label === 'sword' && i.worn);
	}

	private get shielded(): boolean {
		return this.deps.items.some((i) => i.label === 'shield' && i.worn);
	}

	get busy(): boolean {
		return this.flight !== null;
	}

	/**
	 * Whether the clock should be turning.
	 *
	 * This one getter is what makes the world turn-based rather than merely
	 * hex-based. Nothing anywhere gains energy while it is false, so the bat
	 * mid-hunt is frozen with its wings out until he decides to do something —
	 * and it is a *question about his orders*, not a pause flag, so there is no
	 * state to get out of step with what he is actually doing.
	 */
	get hasOrders(): boolean {
		return this.order !== null || this.holdOnce || this.itemUnderfoot() !== null;
	}

	/**
	 * Where he is headed, for the readout and the route markers.
	 *
	 * A chase reports where the quarry *is*, not the hexagon it was on when you
	 * clicked it — the marker is what he is going for, and by the time he gets
	 * there the bat will have moved twice.
	 */
	get goal(): Axial | null {
		if (!this.order) return null;
		return this.order.attack ? this.deps.enemyCell() : this.order.goal;
	}

	get targetingEnemy(): boolean {
		return this.order?.attack ?? false;
	}

	/* -------------------------------------------------------------- the grid -- */

	/** May he stand on `cell`, having come from `from`? */
	private readonly walkable = (cell: Axial, from: Axial | null): boolean => {
		const enemy = this.deps.enemyCell();
		if (cell.q === enemy.q && cell.r === enemy.r) return false;
		return this.deps.world.passable(cell, from, MAX_CLIMB);
	};

	/** Whether a hexagon can be walked to at all, for the hover marker. */
	reachable(cell: Axial): boolean {
		if (this.walkable(cell, null)) return findPath(this.cell, cell, { passable: this.walkable }) !== null;
		return this.approach(cell) !== null;
	}

	/**
	 * The best hexagon to stand on to deal with something on `cell`.
	 *
	 * Used for the two cases where the click is not a place to walk: the anvil,
	 * which is solid, and the bat, which is occupied. Both come out the same
	 * way — the nearest neighbour he can stand on — which is lab 06's answer to
	 * clicking the anvil, reused rather than re-derived.
	 */
	private approach(cell: Axial): Axial | null {
		let best: Axial | null = null;
		let bestScore = Infinity;
		for (const n of axialNeighbours(cell)) {
			if (!this.walkable(n, null)) continue;
			const score = axialDistance(this.cell, n);
			if (score < bestScore) {
				bestScore = score;
				best = n;
			}
		}
		return best;
	}

	private itemUnderfoot(): Item | null {
		for (const item of this.deps.items) {
			if (item.worn) continue;
			if (item.cell.q === this.cell.q && item.cell.r === this.cell.r) return item;
		}
		return null;
	}

	/** Lay a route to a goal. False if there is no way to it at all. */
	private plan(order: Order): boolean {
		const stand = this.walkable(order.goal, null) && !order.attack
			? order.goal
			: this.approach(order.goal);
		if (!stand) return false;
		if (stand.q === this.cell.q && stand.r === this.cell.r) {
			this.path = [];
			return true;
		}
		const route = findPath(this.cell, stand, { passable: this.walkable });
		if (!route) return false;
		this.path = route.slice(1);
		return true;
	}

	/* ------------------------------------------------------------- the orders -- */

	/**
	 * A click on a hexagon.
	 *
	 * One entry point for every meaning a click has, because on a grid they are
	 * the same request with different endings: walk to that hexagon, walk to
	 * the thing lying on it and stoop, walk up to the bat and cut it. What
	 * decides which is what is standing there, not which mouse button.
	 *
	 * Returns false if there is no route, so the marker can say so rather than
	 * having him set off and stop.
	 */
	orderTo(cell: Axial): boolean {
		const enemy = this.deps.enemyCell();
		const attack = cell.q === enemy.q && cell.r === enemy.r;

		// Clicking where he already stands is how you wait a turn with a mouse.
		if (!attack && cell.q === this.cell.q && cell.r === this.cell.r) {
			this.hold();
			return true;
		}

		const order: Order = { goal: { q: cell.q, r: cell.r }, attack };
		if (attack && axialDistance(this.cell, enemy) <= 1) {
			this.order = order;
			this.path = [];
			this.holdOnce = false;
			return true;
		}
		if (!this.plan(order)) return false;
		this.order = order;
		this.holdOnce = false;
		return true;
	}

	/** Spend one turn doing nothing. */
	hold(): void {
		this.holdOnce = true;
	}

	/** Forget where he was going. */
	cancel(): void {
		this.order = null;
		this.path = [];
		this.holdOnce = false;
	}

	/* --------------------------------------------------------------- the turn -- */

	/**
	 * One turn: decide, start it, and say what it cost.
	 *
	 * The order of the tests is the priority: a blow he is in position to
	 * throw, then a thing under his feet, then the next hexagon of the route.
	 * Nothing here animates and nothing here waits — by the time this returns,
	 * the action is running and the schedule has been paid.
	 */
	beginTurn(): Action {
		const enemy = this.deps.enemyCell();

		if (this.order?.attack && axialDistance(this.cell, enemy) <= 1) {
			return this.startStrike(enemy);
		}

		const item = this.itemUnderfoot();
		if (item) return this.startPickup(item);

		const order = this.order;
		if (order) {
			// The route is re-laid when it is chasing something that moves, and
			// when the next hexagon has become someone else's since it was laid.
			const next = this.path[0];
			if (order.attack || !next || !this.walkable(next, this.cell)) {
				if (!this.plan(order)) {
					this.order = null;
					return this.startWait('there is no way through');
				}
			}
			const step = this.path[0];
			if (step) {
				this.path.shift();
				if (this.path.length === 0 && !order.attack) this.order = null;
				return this.startStep(step);
			}
			/*
			 * Standing where he meant to stand with nothing left to do there.
			 * For a walk that is arrival; for a chase it cannot happen, because
			 * every hexagon `approach` offers is a neighbour of the quarry and
			 * standing on one of those is caught by the strike test above.
			 */
			this.order = null;
			return this.startWait('waiting');
		}

		this.holdOnce = false;
		return this.startWait('waiting');
	}

	private begin(
		kind: PlayerActionKind,
		message: string,
		to: Tile,
		cell: Axial,
		target: Axial | null,
		item: Item | null,
	): Action {
		const from = this.tile();
		const seconds = actionSeconds(ACTION_ENERGY, this.speed);
		this.flight = { kind, seconds, clock: 0, from, to, cell, target, item, done: false };
		this.control.state = kind;
		this.control.message = message;
		this.holdOnce = false;
		return { kind, cost: ACTION_ENERGY, seconds };
	}

	private startStep(to: Axial): Action {
		const tile = this.deps.world.tileAt(to.q, to.r)!;
		return this.begin('move', 'walking', tile, { q: to.q, r: to.r }, null, null);
	}

	private startStrike(target: Axial): Action {
		this.swing.cuts++;
		return this.begin(
			'strike',
			this.armed ? 'cutting' : 'swinging bare-handed',
			this.tile(),
			this.cell,
			{ q: target.q, r: target.r },
			null,
		);
	}

	private startPickup(item: Item): Action {
		return this.begin('pickup', `picking up the ${item.label}`, this.tile(), this.cell, null, item);
	}

	private startWait(message: string): Action {
		const action = this.begin('wait', message, this.tile(), this.cell, null, null);
		// Nothing to watch, so it is over the moment it began — otherwise a man
		// standing still would hold the whole world up for a second a turn.
		this.flight = null;
		this.control.state = 'idle';
		return { ...action, seconds: 0 };
	}

	private tile(): Tile {
		return this.deps.world.tileAt(this.cell.q, this.cell.r)!;
	}

	/* ------------------------------------------------------------ the drawing -- */

	update(dt: number, elapsed: number): void {
		const flight = this.flight;
		let moving = false;

		if (flight) {
			flight.clock += dt;
			const u = flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;

			if (flight.kind === 'move') {
				moving = true;
				/*
				 * A straight line at a constant rate, deliberately: the stride
				 * was solved for exactly this speed, and easing the ends would
				 * put the feet back to sliding at both of them.
				 */
				this.x = flight.from.x + (flight.to.x - flight.from.x) * u;
				this.z = flight.from.z + (flight.to.z - flight.from.z) * u;
				this.y = flight.from.top + (flight.to.top - flight.from.top) * u;
				this.faceTowards(flight.to.x, flight.to.z, dt);
			} else if (flight.kind === 'strike' && flight.target) {
				const spot = this.deps.world.tileAt(flight.target.q, flight.target.r);
				if (spot) this.faceTowards(spot.x, spot.z, dt);
				if (!flight.done && u >= SWING_LAND) {
					flight.done = true;
					this.landBlow(flight.target);
				}
			} else if (flight.kind === 'pickup' && flight.item) {
				if (!flight.done && u >= STOOP_GRAB) {
					flight.done = true;
					// The whole of picking it up.
					flight.item.equip();
				}
			}

			if (flight.clock >= flight.seconds) {
				this.cell = flight.cell;
				const settled = this.tile();
				this.x = settled.x;
				this.z = settled.z;
				this.y = settled.top;
				this.flight = null;
				this.control.state = 'idle';
				this.control.message = this.armed ? 'armed' : 'waiting';
			}
		} else {
			this.yawRate = 0;
		}

		/* --------------------------------------------------------------- gait */
		const wantAmp = moving ? this.stride.amp : 0;
		const wantGait = moving ? this.stride.gait : 0;
		this.amp += (wantAmp - this.amp) * Math.min(1, dt * 14);
		this.gait += (wantGait - this.gait) * Math.min(1, dt * 6);
		if (this.amp > 0.03) {
			this.theta = (this.theta + (TAU / stridePeriod(this.gait)) * dt) % TAU;
		}

		this.buildPose(dt, elapsed);
	}

	private faceTowards(targetX: number, targetZ: number, dt: number): void {
		const want = Math.atan2(targetX - this.x, targetZ - this.z);
		const diff = wrapAngle(want - this.yaw);
		const turn = clamp(diff * TURN_RATE, -TURN_RATE, TURN_RATE);
		this.yaw += turn * dt;
		this.yawRate = turn;
	}

	/**
	 * The moment the blade arrives.
	 *
	 * On the grid this is a much shorter list than it was in lab 09, and the
	 * reason is the point: the thing is either on the hexagon he aimed at or it
	 * is not, and nothing could have moved since he committed. The geometry is
	 * still checked — reach and arc, both measured off the clip — because they
	 * are what `LEAN_IN` is built from, and a swing that stopped reaching
	 * should say so rather than connect anyway.
	 */
	private landBlow(target: Axial): void {
		const enemy = this.deps.enemyCell();
		if (enemy.q !== target.q || enemy.r !== target.r) {
			this.swing.missed++;
			this.control.message = 'cut air';
			return;
		}

		const at = this.deps.enemyPosition();
		const dx = at.x - this.x;
		const dz = at.z - this.z;
		const gap = Math.hypot(dx, dz);
		const off = wrapAngle(Math.atan2(dx, dz) - this.yaw);
		const bladeY = this.y + REACH.height;

		const inArc = off >= REACH.from - ARC_PAD && off <= REACH.to + ARC_PAD;
		if (!inArc || gap > REACH.distance + LEAN_IN + 0.2 || Math.abs(at.y - bladeY) > 1.2) {
			this.swing.missed++;
			this.control.message = 'the blow fell short';
			return;
		}

		this.swing.hits++;
		this.control.message = 'hit it';
		this.deps.onHit(at.x, at.y, at.z);
	}

	private buildPose(dt: number, elapsed: number): void {
		stridePose(this.theta, this.amp, FORWARD, this.gait, elapsed, this.strideBuf);

		// A lean into the turn, which is the one thing the stride cannot know:
		// it is handed a heading, not the fact that the whole man is coming
		// round.
		const wantBank = -clamp(this.yawRate * 0.05, -0.2, 0.2) * this.amp;
		this.bank += (wantBank - this.bank) * Math.min(1, dt * 6);
		this.strideBuf.root!.rot![2]! += this.bank;

		/*
		 * The lean into a blow: the shortfall between his reach and the grid,
		 * out and back across the swing. It goes in as root translation along
		 * his own +Z, which is where he is facing, which is what he is cutting.
		 */
		const flight = this.flight;
		const wantLean =
			flight?.kind === 'strike' && flight.seconds > 0
				? LEAN_IN * Math.sin(PI * Math.min(1, flight.clock / flight.seconds))
				: 0;
		this.lean += (wantLean - this.lean) * Math.min(1, dt * 12);
		if (this.lean > 1e-4) this.strideBuf.root!.pos![2]! += this.lean;

		sparseToDense(BONES, this.strideBuf, this.basePose);

		const stooping = flight?.kind === 'pickup';
		const striking = flight?.kind === 'strike';
		const wantStoop = stooping && !flight.done ? 1 : 0;
		this.stoopBlend += (wantStoop - this.stoopBlend) * Math.min(1, dt * 9);
		const wantSwing = striking ? 1 : 0;
		this.swingBlend += (wantSwing - this.swingBlend) * Math.min(1, dt * 14);

		// The guard, over the top, masked to the arms so the legs keep the gait.
		const carrying = this.armed || this.shielded;
		const wantGuard = carrying && !stooping ? 1 : 0;
		this.guardWeight += (wantGuard - this.guardWeight) * Math.min(1, dt * 4);

		let base = this.basePose;
		if (this.guardWeight > 0.002) {
			sampleBound(this.guardClip, 0, this.guardPose);
			let src = this.basePose;
			if (this.shielded) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight, this.GUARD_SHIELD);
				src = this.stancePose;
			}
			if (this.armed) {
				const hold = 1 - (1 - GUARD_AT_SPEED) * this.amp;
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * hold, this.GUARD_SWORD);
				src = this.stancePose;
			}
			const settled = 1 - this.amp;
			if (settled > 0.01) {
				lerpPoseMasked(this.stancePose, src, this.guardPose, this.guardWeight * settled, this.ROOT_ONLY);
				src = this.stancePose;
			}
			base = src;
		}

		/*
		 * Then the one thing his whole body is doing, if it is doing one.
		 *
		 * Both clips are played *over the action*, not at their authored rate:
		 * the phase is a fraction of the turn rather than a time in seconds. So
		 * a faster creature's cut is a faster cut, by the same table that gives
		 * it the extra turn — and the contact key lands at the same fraction of
		 * the blow however long the blow is.
		 */
		const phase = flight && flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;
		if (this.stoopBlend > 0.002) {
			sampleBound(this.duckClip, phase * DUCK.duration, this.overlayPose);
			lerpPose(this.playerPose, base, this.overlayPose, this.stoopBlend);
		} else if (this.swingBlend > 0.002) {
			sampleBound(this.slashClip, phase * SLASH.duration, this.overlayPose);
			// Standing, the cut gets all of him; mid-stride it gets his arms and
			// leaves the legs to the walk. He cannot do both on the grid, but
			// the mask is what makes that a rule of the game rather than of the
			// animation.
			const mask = this.amp > 0.05 ? this.UPPER : null;
			if (mask) lerpPoseMasked(this.playerPose, base, this.overlayPose, this.swingBlend, mask);
			else lerpPose(this.playerPose, base, this.overlayPose, this.swingBlend);
		} else {
			this.playerPose.rot.set(base.rot);
			this.playerPose.pos.set(base.pos);
		}

		denseToSparse(BONES, this.playerPose, this.pose);
	}

	/**
	 * Plant his feet on the terraces.
	 *
	 * Two passes on purpose. The first asks where the feet want to be and how
	 * far the hips must drop for the lower one to reach; the drop is applied to
	 * the root, and only then is the chain solved — because moving the hips
	 * moves the hips' children, and solving against the pre-drop positions
	 * would leave the leg reaching for where the ground used to be.
	 */
	applyFootIK(): void {
		const pose = this.pose;
		const world0 = solveWorld(SKELETON, pose);
		const targets: Record<string, { x: number; y: number; z: number; weight: number }> = {};
		let pelvisDrop = 0;

		for (const side of ['L', 'R'] as const) {
			const bone = `foot${side}`;
			const p = world0[bone]!.p;
			const w = this.toWorldXZ(p[0], p[2]);
			const groundY = this.deps.world.groundAt(w.x, w.z);
			const desiredY = groundY - this.y + SOLE;
			const above = p[1] - desiredY;
			// Only while it is actually near the ground, so a foot in mid-swing
			// is left to the clip.
			const weight = clamp(1 - above / 0.18, 0, 1);
			targets[bone] = { x: p[0], y: desiredY, z: p[2], weight };
			if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredY - p[1]) * weight);
		}

		this.pelvisDrop = pelvisDrop;
		if (pelvisDrop < -0.0005) {
			const root = (pose.root ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[1]! += pelvisDrop;
		}

		const world2 = solveWorld(SKELETON, pose);
		for (const side of ['L', 'R'] as const) {
			const t = targets[`foot${side}`]!;
			if (t.weight <= 0.02) continue;
			solveTwoBone(
				SKELETON,
				pose,
				{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
				[t.x, t.y, t.z],
				world2[`shin${side}`]!.p,
				t.weight,
				world2,
			);
			levelBone(SKELETON, pose, `foot${side}`, t.weight);
		}
	}

	get stats(): PlayerStats {
		const tile = this.deps.world.tileAt(this.cell.q, this.cell.r);
		return {
			speed: this.flight?.kind === 'move' ? this.stride.speed : 0,
			slip: this.stride.slip,
			amp: this.amp,
			gait: this.gait,
			pelvisDrop: this.pelvisDrop,
			state: this.control.state,
			message: this.control.message,
			cuts: this.swing.cuts,
			hits: this.swing.hits,
			missed: this.swing.missed,
			carrying: this.deps.items.filter((i) => i.worn).map((i) => i.label),
			cell: this.cell,
			terrace: tile?.level ?? null,
			stepsLeft: this.path.length,
			energy: this.energy,
			speedRating: this.speed,
		};
	}
}
