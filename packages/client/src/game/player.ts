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
 * ## Four components, and this is the one in the middle
 *
 * What to do with a turn is `PlayerInput`, a script — see `orders.ts`. What a
 * blow COSTS is `Melee`, another one — see `melee.ts`. What any of it LOOKS
 * like is `HumanoidAnimator` and `FootIK`. This is what is left in between: how
 * long an action takes, where he is part-way through it, which way he is coming
 * round, and where the point of the blade got to at the instant it arrived.
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

import { ActorBehaviour, clamp, wrapAngle } from './actor.js';
import { Acting } from './acting.js';
import { melee, type MeleeStrikes } from './melee.js';
import { HumanoidAnimator } from './humanoidanimator.js';
import { playerOrders, type PlayerOrders } from './orders.js';

import type { Item } from './items.js';
import { actionSeconds, hexSpeed } from './pace.js';

import { ACTION_ENERGY, NORMAL_SPEED, type Action, type TurnTaker } from './turns.js';
import type { TerrainQuery, Tile } from './terrain.js';


/** Terraces he can step up or down in one move. */
export const MAX_CLIMB = 1;

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
	terrain: TerrainQuery;
	/** The gear lying about, which he may stoop for and wear. */
	items: Item[];
	/** Which way he faces to start. */
	yaw?: number;
	/** The hexagon he starts on. */
	cell: Axial;
	/** Angband-style, offset by 110. Normal unless something hastes him. */
	speed?: number;
	/** Where the blade's point sits in the hand bone's space, off the sword's mesh. */
	swordTip: readonly [number, number, number];
}

export class Player extends ActorBehaviour implements TurnTaker {
	readonly name = 'you';
	readonly speed: number;
	energy = ACTION_ENERGY;

	/** The hexagon he is on. Authoritative — x and z are drawn from it. */
	cell: Axial;

	/** The ground he stands on and paths across. Read by his orders. */
	readonly ground: TerrainQuery;
	/** The gear lying about, which he may stoop for and wear. Read by his orders. */
	readonly items: Item[];
	readonly acting: Acting;

	/**
	 * How fast a hexagon in one action works out to — settled once, because his
	 * place in the energy table does not change per frame.
	 */
	private readonly pace: number;

	/** What he is actually travelling at this frame, eased towards `pace`. */
	private travel = 0;
	private yawRate = 0;

	/** How far this man's cut reaches, measured off his own clip and blade. */
	readonly reach: Reach;
	/** The shortfall between that and the grid, closed by leaning into the blow. */
	readonly leanIn: number;
	private readonly swingLand: number;

	override message = 'waiting';
	readonly control = { state: 'idle' as PlayerActionKind | 'idle' };

