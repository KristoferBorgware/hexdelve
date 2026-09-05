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
 * different reason: see `leanIn`.
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
	type Clip,
	type ClipEvent,
	type DensePose,
	type GameObject,
	type Skeleton,
	type SparsePose,
} from '@hexdelve/engine';
import { HEX_SPACING, type Axial } from '@hexdelve/shared';

import type { ScriptHost } from '@hexdelve/engine';

import {
	ActorBehaviour,
	clamp,
	NOWHERE,
	topple,
	wrapAngle,
	type Opponent,
} from './actor.js';
import { Swing } from './events.js';
import { playerOrders, type PlayerOrders } from './orders.js';

import type { Item } from './items.js';
import { actionSeconds, hexSpeed } from './pace.js';

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

/** What one of his cuts takes off. The rules read it; he only announces it. */
const BLOW_DAMAGE = 5;

/** Face down and a quarter turn over, which is a man falling rather than a plank. */
const FALL_PITCH = 1.45;
const FALL_ROLL = 0.35;

/** How much of his hip height he loses on the way down. */
const FALL_SETTLE = 0.78;

/**
 * How fast he comes round to the hexagon he is stepping into. Fast, because a
 * step and the turn into it are one movement — he is not aiming at anything
 * any more, so there is nothing for a slow turn to express.
 */
const TURN_RATE = 11;

/** Where in the stoop the thing actually leaves the ground, as a fraction of it. */
const STOOP_GRAB = 0.42;
/**
 * Where in the cut the blade arrives, as a fraction of it.
 *
 * Read off the clip's own `cut` event rather than typed beside it, so
 * re-timing the strike in slash.clip.yaml moves the moment the hit lands.
 */
function swingLand(slash: Clip): number {
	const cut = slash.events.find((event: ClipEvent) => event.name === 'cut');
	if (!cut) throw new Error(`the slash clip has no 'cut' event to land on`);
	return cut.t / slash.duration;
}

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

/** How far a cut reaches, and between which two bearings it passes. */
export interface Reach {
	readonly distance: number;
	readonly height: number;
	readonly from: number;
	readonly to: number;
}

/**
 * How far he can cut, measured off the clip rather than typed in.
 *
 * The blade is sampled right through the strike, not at the contact key alone,
 * because a cut sweeps: what comes back is how far it reaches and between
 * which two bearings it passes. The follow-through behind his shoulder is
 * thrown away, since a sword finishing its arc back there is not cutting
 * anything he is fighting.
 *
 * A function of the rig, the clip and the blade rather than a constant, now
 * that all three come out of files: the reach of a man is a fact about the
 * particular man, and a second body on the same rig with a longer sword has a
 * different one. It is measured once, when he is built.
 */
