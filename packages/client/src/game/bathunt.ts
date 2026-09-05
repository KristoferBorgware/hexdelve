/*
 * The bat's body: what a turn of hunting looks like, and where its teeth get to.
 *
 * The hunt itself is not here. Whether it has heard you, whether it has lost
 * you, and which hexagon it moves to are `Hunter`, a script on the same object
 * — see `hunt.ts` for the seam. What a bite COSTS is `Melee`, another script —
 * see `melee.ts`. What is here is what is left: how long an action takes, the
 * wings coming out and folding again, the lunge, and where the teeth actually
 * got to at the instant they closed.
 *
 * ## It hunts in turns, and its speed is one number
 *
 * +10 in the energy table, which `extract_energy` makes exactly double. So it
 * takes two hexagons for every one of yours and bites twice while you cut
 * once, and nothing anywhere implements that — it falls out of the table. The
 * three constants a cruise speed needed do not exist:
 *
 *   speed           `speed`, one row of the energy table
 *   bite cooldown   the 100 energy a bite costs, like every other action
 *   waypoint radius nothing. A step is one hexagon, so there is no line
 *                   between waypoints to be circled, and no path to be checked
 *                   between its corners
 *
 * That last one is worth dwelling on, because it is a whole class of problem
 * rather than a constant. A keep-apart radius exists to stop a flight between
 * two corners of a path passing through something A* routed around. On a turn
 * clock there is no between: a move ends on a cell or does not happen, and two
 * creatures cannot occupy one cell.
 *
 * ## Waking and settling are actions, not states
 *
 * The hunt has three states and they are all in the script. Waking, striking,
 * recovering and settling are not among them, because each is a phase of a
 * clip — and a phase of a clip is what an action already is.
 */

import {
	attachmentPosition,
	bindClip,
	createPose,
	denseToSparse,
	sampleBound,
	type GameObject,
	type RigAnchor,
	type RigAsset,
	type Clip,
	type ClipEvent,
} from '@hexdelve/engine';
import { axialDistance, HEX_SPACING, type Axial, type Random } from '@hexdelve/shared';

import { ActorBehaviour, clamp, NOWHERE, topple, turnTowards, wrapAngle } from './actor.js';
import { Acting } from './acting.js';
import { melee, type MeleeStrikes } from './melee.js';
import { huntOrders, type HuntOrders, type HuntState } from './hunt.js';
import { BatAnimator } from './batanimator.js';
import { actionSeconds } from './pace.js';
import { ACTION_ENERGY, NORMAL_SPEED, type Action, type TurnTaker } from './turns.js';
import type { TerrainQuery, Tile } from './terrain.js';


/**
 * Its place in the energy table: +10, which is exactly twice normal. Every
 * "it is faster than you" in this file is this line and nothing else.
 */
export const BAT_SPEED = NORMAL_SPEED + 10;
/** How far off the ground the wings hold it, once awake. */
const HOVER_LIFT = 0.62;

/** Onto its side and nose down. A bat that stops flying does not land neatly. */
const FALL_ROLL = 1.5;
const FALL_PITCH = 0.4;

/** How far the jaws get from the body, and how high. */
export interface BiteReach {
	readonly distance: number;
	readonly height: number;
}

/**
 * How far the jaws reach at the moment of the bite, measured off the lunge.
 *
 * The same question the sword had, asked of a different rig: the pose is
 * sampled at its contact key and the jaw tip's distance from the body read
 * off it, so re-timing the lunge moves this on its own.
 *
 * A function of the rig rather than a constant, now that the rig comes out of
 * a file — the jaw tip is an anchor in `bat.rig.yaml`, so a longer snout moves
 * the reach without anybody editing this line.
 */
/**
 * When in the strike the jaws arrive, as a fraction of it.
 *
 * Read off the clip's own `bite` event rather than typed beside it, so
 * re-baking the lunge moves the moment the blow lands — the same argument
 * `swingLand` makes about the man's cut.
 */
export function biteLand(lunge: Clip): number {
	const bite = lunge.events.find((event: ClipEvent) => event.name === 'bite');
	if (!bite) throw new Error(`the lunge clip has no 'bite' event to land on`);
	return bite.t / lunge.duration;
}

