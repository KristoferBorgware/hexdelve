/*
 * A behaviour that acts through the body on its own object.
 *
 * The man and the bat are both this: something that decides where to go and
 * what to do, driving bones and prisms that know what it looks like doing it.
 * They are separate components because they are separate questions — a body can
 * be drawn with no behaviour at all, which is what a bench does, and a
 * behaviour that had to be a body could not also be a script.
 *
 * The body is `Rig` and `MeshRenderer`, found on the object rather than handed
 * over: the object is what they have in common, and a second reference to the
 * same rig is a second thing to keep in step. What differs between the man and
 * the bat is which skeleton went in and where the pose comes from, which is the
 * point of keeping the pose and the mesh apart. The pose is solved once per
 * frame in the object's own space, and everything else that frame reads that
 * same solve: the IK, the hit tests, the drawing.
 *
 * `x`, `y`, `z` and `yaw` are views of the object's transform rather than
 * fields beside it, so nothing can hold a stale copy of where a character is.
 * That costs the yaw its last few digits — a transform's rotation is a
 * Float32Array — and every use here is safe for it, because each one is either
 * a difference taken through `wrapAngle`, a sine, or a turn that converges on a
 * target and corrects its own error on the way.
 */

import {
	Animator,
	Component,
	FootIK,
	MeshRenderer,
	Rig,
	setSparse,
	type GameObject,
	type HexInstances,
	type Skeleton,
	type SparsePose,
	type WorldPose,
} from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

import type { Action, TurnTaker } from './turns.js';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** How long a body takes to go down. Long enough to read, short enough to end. */
export const FALL_SECONDS = 1.1;

/**
 * Tip a posed body over about its root, and set it down as it goes.
 *
 * Applied to the ROOT of a pose that has already been built, so whatever the
 * body was doing when it died is what it falls out of — a stride mid-step, a
 * cut half-thrown. Rewriting the pose instead would need a death animation per
 * thing that can die, and there is not one yet.
 *
 * The drop is a root offset rather than a change to the object's position: the
 * object's Y is the ground it stands on, and moving it would be moving the
 * creature rather than slumping it.
 */
export function topple(pose: SparsePose, pitch: number, roll: number, drop: number): void {
	const root = pose['root'] ?? setSparse(pose, 'root', [0, 0, 0], [0, 0, 0]);
	if (!root.rot) root.rot = [0, 0, 0];
	if (!root.pos) root.pos = [0, 0, 0];
	root.rot[0] = (root.rot[0] ?? 0) + pitch;
	root.rot[2] = (root.rot[2] ?? 0) + roll;
	root.pos[1] = (root.pos[1] ?? 0) - drop;
}

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
	let angle = a;
	while (angle > Math.PI) angle -= TAU;
	while (angle < -Math.PI) angle += TAU;
	return angle;
}

/**
 * The other creature, as one of them needs to see the other.
 *
 * Which hexagon it is on, so neither walks into the other nor paths through it,
 * and where that is in world units, so each can turn to face the other while it
 * draws. Nothing about what it is made of or what it can take: a blow is
 * announced and the rules answer it.
 *
 * It is set after both are spawned rather than injected as a closure, because
 * each needs the other and one of them has to be built first.
 */
export interface Opponent {
	readonly cell: Axial;
	readonly x: number;
	readonly z: number;
}

/** No hexagon. Far enough off the grid that nothing is ever standing on it. */
export const NOWHERE: Axial = { q: Number.NaN, r: Number.NaN };

/** Anything with a place and a heading — a body, or a behaviour driving one. */
export interface Turnable {
	x: number;
	z: number;
	yaw: number;
}

/** Turn an actor towards a point, at no more than `rate` radians a second. */
export function turnTowards(
	actor: Turnable,
	targetX: number,
	targetZ: number,
	dt: number,
	rate: number,
): number {
	const want = Math.atan2(targetX - actor.x, targetZ - actor.z);
	const diff = wrapAngle(want - actor.yaw);
	actor.yaw += clamp(diff, -rate * dt, rate * dt);
	return Math.abs(diff);
}

export abstract class ActorBehaviour extends Component implements TurnTaker {
	/** For the readout, and for telling two of them apart in a log. */
	abstract readonly name: string;
	/** Angband-style, offset by 110. See `NORMAL_SPEED`. */
	abstract readonly speed: number;
	/** What it has banked towards its next action. */
	abstract energy: number;
	/** Whether it is still playing out its last turn. */
	abstract readonly busy: boolean;

	/** Decide, start, and say what it cost. */
	abstract beginTurn(): Action;

	/**
	 * What this creature looks like doing what it is doing, this frame.
	 *
	 * Called from `update` below, between the act being wound on and the pose
	 * being solved — which is the order the whole frame turns on and the reason
	 * `update` is written out here rather than left to each creature.
	 */
	protected abstract animate(dt: number): void;

