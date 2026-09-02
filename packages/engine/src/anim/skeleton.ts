/*
 * A skeleton, and forward kinematics over it.
 *
 * A bone is a name, a parent and an offset from that parent — no renderer
 * types, no scene graph nodes. Everything else (the character's prisms, the
 * visible skeleton, the clips, the IK) is built from that list, which is what
 * lets a bat with four bones a wing and a man with two arms share every line
 * of code in this directory.
 *
 * Parents must precede their children, so one forward pass resolves the whole
 * hierarchy.
 */

import { quat, type QuatLike } from '@hexdelve/shared';

import type { SparsePose } from './pose.js';

export interface Bone {
	readonly name: string;
	readonly parent: string | null;
	readonly offset: readonly [number, number, number];
}

export type Skeleton = readonly Bone[];

/** Where a chain ends and there is no child bone to draw towards. */
export interface BoneTip {
	readonly bone: string;
	readonly to: readonly [number, number, number];
}

/** A bone's resolved transform, in the actor's own space. */
export interface BoneWorld {
	/** Rotation. */
	q: Float32Array;
	/** Position. */
	p: [number, number, number];
}

export type WorldPose = Record<string, BoneWorld>;

export function boneNames(skeleton: Skeleton): string[] {
	return skeleton.map((b) => b.name);
}

export function boneIndex(skeleton: Skeleton): Map<string, number> {
	return new Map(skeleton.map((b, i) => [b.name, i]));
}

export function findBone(skeleton: Skeleton, name: string): Bone | null {
	for (const bone of skeleton) if (bone.name === name) return bone;
	return null;
}

export function parentMap(skeleton: Skeleton): Record<string, string | null> {
	const parents: Record<string, string | null> = {};
	for (const bone of skeleton) parents[bone.name] = bone.parent;
	return parents;
}

const scratchLocal = quat.quat();

/**
 * Resolve every bone's transform, in the actor's local space.
 *
 * `out` is reused between frames — the objects and arrays inside it are
 * written in place rather than replaced, because this runs two or three times
 * a frame per actor and allocating a 17-bone map each time is the difference
 * between a garbage collector that never runs and one that does.
 */
export function solveWorld(skeleton: Skeleton, pose: SparsePose, out: WorldPose = {}): WorldPose {
	for (const bone of skeleton) {
		const entry = pose[bone.name];
		const rot = entry?.rot;
		const delta = entry?.pos;

		let slot = out[bone.name];
		if (!slot) {
			slot = { q: new Float32Array(4), p: [0, 0, 0] };
			out[bone.name] = slot;
		}

		if (rot) quat.fromEulerXYZ(scratchLocal as never, rot[0]!, rot[1]!, rot[2]!);
		else quat.identity(scratchLocal as never);

		const lx = bone.offset[0] + (delta ? delta[0]! : 0);
		const ly = bone.offset[1] + (delta ? delta[1]! : 0);
		const lz = bone.offset[2] + (delta ? delta[2]! : 0);

		if (bone.parent) {
			const parent = out[bone.parent]!;
			quat.multiply(slot.q as never, parent.q, scratchLocal);
			// The offset is carried by the parent's rotation, not by its own.
			const rotated = quat.rotateVec3([0, 0, 0], parent.q, [lx, ly, lz]) as number[];
			slot.p[0] = parent.p[0] + rotated[0]!;
			slot.p[1] = parent.p[1] + rotated[1]!;
			slot.p[2] = parent.p[2] + rotated[2]!;
		} else {
			slot.q.set(scratchLocal);
			slot.p[0] = lx;
			slot.p[1] = ly;
			slot.p[2] = lz;
		}
	}
	return out;
}

/**
 * Where a rigid thing held by a bone currently is — a sword's tip, a bat's
 * jaws. The offset is in the holding bone's own space.
 *
 * This is how the reaches in lab 9 are measured rather than typed: ask the
 * clip where the blade actually got to, and the hit test and the readout agree
 * with the picture by construction.
 */
export function attachmentPosition(
	skeleton: Skeleton,
	pose: SparsePose,
	boneName: string,
	localOffset: readonly number[],
	world?: WorldPose,
): [number, number, number] {
	const w = world ?? solveWorld(skeleton, pose);
	const bone = w[boneName]!;
	const rotated = quat.rotateVec3([0, 0, 0], bone.q, localOffset) as number[];
	return [bone.p[0] + rotated[0]!, bone.p[1] + rotated[1]!, bone.p[2] + rotated[2]!];
}

/** The rotation of a bone in the actor's space, for callers that only need that. */
export function boneRotation(world: WorldPose, name: string): QuatLike {
	return world[name]!.q;
}