export function measureBiteReach(rig: RigAsset, lunge: Clip): BiteReach {
	const jawTip = rig.anchors.jawTip;
	if (!jawTip) throw new Error(`the rig '${rig.id}' has no 'jawTip' anchor to bite with`);
	const dense = createPose(rig.bones.length);
	sampleBound(bindClip(lunge, rig.index), biteLand(lunge) * lunge.duration, dense);
	const pose = denseToSparse(rig.bones, dense, {});
	const tip = attachmentPosition(rig.skeleton, pose, jawTip.bone, jawTip.at);
	return { distance: Math.hypot(tip[0], tip[2]), height: tip[1] };
}

/**
 * What the lunge cannot cover, taken out of the body — the bat's half of the
 * argument in `player.ts` under `leanIn`. A creature rooted to a hexagon
 * whose reach is shorter than the grid bites at nothing, so the shortfall goes
 * in as forward root travel across the strike and comes back out.
 */
export function batLean(reach: BiteReach): number {
	return Math.max(0, HEX_SPACING - reach.distance);
}

type BatActionKind = 'move' | 'bite' | 'wake' | 'settle' | 'reel' | 'wait';

export interface BatOptions {
	/** The ground it flies over and paths across. */
	terrain: TerrainQuery;
	/** For its starting energy, so it is not in lockstep with you from turn one. */
	random?: Random;
	/** Which way it faces to start. */
	yaw?: number;
	/** The hexagon it starts on, which its hunt takes for its perch. */
	cell: Axial;
	speed?: number;
}

export class BatHunt extends ActorBehaviour implements TurnTaker {
	readonly name = 'bat';
	readonly speed: number;
	energy: number;

	override message = 'asleep';
	cell: Axial;

	/** The ground it flies over and paths across. Read by its hunt. */
	readonly ground: TerrainQuery;
	readonly acting: Acting;

	/** 0 folded, 1 flying. */
	private wake = 0;
	/** 0 to 1 across a bite. */
	private lunge = 0;
	private lungeBlend = 0;
	private lean = 0;

	/** What it looks like doing all this. */
	private readonly animation: BatAnimator;

	/** How far this bat's jaws get, measured off its own rig and its lunge. */
	readonly reach: BiteReach;
	/** How far through the strike the jaws arrive, off the clip's own event. */
	private readonly biteAt: number;
	/** And the shortfall against the grid, which the body leans out. */
	readonly leanIn: number;
	private readonly jaw: RigAnchor;
	/** How far off the ground the wings hold it, off the rig's own metrics. */
	private readonly hoverY: number;

	constructor(object: GameObject, options: BatOptions) {
		super(object);
		const tile = options.terrain.tileAt(options.cell.q, options.cell.r);
		if (!tile) throw new Error(`the bat cannot perch on ${options.cell.q},${options.cell.r}`);
		this.ground = options.terrain;

		/* Where it is and what it is in the middle of — see `acting.ts`. */
		this.acting = object.getComponent(Acting) ?? object.addComponent(Acting);
		this.acting.place(options.cell, options.yaw ?? 0);
		this.cell = { q: options.cell.q, r: options.cell.r };
		this.speed = options.speed ?? BAT_SPEED;
		// Angband's `randint0(50)`: a monster starts part-way to its first move,
		// so a pack does not step in unison.
		this.energy = Math.floor((options.random?.() ?? 0) * 50);

		// Off the rig on this object rather than passed in: the jaw it bites with
		// is the jaw of the body it is a behaviour of, by definition.
		const rig = this.rig.asset;
		const jaw = rig.anchors.jawTip;
		if (!jaw) throw new Error(`the rig '${rig.id}' has no 'jawTip' anchor to bite with`);
		this.jaw = jaw;
		this.hoverY = rig.metrics.hoverHeight ?? 0;

		/*
		 * What it looks like, and how far its jaws get — both off the clips its
		 * own entity file gave it. The reach is measured from the lunge it will
		 * actually play, so re-baking that strike moves the reach with it rather
		 * than leaving the rules claiming one it no longer has.
		 */
		this.animation = this.object.addComponent(BatAnimator);
		this.biteAt = biteLand(this.animation.strike);
		this.reach = measureBiteReach(rig, this.animation.strike);
		this.leanIn = batLean(this.reach);
	}

	/** Where its body actually is, which is what the sword has to reach. */
	get bodyY(): number {
		return this.y + this.hoverY;
	}

	get busy(): boolean {
		return this.acting.busy;
	}

	/**
	 * The hunt driving it — a script on its own object, see `hunt.ts`.
	 *
	 * Looked up each time rather than kept: a hot reload replaces the instance,
	 * and a reference taken once would name the version it replaced.
	 */
	get hunt(): HuntOrders | null {
		return huntOrders(this.object);
	}

