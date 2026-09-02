/*
 * An actor: a rig, a body hung on it, and where it is standing.
 *
 * The man and the bat differ only in which skeleton goes in and where the pose
 * comes from — which is the point of keeping the pose and the model apart. The
 * pose is solved once per frame in the actor's own space, and everything else
 * that frame reads that same solve: the IK, the hit tests, the model.
 */

import {
	solveWorld,
	type Model,
	type Skeleton,
	type SparsePose,
	type WorldPose,
	type HexInstances,
} from '@hexdelve/engine';

export interface ActorOptions {
	skeleton: Skeleton;
	model: Model;
	skeletonView: Model;
	x: number;
	z: number;
	y: number;
	yaw?: number;
}

export class Actor {
	readonly skeleton: Skeleton;
	readonly model: Model;
	readonly skeletonView: Model;

	x: number;
	y: number;
	z: number;
	yaw: number;

	/** The pose for this frame, in the actor's own space. */
	readonly pose: SparsePose = {};
	/** The resolved bone transforms for that pose. Reused, never reallocated. */
	readonly world: WorldPose = {};

	/** How far the foot IK had to lower the hips, in metres. Negative is down. */
	pelvisDrop = 0;

	constructor(options: ActorOptions) {
		this.skeleton = options.skeleton;
		this.model = options.model;
		this.skeletonView = options.skeletonView;
		this.x = options.x;
		this.y = options.y;
		this.z = options.z;
		this.yaw = options.yaw ?? 0;
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
