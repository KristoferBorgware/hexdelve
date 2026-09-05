/*
 * The man's body: one turn of his, carried out and drawn.
 *
 * He stands on a hexagon and moves one hexagon per turn, so facing and travel
 * are one number and the interesting question is "who acts next" rather than
 * "which way is he going". What that buys is worth naming, because it is most
 * of why the grid is here:
 *
 *   nothing is ever between two cells        so "can I stand there" and "am I
 *                                            standing there" are the same test,
 *                                            and no body radius is needed to
 *                                            keep him out of a wall
 *   nothing acts while he is acting          so a blow cannot be thrown at a
 *                                            thing that moves out of the way
 *                                            mid-swing
 *   the world stands still while he thinks   the clock only turns when he has
 *                                            asked for something
 *
 * What it costs is the whiff: adjacency is the whole of reach, so a blow at the
 * next hexagon lands. That is not a shortcut — it is what melee on a grid means.
 *
 * ## Three components, and this is the middle one
 *
 * What to do with a turn is `PlayerInput`, a script — see `orders.ts`. What any
 * of it LOOKS like is `HumanoidAnimator` and `FootIK`. This is what is left in
 * between: how long an action takes, where he is part-way through it, which way
 * he is coming round, and the announcement that a blade went through a piece of
 * the world.
 *
 * So the drive it hands the animator is eight numbers — how big the stride is,
 * how far through the cut he is, whether he is holding anything — and not a
 * pose. He decides he is cutting; something else decides what cutting looks
 * like.
 *
 * The reach is measured off the clip rather than typed in, because it is a fact
 * about this particular man with this particular blade: see `leanIn`.
 */

import {
	attachmentPosition,
	FootIK,
	samplePose,
	type Clip,
	type ClipEvent,
	type GameObject,
	type Skeleton,
	type SparsePose,
} from '@hexdelve/engine';
import { HEX_SPACING, type Axial } from '@hexdelve/shared';

import type { ScriptHost } from '@hexdelve/engine';

import { ActorBehaviour, clamp, NOWHERE, wrapAngle, type Opponent } from './actor.js';
import { Swing } from './events.js';
import { HumanoidAnimator } from './humanoidanimator.js';
import { playerOrders, type PlayerOrders } from './orders.js';

import type { Item } from './items.js';
import { actionSeconds, hexSpeed } from './pace.js';

import { stridePeriod, strideFor, type StrideSetting } from './stride.js';
import { ACTION_ENERGY, NORMAL_SPEED, type Action, type TurnTaker } from './turns.js';
import type { Tile, World } from '../scene/world.js';

const PI = Math.PI;
const TAU = PI * 2;

/** Terraces he can step up or down in one move. */
export const MAX_CLIMB = 1;

/** What one of his cuts takes off. The rules read it; he only announces it. */
const BLOW_DAMAGE = 5;

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

	/** How far this man's cut reaches, measured off his own clip and blade. */
	readonly reach: Reach;
	/** The shortfall between that and the grid, closed by leaning into the blow. */
	readonly leanIn: number;
	private readonly swingLand: number;

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
		 * What he is drawn with, off the components beside this one rather than
		 * passed in: a man's slash is the slash his entity file gave him, and a
		 * second way of saying which is a second way of being wrong about it.
		 */
		const rig = this.rig.asset;
		this.animation = object.addComponent(HumanoidAnimator);
		/*
		 * And the terraces under his feet. The solve is the engine's and knows
		 * nothing about a hexagon; what the ground IS is this world's, so it is
		 * wired in here rather than named in a file that cannot know it.
		 */
		const footIK = object.getComponent(FootIK);
		if (footIK) footIK.groundAt = (x, z) => this.ground.groundAt(x, z);

		const slash = this.animation.clip.slash;
		this.reach = measureReach(rig.skeleton, slash, options.swordTip);
		this.leanIn = leanIn(this.reach);
		this.swingLand = swingLand(slash);
	}

	get armed(): boolean {
		return this.items.some((i) => i.name === 'sword' && i.worn);
	}

	get shielded(): boolean {
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

	/** What turns the numbers below into a pose. Required: he has to be drawn. */
	readonly animation: HumanoidAnimator;



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

	/**
	 * Hand this frame's drive to the animator and let it build the pose.
	 *
	 * Everything below is a NUMBER describing what he is doing, not a pose: how
	 * big the stride is, how far through the cut he is, whether he is holding
	 * anything. What that looks like is `HumanoidAnimator`, which is why this is
	 * eight assignments rather than five pose buffers.
	 */
	private buildPose(dt: number, elapsed: number): void {
		const animation = this.animation;
		const flight = this.flight;

		animation.amp = this.amp;
		animation.gait = this.gait;
		animation.theta = this.theta;
		animation.yawRate = this.yawRate;
		animation.reachIn = this.leanIn;
		animation.armed = this.armed;
		animation.shielded = this.shielded;
		animation.overlay =
			flight?.kind === 'pickup' ? 'stoop' : flight?.kind === 'strike' ? 'swing' : 'none';
		animation.overlayDone = flight?.done ?? false;
		animation.phase = flight && flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;
		animation.fall = this.fall;

		animation.build(dt, elapsed);
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