	/** What its bites cost and what came of them — a script, see `melee.ts`. */
	get melee(): MeleeStrikes | null {
		return melee(this.object);
	}

	/**
	 * Asleep unless something is hunting through it.
	 *
	 * The drawing reads this — a folded bat is a bat with nothing to chase —
	 * so a body with no hunt on it is drawn perched rather than left hovering.
	 */
	get state(): HuntState {
		return this.hunt?.state ?? 'asleep';
	}

	/** The route it is following, for the overlay. */
	get path(): readonly Axial[] | null {
		return this.hunt?.path ?? null;
	}

	tilesToPlayer(): number {
		return axialDistance(this.cell, (this.opponent?.cell ?? NOWHERE));
	}

	/**
	 * Thrown about by a blow: the wings snap out and the lunge is dropped
	 * half-thrown.
	 *
	 * Only the picture. What it COSTS — the next move — is the hunt's, and the
	 * hunt hears about the blow itself rather than being told by way of here.
	 */
	flinch(): void {
		this.wake = 1;
		this.lunge = 0;
		this.lungeBlend = 0;
	}

	/* --------------------------------------------------------------- its turn -- */

	/**
	 * One turn: start what its hunt decided on, and say what it cost.
	 *
	 * Nothing here decides anything. Whether it has heard you and which hexagon
	 * it moves to is `Hunter`; this knows how long each takes and what it looks
	 * like. A body with no hunt on it passes the turn asleep.
	 */
	beginTurn(): Action {
		const decision = this.hunt?.decide() ?? { kind: 'pass' as const, message: 'asleep' };
		switch (decision.kind) {
			case 'reel':
				return this.start('reel', 'hit', this.tile(), this.cell, null);
			case 'wake':
				return this.start('wake', 'waking', this.tile(), this.cell, null);
			case 'settle':
				return this.start('settle', 'settling', this.tile(), this.cell, null);
			case 'bite':
				return this.startBite(decision.target);
			case 'move': {
				const tile = this.ground.tileAt(decision.to.q, decision.to.r)!;
				return this.start('move', decision.message, tile, decision.to, null);
			}
			case 'pass':
				return this.pass(decision.message);
		}
	}

	/** A bite, which its `Melee` counts as thrown the moment it commits to it. */
	private startBite(target: Axial): Action {
		this.melee?.begin();
		return this.start('bite', 'biting', this.tile(), this.cell, target);
	}

	private start(
		kind: BatActionKind,
		message: string,
		to: Tile,
		cell: Axial,
		target: Axial | null,
	): Action {
		const seconds = actionSeconds(ACTION_ENERGY, this.speed);
		this.acting.begin(kind, seconds, to, cell, target);
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
		return this.ground.tileAt(this.cell.q, this.cell.r)!;
	}

	/* ------------------------------------------------------------ the drawing -- */