	/**
	 * One frame of this creature: wind the act on, draw it, plant it, solve it.
	 *
	 * An ordinary component update, so the scene drives it and nothing outside
	 * the creature needs to know what order these four happen in — the order is
	 * a fact about a creature.
	 *
	 * One method rather than four components in an entity file for the same
	 * reason: each of these reads what the last one wrote, so a list an entity
	 * file could reorder is a list it could reorder wrongly. What the file
	 * decides is whether a creature HAS feet to plant; what it cannot decide is
	 * whether they are planted before the pose is solved.
	 */
	override update(dt: number): void {
		this.advanceFall(dt);
		this.animate(dt);
		this.applyFootIK();
		this.solve();
	}

	/** The bones it moves. Required: a behaviour with nothing to pose is a bug. */
	readonly rig: Rig;

	/** What those bones are drawn as. */
	readonly mesh: MeshRenderer;

	/** The animations it plays through them, by the names the file gave them. */
	readonly animator: Animator;

	/** Seconds since it started going down, or -1 while it is still standing. */
	private fallClock = -1;

	constructor(object: GameObject) {
		super(object);
		const rig = object.getComponent(Rig);
		const mesh = object.getComponent(MeshRenderer);
		const animator = object.getComponent(Animator);
		if (!rig || !mesh || !animator) {
			throw new Error(
				`'${object.name}' needs a rig, a mesh and an animator before a behaviour on them`,
			);
		}
		this.rig = rig;
		this.mesh = mesh;
		this.animator = animator;
	}

	/** Put it somewhere, facing a direction. */
	place(x: number, y: number, z: number, yaw = 0): void {
		this.object.transform.setPosition(x, y, z);
		this.object.transform.yaw = yaw;
	}

	/**
	 * Tip it over. Whatever kept it alive has decided it is done.
	 *
	 * What a death COSTS is a script's business and is settled before this is
	 * called; what it LOOKS like is this file's, and the two are kept apart on
	 * purpose. Calling it twice is not an error — an event can be announced
	 * more than once and a body cannot fall over twice.
	 */
	fell(): void {
		if (this.fallClock < 0) this.fallClock = 0;
	}

	/** Whether it has been told to go down, whether or not it has landed yet. */
	get falling(): boolean {
		return this.fallClock >= 0;
	}

	/**
	 * How far through the fall it is: 0 upright, 1 lying still.
	 *
	 * Eased rather than linear, so it lets go and then settles instead of
	 * rotating at a constant rate like a door.
	 */
	get fall(): number {
		if (this.fallClock < 0) return 0;
		const t = clamp(this.fallClock / FALL_SECONDS, 0, 1);
		return t * t * (3 - 2 * t);
	}

	/** Advance the fall. Called from `advance`, on the wall clock like the rest. */
	protected advanceFall(dt: number): void {
		if (this.fallClock >= 0) this.fallClock += dt;
	}

	get skeleton(): Skeleton {
		return this.rig.skeleton;
	}
	get pose(): SparsePose {
		return this.rig.pose;
	}
	get world(): WorldPose {
		return this.rig.world;
	}

	get x(): number {
		return this.object.transform.position[0]!;
	}
	set x(value: number) {
		this.object.transform.position[0] = value;
	}

	get y(): number {
		return this.object.transform.position[1]!;
	}
	set y(value: number) {
		this.object.transform.position[1] = value;
	}

	get z(): number {
		return this.object.transform.position[2]!;
	}
	set z(value: number) {
		this.object.transform.position[2] = value;
	}

	get yaw(): number {
		return this.object.transform.yaw;
	}
	set yaw(value: number) {
		this.object.transform.yaw = value;
	}

	get pelvisDrop(): number {
		return this.rig.pelvisDrop;
	}
	set pelvisDrop(value: number) {
		this.rig.pelvisDrop = value;
	}

	solve(): WorldPose {
		return this.rig.solve();
	}

	/**
	 * Plant its feet on whatever is underneath them, if it has any to plant.
	 *
	 * A `footIK` component on the object, or nothing at all — a bat has no feet
	 * on the ground and asks for none, and the answer is a missing component
	 * rather than a branch here. What the ground IS is wired into that component
	 * by whoever built the creature; the solve itself is the engine's.
	 */
	applyFootIK(): void {
		this.object.getComponent(FootIK)?.solve();
	}

	/**
	 * Draw the body, and the bones if they are being shown.
	 *
	 * Showing the skeleton ghosts the body rather than hiding it, so you can see
	 * the rig inside what it is driving — which means the body moves into the
	 * blended pass and stops writing depth, or it would hide the bones it is
	 * meant to be revealing.
	 */
	emit(opaque: HexInstances, blended: HexInstances, showSkeleton: boolean): void {
		if (showSkeleton) {
			this.mesh.emit(blended, { alpha: 0.34 });
			this.rig.emitView(opaque);
		} else {
			this.mesh.emit(opaque);
		}
	}

	/** A point in the actor's local frame, taken out into the world. */
	toWorldXZ(localX: number, localZ: number): { x: number; z: number } {
		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		return { x: this.x + localX * cos + localZ * sin, z: this.z - localX * sin + localZ * cos };
	}
}
