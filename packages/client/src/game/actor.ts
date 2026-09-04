/*
 * An actor: a rig, a body hung on it, and where it is standing.
 *
 * The man and the bat differ only in which skeleton goes in and where the pose
 * comes from — which is the point of keeping the pose and the model apart. The
 * pose is solved once per frame in the actor's own space, and everything else
 * that frame reads that same solve: the IK, the hit tests, the model.
 *
 * ## Why this is a component
 *
 * An actor is not a thing in the world. It is one of the things a thing in the
 * world can HAVE — the game object is where it stands, and this is the body it
 * stands there with. Splitting them that way is what lets a prop hang off a
 * bone without the prop knowing what a bone is, and it is what stops a
 * character being a class that grows a field every time the game learns a verb.
 *
 * `x`, `y`, `z` and `yaw` are views of the object's transform rather than
 * fields beside it, so nothing can hold a stale copy of where a character is.
 * That costs the yaw its last few digits — a transform's rotation is a
 * Float32Array — and every use here is safe for it, because each one is either
 * a difference taken through `wrapAngle`, a sine, or a turn that converges on a
 * target and corrects its own error on the way.
 */

import {
	Component,
	setSparse,
	solveWorld,
	type Model,
	type Skeleton,
	type SparsePose,
	type GameObject,
	type WorldPose,
	type HexInstances,
} from '@hexdelve/engine';
import type { Axial } from '@hexdelve/shared';

export interface ActorOptions {
	skeleton: Skeleton;
	model: Model;
	skeletonView: Model;
}

export class Actor extends Component {
	readonly skeleton: Skeleton;
	readonly model: Model;
	readonly skeletonView: Model;

	/** The pose for this frame, in the actor's own space. */
	readonly pose: SparsePose = {};
	/** The resolved bone transforms for that pose. Reused, never reallocated. */
	readonly world: WorldPose = {};

	/** How far the foot IK had to lower the hips, in metres. Negative is down. */
	pelvisDrop = 0;

	constructor(object: GameObject, options: ActorOptions) {
		super(object);
		this.skeleton = options.skeleton;
		this.model = options.model;
		this.skeletonView = options.skeletonView;
	}

	/** Put it somewhere, facing a direction. */
	place(x: number, y: number, z: number, yaw = 0): void {
		this.object.transform.setPosition(x, y, z);
		this.object.transform.yaw = yaw;
	}

	get x(): number {
		return this.object.transform.position[0];
	}
	set x(value: number) {
		this.object.transform.position[0] = value;
	}

	get y(): number {
		return this.object.transform.position[1];
	}
	set y(value: number) {
		this.object.transform.position[1] = value;
	}

	get z(): number {
		return this.object.transform.position[2];
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

	/** Resolve the current pose. Everything downstream reads the result. */
	solve(): WorldPose {
		return solveWorld(this.skeleton, this.pose, this.world);
	}

	/**
	 * Draw the body, and the bones if they are being shown.
	 *
	 * Showing the skeleton ghosts the body rather than hiding it, so you can
	 * see the rig inside what it is driving — which means the body moves into
	 * the blended pass and stops writing depth, or it would hide the bones it
	 * is meant to be revealing.
	 */
	emit(opaque: HexInstances, blended: HexInstances, showSkeleton: boolean): void {
		if (showSkeleton) {
			this.model.emit(blended, this.world, this.x, this.y, this.z, this.yaw, { alpha: 0.34 });
			this.skeletonView.emit(opaque, this.world, this.x, this.y, this.z, this.yaw);
		} else {
			this.model.emit(opaque, this.world, this.x, this.y, this.z, this.yaw);
		}
	}

	/** A point in the actor's local frame, taken out into the world. */
	toWorldXZ(localX: number, localZ: number): { x: number; z: number } {
		const sin = Math.sin(this.yaw);
		const cos = Math.cos(this.yaw);
		return { x: this.x + localX * cos + localZ * sin, z: this.z - localX * sin + localZ * cos };
	}
}

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

/** Anything with a place and a heading — a body, or a behaviour driving one. */
/**
 * The other creature, as one of them needs to see the other.
 *
 * Which hexagon it is on, so neither walks into the other nor paths through it,
 * and where that is in world units, so each can turn to face the other while it
 * draws. Nothing about what it is made of or what it can take: a blow is
 * announced and the rules answer it.
 *
 * It is set after both are spawned rather than injected as a closure, because
 * each needs the other and one of them has to be built first. That was the last
 * thing keeping a bag of callbacks alive.
 */
export interface Opponent {
	readonly cell: Axial;
	readonly x: number;
	readonly z: number;
}

/** No hexagon. Far enough off the grid that nothing is ever standing on it. */
export const NOWHERE: Axial = { q: Number.NaN, r: Number.NaN };

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

/**
 * A behaviour that acts through a body on the same object.
 *
 * The man and the bat are both this: something that decides where to go and
 * what to do, driving an `Actor` that knows what it looks like doing it. They
 * are separate components because they are separate questions — a body can be
 * drawn with no behaviour at all, which is what a bench does, and a behaviour
 * that had to be a body could not also be a script.
 *
 * The placement below is delegated rather than duplicated: `this.x` on a
 * behaviour is its body's `x` is its object's transform, one value with three
 * names. Writing them out here rather than at each call site is what keeps the
 * two classes that extend this readable — they say `this.yaw` because a man
 * turning is not a fact about component composition.
 */
export abstract class ActorBehaviour extends Component {
	/** The body this drives. Required: a behaviour with nothing to move is a bug. */
	readonly body: Actor;

	/** Seconds since it started going down, or -1 while it is still standing. */
	private fallClock = -1;

	constructor(object: GameObject) {
		super(object);
		const body = object.getComponent(Actor);
		if (!body) {
			throw new Error(`'${object.name}' needs an actor component before a behaviour on it`);
		}
		this.body = body;
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
		return this.body.skeleton;
	}
	get pose(): SparsePose {
		return this.body.pose;
	}
	get world(): WorldPose {
		return this.body.world;
	}

	get x(): number {
		return this.body.x;
	}
	set x(value: number) {
		this.body.x = value;
	}

	get y(): number {
		return this.body.y;
	}
	set y(value: number) {
		this.body.y = value;
	}

	get z(): number {
		return this.body.z;
	}
	set z(value: number) {
		this.body.z = value;
	}

	get yaw(): number {
		return this.body.yaw;
	}
	set yaw(value: number) {
		this.body.yaw = value;
	}

	get pelvisDrop(): number {
		return this.body.pelvisDrop;
	}
	set pelvisDrop(value: number) {
		this.body.pelvisDrop = value;
	}

	solve(): WorldPose {
		return this.body.solve();
	}

	emit(opaque: HexInstances, blended: HexInstances, showSkeleton: boolean): void {
		this.body.emit(opaque, blended, showSkeleton);
	}

	toWorldXZ(localX: number, localZ: number): { x: number; z: number } {
		return this.body.toWorldXZ(localX, localZ);
	}
}
