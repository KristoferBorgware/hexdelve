/*
 * Where a game object is, and which way it is turned.
 *
 * Two fields, and the absence of the third is the interesting part. A prism
 * carries scale, a bone does not, and a game object does not either — for the
 * reason `Model.ts` already gives about bones: a non-uniform scale part-way
 * down a chain shears everything below it, and the composition stops being
 * exact. Everything in this project that is a size is the size of a part.
 *
 * Position is a plain array and rotation is a Float32Array, which is not an
 * oversight. A tile's `x` is a double and a character standing on one should be
 * standing exactly there, so positions stay in double precision; a rotation is
 * a quaternion and every quaternion in this project is a Float32Array, because
 * that is the layout an instance buffer wants. `Model.Part` is laid out the
 * same way for the same two reasons.
 *
 * The composition down a hierarchy is the one `solveWorld` performs over bones,
 * written out again over objects:
 *
 *     world.rotation = parent.rotation x local.rotation
 *     world.position = parent.position + parent.rotation . local.position
 *
 * That is the same statement twice because it is the same problem twice — a
 * hand hanging off a forearm and a sword hanging off a hand are one kind of
 * thing, and the only difference is which of the two the animation system owns.
 */

import { quat, type Quat, type QuatLike } from '@hexdelve/shared';

/** A position in whichever space its owner is expressed in. */
export type Point = [number, number, number];

export class Transform {
	/** Metres, in the parent's space. */
	readonly position: Point = [0, 0, 0];
	/** In the parent's space. */
	readonly rotation: Quat = quat.quat();

	/**
	 * The turn about +Y, which is the only rotation most of this game uses.
	 *
	 * A character faces a direction and never pitches or rolls as an object —
	 * its spine does that, through the rig. So yaw is what the movement code,
	 * the camera and the hit tests all actually mean, and reading or writing it
	 * should not require anybody to think about a quaternion.
	 *
	 * It is a VIEW of the rotation rather than a field beside it, so the two
	 * cannot disagree. The cost is that the round trip is only as good as a
	 * float32 quaternion: writing 0.4 and reading it back gives 0.4 to about
	 * seven digits, not to seventeen. That is far finer than a pixel at any
	 * zoom this game uses and it is the precision every other rotation here
	 * already carries — but code that turns by reading, adding and writing back
	 * every frame is quantising each time, so anything wanting an exact heading
	 * over thousands of frames should keep its own and set this from it.
	 */
	get yaw(): number {
		// atan2 of the +Y component against the scalar part, doubled: the
		// inverse of the assignment below, and exact for a rotation that only
		// ever went in through it.
		return 2 * Math.atan2(this.rotation[1]!, this.rotation[3]!);
	}

	set yaw(radians: number) {
		quat.set(this.rotation, 0, Math.sin(radians / 2), 0, Math.cos(radians / 2));
	}

	setPosition(x: number, y: number, z: number): this {
		this.position[0] = x;
		this.position[1] = y;
		this.position[2] = z;
		return this;
	}

	setRotation(rotation: QuatLike): this {
		quat.copy(this.rotation, rotation);
		return this;
	}

	/** Euler XYZ, the order everything else in this project authors angles in. */
	setEuler(x: number, y: number, z: number): this {
		quat.fromEulerXYZ(this.rotation, x, y, z);
		return this;
	}

	copyFrom(other: Transform): this {
		this.setPosition(other.position[0], other.position[1], other.position[2]);
		return this.setRotation(other.rotation);
	}
}

/**
 * A transform resolved into the scene's own space.
 *
 * Written in place rather than returned, for the reason `solveWorld` gives: a
 * scene is solved once a frame and allocating a position and a quaternion per
 * object each time is the difference between a garbage collector that never
 * runs and one that does.
 */
export interface WorldTransform {
	readonly position: Point;
	readonly rotation: Quat;
}

const scratch: Point = [0, 0, 0];

/**
 * Compose a local transform onto a parent's world transform.
 *
 * `out` may be the same object as `parent`; the position is read out of the
 * local transform before anything is written, so composing a chain in place
 * down its own array is safe.
 */
export function composeWorld(
	out: { position: Point; rotation: Quat },
	parent: WorldTransform | null,
	local: Transform,
): void {
	if (!parent) {
		out.position[0] = local.position[0];
		out.position[1] = local.position[1];
		out.position[2] = local.position[2];
		quat.copy(out.rotation, local.rotation);
		return;
	}

	quat.rotateVec3(scratch, parent.rotation, local.position);
	const x = parent.position[0] + scratch[0];
	const y = parent.position[1] + scratch[1];
	const z = parent.position[2] + scratch[2];

	quat.multiply(out.rotation, parent.rotation, local.rotation);
	out.position[0] = x;
	out.position[1] = y;
	out.position[2] = z;
}