	constructor(object: GameObject, options: PlayerOptions) {
		super(object);
		const tile = options.terrain.tileAt(options.cell.q, options.cell.r);
		if (!tile) throw new Error(`the player cannot start on ${options.cell.q},${options.cell.r}`);
		this.ground = options.terrain;

		/*
		 * Where he is and what he is in the middle of, which every creature
		 * that takes turns has the same way — see `acting.ts`.
		 */
		this.acting = object.getComponent(Acting) ?? object.addComponent(Acting);
		this.acting.place(options.cell, options.yaw ?? 0);
		this.items = options.items;
		this.cell = { q: options.cell.q, r: options.cell.r };
		this.speed = options.speed ?? NORMAL_SPEED;
		this.pace = hexSpeed(this.speed);

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

	/** What he is stooping for, while he is stooping for it. */
	private carrying: Item | null = null;

	get busy(): boolean {
		return this.acting.busy;
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

	/** What his blows cost and what came of them — a script, see `melee.ts`. */
	get melee(): MeleeStrikes | null {
		return melee(this.object);
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
		const seconds = actionSeconds(ACTION_ENERGY, this.speed);
		this.acting.begin(kind, seconds, to, cell, target);
		this.carrying = item;
		this.control.state = kind;
		this.message = message;
		return { kind, cost: ACTION_ENERGY, seconds };
	}

	private startStep(to: Axial): Action {
		const tile = this.ground.tileAt(to.q, to.r)!;
		return this.begin('move', 'walking', tile, { q: to.q, r: to.r }, null, null);
	}

	private startStrike(target: Axial): Action {
		this.melee?.begin();
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
		this.acting.clear();
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
	 * The rules decide in `beginTurn`; this is the picture of what they decided.
	 * It needs no clock beyond the step, because his gait is carried by the
	 * blend tree's own playhead.
	 */
	protected override animate(dt: number): void {
		this.acting.advance(dt);

		const flight = this.acting.flight;
		let moving = false;

		if (flight) {

			if (flight.kind === 'move') {
				moving = true;
				this.faceTowards(flight.to.x, flight.to.z, dt);
			} else if (flight.kind === 'strike' && flight.target) {
				const spot = this.ground.tileAt(flight.target.q, flight.target.r);
				if (spot) this.faceTowards(spot.x, spot.z, dt);
				if (this.acting.reached(this.swingLand)) this.landBlow(flight.target);
			} else if (flight.kind === 'pickup' && this.carrying) {
				// The whole of picking it up: it becomes part of him.
				if (this.acting.reached(STOOP_GRAB)) this.carrying.equip(this.object);
			}
		} else {
			this.yawRate = 0;
		}

		/*
		 * And it ends here, after he has had his say about the frame: a blow
		 * announced on the instant the cut finishes is still that cut's.
		 */
		const ended = this.acting.settle();
		if (ended) {
			this.cell = this.acting.cell;
			this.carrying = null;
			this.control.state = 'idle';
			this.message = this.armed ? 'armed' : 'waiting';
		}

		/*
		 * The gait, as one number. How fast he is going is a rule — a hexagon in
		 * one action, at whatever his place in the energy table makes that — and
		 * the tree underneath turns it into legs. Eased rather than stepped, so
		 * setting off and stopping are not both a jump.
		 */
		this.travel += ((moving ? this.pace : 0) - this.travel) * Math.min(1, dt * 14);

		this.buildPose(dt);
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
	 * He says a blade went through a piece of the world — from where, facing
	 * which way, reaching how far and sweeping which arc — and hands it to his
	 * `Melee`, which is where what a blow costs and what came of it live. What
	 * a blow LOOKS like is this file's, and that is the whole of the split.
	 *
	 * The geometry goes with the blow rather than being looked up at the other
	 * end, and that is the important part: the reach and the arc are measured
	 * off the clip as it plays, so a rule carrying its own numbers would
	 * disagree with the picture and the disagreement would be invisible.
	 */
	private landBlow(target: Axial): void {
		this.melee?.land(
			{
				at: { x: this.x, y: this.y, z: this.z },
				facing: this.yaw,
				reach: {
					from: this.reach.from,
					to: this.reach.to,
					// What `leanIn` gets him is reach, so it belongs in the
					// number the rule is given rather than in a correction the
					// rule makes.
					distance: this.reach.distance + this.leanIn,
					height: this.reach.height,
				},
			},
			target,
		);
	}

	/**
	 * Hand this frame's drive to the animator and let it build the pose.
	 *
	 * Everything below is a NUMBER describing what he is doing, not a pose: how
	 * big the stride is, how far through the cut he is, whether he is holding
	 * anything. What that looks like is `HumanoidAnimator`, which is why this is
	 * eight assignments rather than five pose buffers.
	 */
	private buildPose(dt: number): void {
		const animation = this.animation;
		const flight = this.acting.flight;

		animation.speed = this.travel;
		animation.yawRate = this.yawRate;
		animation.reachIn = this.leanIn;
		animation.armed = this.armed;
		animation.shielded = this.shielded;
		animation.overlay =
			flight?.kind === 'pickup' ? 'stoop' : flight?.kind === 'strike' ? 'swing' : 'none';
		animation.overlayDone = flight?.done ?? false;
		animation.phase = flight && flight.seconds > 0 ? Math.min(1, flight.clock / flight.seconds) : 1;
		animation.fall = this.fall;

		animation.build(dt);
	}

	get stats(): PlayerStats {
		const tile = this.ground.tileAt(this.cell.q, this.cell.r);
		return {
			speed: this.acting.flight?.kind === 'move' ? this.animation.delivered : 0,
			slip: this.animation.slip,
			amp: this.animation.stride,
			gait: this.animation.gait,
			pelvisDrop: this.pelvisDrop,
			state: this.control.state,
			message: this.message,
			cuts: this.melee?.thrown ?? 0,
			hits: this.melee?.hits ?? 0,
			missed: this.melee?.missed ?? 0,
			carrying: this.items.filter((i) => i.worn).map((i) => i.name),
			cell: this.cell,
			terrace: tile?.level ?? null,
			stepsLeft: this.orders?.path.length ?? 0,
			energy: this.energy,
			speedRating: this.speed,
		};
	}
}