	/** Draw whatever it is doing at this instant. */
	protected override animate(dt: number): void {
		this.acting.advance(dt);

		const player = this.opponent;
		const flight = this.acting.flight;
		let flapAmp = 1;
		let speed = 0;

		if (flight) {
			const u = this.acting.phase;

			switch (flight.kind) {
				case 'move': {
					// The travel itself is `Acting`'s, below. What is the bat's
					// is which way it points while it does it.
					speed = HEX_SPACING / flight.seconds;
					const ahead = Math.atan2(flight.to.x - flight.from.x, flight.to.z - flight.from.z);
					this.yaw += clamp(wrapAngle(ahead - this.yaw), -6 * dt, 6 * dt);
					break;
				}
				case 'bite': {
					// Rooted to its cell. The only movement is turning to face
					// him and the lunge itself.
					if (player) turnTowards(this, player.x, player.z, dt, 6);
					this.lunge = u;
					this.lungeBlend = Math.min(1, this.lungeBlend + dt * 7);
					flapAmp = 0.5;
					if (this.acting.reached(this.biteAt)) this.landBite(flight.target);
					break;
				}
				case 'reel':
					flapAmp = 1.45; // thrashing, not cruising
					if (player) turnTowards(this, player.x, player.z, dt, 1.6);
					this.lungeBlend = Math.max(0, this.lungeBlend - dt * 5);
					break;
				case 'wake':
					if (player) turnTowards(this, player.x, player.z, dt, 2.4);
					break;
				case 'settle':
					flapAmp = 0.4;
					break;
				default:
					break;
			}
		}

		/*
		 * And it ends here, after the bat has had its say. Its height is not
		 * settled with it — the wings hold it off the ground, and that is
		 * worked out below on the wall clock rather than on the turn's.
		 */
		const ended = this.acting.settle();
		if (ended) {
			this.cell = this.acting.cell;
			if (ended.kind === 'bite') {
				this.lunge = 0;
				this.message = 'backing off';
			}
		}

		if (this.acting.flight?.kind !== 'bite') {
			this.lungeBlend = Math.max(0, this.lungeBlend - dt * 5);
		}

		/*
		 * The lean into the bite: what the lunge cannot reach across a
		 * hexagon, out and back. The bat's copy of `LEAN_IN`.
		 */
		const biting = this.acting.flight?.kind === 'bite';
		const wantLean = biting ? this.leanIn * Math.sin(Math.PI * this.lunge) : 0;
		this.lean += (wantLean - this.lean) * Math.min(1, dt * 12);

		/*
		 * Height and wings run on the wall clock, not on the turn clock, and
		 * that is deliberate: a bat's wings beat whether or not it is its move,
		 * and freezing them between turns would make the world look paused
		 * rather than waiting.
		 */
		/*
		 * The state is set before the wake or settle action starts, so this one
		 * line covers both ramps and the two steady values — and a fallen bat
		 * is a third: whatever it was doing, its wings stop holding it up.
		 *
		 * Falling reuses the ramp rather than adding a path beside it, which is
		 * most of why the fall is cheap here. `wake` already carries it down to
		 * the ground and folds the wings into the perched pose; all a death adds
		 * is the roll below, and a faster ramp because it drops rather than
		 * settles.
		 */
		const wanted = this.falling || this.state === 'asleep' ? 0 : 1;
		this.wake += (wanted - this.wake) * Math.min(1, dt * (this.falling ? 3.4 : 2.2));
		const under = this.ground.groundAt(this.x, this.z) + HOVER_LIFT * this.wake;
		this.y += (under - this.y) * Math.min(1, dt * 6);

		/*
		 * And the drive, as numbers rather than as a pose. How hard the wings
		 * work and how fast they beat both scale with how fast it is actually
		 * going, so a bat crossing a hexagon in half the time looks like it —
		 * by the same table that gives it the extra turn.
		 */
		const cruise = HEX_SPACING / actionSeconds(ACTION_ENERGY, this.speed);
		const effortOf = Math.min(1, speed / cruise);
		this.animation.wake = this.wake * this.wake * (3 - 2 * this.wake);
		this.animation.beat = flapAmp * Math.max(0.35, Math.min(1, 0.45 + speed / cruise));
		this.animation.rate = 0.55 + 0.55 * effortOf;
		this.animation.lunge = this.lunge;
		this.animation.lungeWeight = this.lungeBlend;
		this.animation.reachIn = this.lean;
		this.animation.fall = this.fall;
		this.animation.build(dt);

		if (this.lean > 1e-4) {
			const root = (this.pose.root ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[2]! += this.lean;
		}

		/*
		 * And over, if it is going down. No drop: `wake` has already brought it
		 * to the ground above, so all that is left is to stop it lying there as
		 * neatly as a bat that chose to perch.
		 */
		if (this.falling) {
			const t = this.fall;
			topple(this.pose, FALL_PITCH * t, FALL_ROLL * t, 0);
		}
	}

	/**
	 * The moment the jaws arrive.
	 *
	 * The jaw tip is asked where it actually got to, because that is what
	 * `leanIn` is built from and a lunge that stopped short bit nothing — only
	 * the pose knows how far it went. That point is where the bite comes FROM,
	 * so the rule measures from the teeth rather than from the middle of the
	 * animal.
	 */
	private landBite(target: Axial | null): void {
		const jaws = attachmentPosition(this.skeleton, this.pose, this.jaw.bone, this.jaw.at);
		const w = this.toWorldXZ(jaws[0], jaws[2]);

		this.melee?.land(
			{
				at: { x: w.x, y: this.y + jaws[1], z: w.z },
				facing: this.yaw,
				reach: {
					// Its teeth are already where the bite happens, so the arc
					// is the whole circle and the reach is what a body's width
					// allows.
					from: -Math.PI,
					to: Math.PI,
					distance: HEX_SPACING * 0.75,
					height: 0,
				},
			},
			target,
		);
	}
}