export function measureReach(
	skeleton: Skeleton,
	slash: Clip,
	swordTip: readonly number[],
): Reach {
	let distance = 0;
	let height = 0;
	let from = Infinity;
	let to = -Infinity;
	for (let t = 0.34; t <= 0.58; t += 0.02) {
		const tip = attachmentPosition(skeleton, samplePose(slash, t) as SparsePose, 'handR', swordTip);
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
}

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
export function leanIn(reach: Reach): number {
	return Math.max(0, HEX_SPACING - reach.distance);
}

/** Where the world is placed comes from the grid, so x, y and z are not given. */
export interface PlayerOptions {
	/** The ground he stands on and paths across. */
	world: World;
	/** The gear lying about, which he may stoop for and wear. */
	items: Item[];
	/**
	 * Where he announces a blow, if anything is listening.
	 *
	 * A swing does not resolve itself here any more. He says a blade went
	 * through a piece of the world, with the reach and the arc he measured off
	 * the clip, and the `Combat` script works out what was in it — so what a
	 * blow does is a script somebody can edit and reload, and what a blow LOOKS
	 * like stays where the animation is. Absent on a bench, where there is
	 * nothing to hit.
	 */
	scripts?: ScriptHost;
	/** Which way he faces to start. */
	yaw?: number;
	/** The hexagon he starts on. */
	cell: Axial;
	/** Angband-style, offset by 110. Normal unless something hastes him. */
	speed?: number;
	/** Where the blade's point sits in the hand bone's space, off the sword's mesh. */
	swordTip: readonly [number, number, number];
}

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

export class Player extends ActorBehaviour implements TurnTaker {
	readonly name = 'you';
	readonly speed: number;
	energy = ACTION_ENERGY;

	/** The hexagon he is on. Authoritative — x and z are drawn from it. */
	cell: Axial;

	/** The ground he stands on and paths across. Read by his orders. */
	readonly ground: World;
	/** Where his hips rest, which is how far there is to fall. */
	private readonly hipHeight: number;
	/** The gear lying about, which he may stoop for and wear. Read by his orders. */
	readonly items: Item[];
	private readonly scripts: ScriptHost | null;
	/**
	 * The other creature, for what he may not walk through and what he aims at.
	 *
	 * Set after both are spawned, because each needs the other and one has to be
	 * built first. Null on a bench.
	 */
	opponent: Opponent | null = null;
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
	private readonly GUARD_SHIELD: Float32Array;
	private readonly GUARD_SWORD: Float32Array;
	private readonly ROOT_ONLY: Float32Array;
	private readonly UPPER: Float32Array;

	/** His bone names, in rig order — what every dense pose here is indexed by. */
	private readonly bones: readonly string[];
	private readonly clips: { readonly duck: Clip; readonly slash: Clip; readonly guard: Clip };

	/** How far this man's cut reaches, measured off his own clip and blade. */
	readonly reach: Reach;
	/** The shortfall between that and the grid, closed by leaning into the blow. */
	readonly leanIn: number;
	private readonly swingLand: number;

	private guardWeight = 0;
	private stoopBlend = 0;
	private swingBlend = 0;
	readonly swing = { cuts: 0, hits: 0, missed: 0 };
	readonly control = { state: 'idle' as PlayerActionKind | 'idle', message: 'waiting' };

	constructor(object: GameObject, options: PlayerOptions) {
		super(object);
		const tile = options.world.tileAt(options.cell.q, options.cell.r);
		if (!tile) throw new Error(`the player cannot start on ${options.cell.q},${options.cell.r}`);
		this.place(tile.x, tile.top, tile.z, options.yaw ?? 0);
		this.ground = options.world;
		this.items = options.items;
		this.scripts = options.scripts ?? null;
		this.cell = { q: options.cell.q, r: options.cell.r };
		this.speed = options.speed ?? NORMAL_SPEED;
		this.stride = strideFor(hexSpeed(this.speed));

		/*
		 * The rig and the clips are the object's own, off the components beside
		 * this one rather than passed in: a man's slash is the slash his entity
		 * file gave him, and a second way of saying which is a second way of
		 * being wrong about it.
		 */
		const rig = this.rig.asset;
		this.bones = rig.bones;
		this.clips = {
			duck: this.animator.clip('duck'),
			slash: this.animator.clip('slash'),
			guard: this.animator.clip('guard'),
		};
		// How far there is to slump, off his own rig rather than a number here.
		this.hipHeight = rig.metrics.hipHeight ?? 0.9;

		/*
		 * The guard masks. The shield arm holds it out whatever his legs are
		 * doing, the sword side eases off as he speeds up so a run gets some
		 * counter-swing back, and the bladed stance at the root is only for a
		 * man standing still. The upper-body one is the rig's own, because a
		 * mask is a fact about a skeleton and belongs in the file that has one.
		 */
		this.GUARD_SHIELD = makeMask(this.bones, { armL: 1, forearmL: 1, handL: 1 }, 0);
		this.GUARD_SWORD = makeMask(
			this.bones,
			{ armR: 1, forearmR: 1, handR: 1, spine: 0.45, chest: 1, neck: 1, head: 1 },
			0,
		);
		this.ROOT_ONLY = makeMask(this.bones, { root: 1 }, 0);
		this.UPPER = makeMask(this.bones, rig.masks.upperBody ?? {}, 0);

		this.basePose = createPose(this.bones.length);
		this.guardPose = createPose(this.bones.length);
		this.stancePose = createPose(this.bones.length);
		this.overlayPose = createPose(this.bones.length);
		this.playerPose = createPose(this.bones.length);

		this.duckClip = bindClip(this.clips.duck, rig.index);
		this.slashClip = bindClip(this.clips.slash, rig.index);
		this.guardClip = bindClip(this.clips.guard, rig.index);

		this.reach = measureReach(rig.skeleton, this.clips.slash, options.swordTip);
		this.leanIn = leanIn(this.reach);
		this.swingLand = swingLand(this.clips.slash);
	}

	get armed(): boolean {
		return this.items.some((i) => i.name === 'sword' && i.worn);
	}

	private get shielded(): boolean {
		return this.items.some((i) => i.name === 'shield' && i.worn);
	}

	get busy(): boolean {
		return this.flight !== null;
	}

	/**
	 * What he has been asked to do.
	 *
	 * A script on his own object — see `orders.ts` for why the interface is
	 * declared here and the class is not. Looked up each time rather than kept:
	 * a hot reload replaces the instance, and a reference taken once would name
	 * the version it replaced.
	 */
	get orders(): PlayerOrders | null {
		return playerOrders(this.object);
	}

	/* --------------------------------------------------------------- the turn -- */

	/**
	 * One turn: start what his orders decided on, and say what it cost.
	 *
	 * Nothing here decides anything. Which of the four this turn is belongs to
	 * `PlayerInput`, which knows the grid, the route and what is lying about;
	 * this knows how long each takes and what it looks like. Nothing here
	 * animates and nothing here waits — by the time this returns, the action is
	 * running and the schedule has been paid.
	 */
	beginTurn(): Action {
		const decision = this.orders?.decide() ?? { kind: 'wait' as const, message: 'waiting' };
		switch (decision.kind) {
			case 'strike':
				return this.startStrike(decision.target);
			case 'pickup':
				return this.startPickup(decision.item);
			case 'move':
				return this.startStep(decision.to);
			case 'wait':
				return this.startWait(decision.message);
		}
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
		return { kind, cost: ACTION_ENERGY, seconds };
	}

	private startStep(to: Axial): Action {
		const tile = this.ground.tileAt(to.q, to.r)!;
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
		return this.begin('pickup', `picking up the ${item.name}`, this.tile(), this.cell, null, item);
	}

	private startWait(message: string): Action {
		const action = this.begin('wait', message, this.tile(), this.cell, null, null);
		// Nothing to watch, so it is over the moment it began — otherwise a man
		// standing still would hold the whole world up for a second a turn.
		this.flight = null;
		this.control.state = 'idle';
		return { ...action, seconds: 0 };
	}

	/** The tile he is standing on. */
	tile(): Tile {
		return this.ground.tileAt(this.cell.q, this.cell.r)!;
	}

	/* ------------------------------------------------------------ the drawing -- */

	/**
	 * Draw whatever he is doing at this instant.
	 *
	 * Named apart from the component hook on purpose: this is the ANIMATION
	 * step and it needs the simulation's own clock, where a component's
	 * `update` gets a frame's delta and nothing else. The rules advanced in
	 * `resolveTurns` before this ran; what happens here is the picture of them.
	 */
	advance(dt: number, elapsed: number): void {
		this.advanceFall(dt);
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
				const spot = this.ground.tileAt(flight.target.q, flight.target.r);
				if (spot) this.faceTowards(spot.x, spot.z, dt);
				if (!flight.done && u >= this.swingLand) {
					flight.done = true;
					this.landBlow(flight.target);
				}
			} else if (flight.kind === 'pickup' && flight.item) {
				if (!flight.done && u >= STOOP_GRAB) {
					flight.done = true;
					// The whole of picking it up: it becomes part of him.
					flight.item.equip(this.object);
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
	 * He no longer works out what he hit. He says a blade went through a piece
	 * of the world — from where, facing which way, reaching how far and sweeping
	 * which arc — and the `Combat` script answers the question, because what a
	 * blow DOES is a rule somebody should be able to edit and reload and what a
	 * blow LOOKS like is this file's.
	 *
	 * The geometry travels with the announcement rather than being looked up at
	 * the other end, and that is the important part: the reach and the arc are
	 * measured off the clip as it plays, so a rule carrying its own numbers
	 * would disagree with the picture and the disagreement would be invisible.
	 *
	 * The one test kept here is whether the thing he aimed at is still on the
	 * hexagon he committed to. That is not combat — it is whether the order he
	 * gave still means anything — and on the grid nothing can have moved since,
	 * so it is a question with a certain answer.
	 */
	private landBlow(target: Axial): void {
		const enemy = this.opponent?.cell ?? NOWHERE;
		if (enemy.q !== target.q || enemy.r !== target.r) {
			this.reportBlow(false, 'cut air');
			return;
		}

		this.scripts?.emit(Swing, {
			by: this.object.name,
			at: { x: this.x, y: this.y, z: this.z },
			facing: this.yaw,
			reach: {
				from: this.reach.from,
				to: this.reach.to,
				// What `leanIn` bought him is reach, so it belongs in the number
				// the rule is given rather than in a correction the rule makes.
				distance: this.reach.distance + this.leanIn,
				height: this.reach.height,
			},
			amount: BLOW_DAMAGE,
		});
	}

	/**
	 * What came of a blow, for the readout.
	 *
	 * Called by whoever is listening to the events the swing set off, because
	 * the answer arrives after the announcement rather than with it. The tally
	 * and the message are his; the rule that produced them is not.
	 */
	reportBlow(hit: boolean, message: string): void {
		if (hit) this.swing.hits++;
		else this.swing.missed++;
		this.control.message = message;
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
				? this.leanIn * Math.sin(PI * Math.min(1, flight.clock / flight.seconds))
				: 0;
		this.lean += (wantLean - this.lean) * Math.min(1, dt * 12);
		if (this.lean > 1e-4) this.strideBuf.root!.pos![2]! += this.lean;

		sparseToDense(this.bones, this.strideBuf, this.basePose);

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
			sampleBound(this.duckClip, phase * this.clips.duck.duration, this.overlayPose);
			lerpPose(this.playerPose, base, this.overlayPose, this.stoopBlend);
		} else if (this.swingBlend > 0.002) {
			sampleBound(this.slashClip, phase * this.clips.slash.duration, this.overlayPose);
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

		denseToSparse(this.bones, this.playerPose, this.pose);

		/*
		 * And then, if he is going down, he goes down out of whatever that was.
		 *
		 * Forward and a little to the side rather than straight back, which is
		 * what a man does when his legs stop rather than what a plank does. The
		 * drop is most of a hip height, so he comes to rest on the grass instead
		 * of lying in the air where his hips used to be.
		 */
		if (this.falling) {
			const t = this.fall;
			topple(this.pose, FALL_PITCH * t, FALL_ROLL * t, this.hipHeight * FALL_SETTLE * t);
		}
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
		const world0 = solveWorld(this.skeleton, pose);
		const targets: Record<string, { x: number; y: number; z: number; weight: number }> = {};
		let pelvisDrop = 0;

		for (const side of ['L', 'R'] as const) {
			const bone = `foot${side}`;
			const p = world0[bone]!.p;
			const w = this.toWorldXZ(p[0], p[2]);
			const groundY = this.ground.groundAt(w.x, w.z);
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

		const world2 = solveWorld(this.skeleton, pose);
		for (const side of ['L', 'R'] as const) {
			const t = targets[`foot${side}`]!;
			if (t.weight <= 0.02) continue;
			solveTwoBone(
				this.skeleton,
				pose,
				{ root: `hip${side}`, mid: `shin${side}`, end: `foot${side}` },
				[t.x, t.y, t.z],
				world2[`shin${side}`]!.p,
				t.weight,
				world2,
			);
			levelBone(this.skeleton, pose, `foot${side}`, t.weight);
		}
	}

	get stats(): PlayerStats {
		const tile = this.ground.tileAt(this.cell.q, this.cell.r);
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
			carrying: this.items.filter((i) => i.worn).map((i) => i.name),
			cell: this.cell,
			terrace: tile?.level ?? null,
			stepsLeft: this.orders?.path.length ?? 0,
			energy: this.energy,
			speedRating: this.speed,
		};
	}
}
