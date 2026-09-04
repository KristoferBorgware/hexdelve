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
	solveWorld,
	type Model,
	type Skeleton,
	type SparsePose,
	type GameObject,
	type WorldPose,
	type HexInstances,
} from '@hexdelve/engine';

export interface ActorOptions {
	skeleton: Skeleton;
	model: Model;
	skeletonView: Model;
	/** Where it stands. Written onto the object's transform. */
	x: number;
	z: number;
	y: number;
	yaw?: number;
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
		object.transform.setPosition(options.x, options.y, options.z);
		object.transform.yaw = options.yaw ?? 0;
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

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
	let angle = a;
	while (angle > Math.PI) angle -= TAU;
	while (angle < -Math.PI) angle += TAU;
	return angle;
}

/** Turn an actor towards a point, at no more than `rate` radians a second. */
export function turnTowards(
	actor: Actor,
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
