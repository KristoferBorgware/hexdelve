/*
 * A character, as hex prisms hung on bones.
 *
 * The labs do this with a scene graph: a THREE.Object3D per bone, meshes
 * parented to it, and the renderer walks the tree. There is no tree here and
 * there does not need to be one. Every drawable in this project is the same
 * prism, so a "part" is just a bone name and a transform relative to it, and
 * drawing the character is one pass composing three transforms per part:
 *
 *     actor (where he is standing)  x  bone (where the pose put it)  x  part
 *
 * That composition is exact rather than approximate because bones never carry
 * scale — only the parts do — so there is no non-uniform scale part-way down a
 * chain to shear the ones below it.
 *
 * The pay-off is that a posed character lands in the same instance buffer as
 * the terrain, and the whole scene is still one draw call per pass.
 */

import { quat, type QuatLike, type Rgb } from '@hexdelve/shared';

import type { BoneTip, Skeleton, WorldPose } from '../anim/skeleton.js';
import { HEX_FLAG_NONE, type ColorInput, type HexInstances } from './HexInstances.js';

export interface Part {
	/** The bone this hangs from. Ignored when the model is drawn detached. */
	readonly bone: string;
	readonly position: readonly [number, number, number];
	/** Rotation in the bone's own space. */
	readonly rotation: Float32Array;
	readonly scale: readonly [number, number, number];
	readonly color: ColorInput;
	readonly alpha: number;
	readonly flags: number;
}

export interface PartOptions {
	/** Euler XYZ in the bone's space. Ignored if `rotation` is given. */
	euler?: readonly [number, number, number];
	rotation?: QuatLike;
	alpha?: number;
	flags?: number;
}

export interface EmitOptions {
	/** Scales every part's own alpha — how the skeleton view ghosts a body. */
	alpha?: number;
	/** Skip parts entirely, for a model that is hidden but still posed. */
	hidden?: boolean;
}

const worldQuat = quat.quat();
const finalQuat = quat.quat();
const scratchA = new Float32Array(3);
const scratchB = new Float32Array(3);

/**
 * A list of prisms bound to bones.
 *
 * Built once at startup and then only read, so the per-frame cost is the
 * composition and nothing else.
 */
export class Model {
	readonly parts: Part[] = [];

	/** A prism in a bone's space. Mirrors the labs' `part(bone, pos, scale, colour)`. */
	add(
		bone: string,
		position: readonly [number, number, number],
		scale: readonly [number, number, number],
		color: ColorInput,
		options: PartOptions = {},
	): this {
		const rotation = new Float32Array(4);
		if (options.rotation) {
			rotation.set(options.rotation as ArrayLike<number>);
		} else if (options.euler) {
			quat.fromEulerXYZ(rotation as never, options.euler[0], options.euler[1], options.euler[2]);
		} else {
			rotation[3] = 1;
		}

		this.parts.push({
			bone,
			position,
			rotation,
			scale,
			color,
			alpha: options.alpha ?? 1,
			flags: options.flags ?? HEX_FLAG_NONE,
		});
		return this;
	}

	/**
	 * A thin prism spanning two points in a bone's space — every limb spar and
	 * every wing bone in the project is one of these.
	 */
	strut(
		bone: string,
		from: readonly [number, number, number],
		to: readonly [number, number, number],
		radius: number,
		color: ColorInput,
		options: PartOptions = {},
	): this {
		const dx = to[0] - from[0];
		const dy = to[1] - from[1];
		const dz = to[2] - from[2];
		const length = Math.hypot(dx, dy, dz);
		if (length < 1e-6) return this;

		// The prism's own axis is +Y, so the rotation is the arc taking +Y onto
		// the line between the two points.
		const rotation = new Float32Array(4);
		quat.fromUnitVectors(rotation as never, [0, 1, 0], [dx / length, dy / length, dz / length]);

		return this.add(
			bone,
			[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
			[radius, length, radius],
			color,
			{ ...options, rotation },
		);
	}

	/**
	 * Emit every part through the pose, into the actor's place in the world.
	 *
	 * `actorYaw` and the actor's position are applied last, so the pose is
	 * solved once in the actor's own space and reused — which matters because
	 * the IK and the hit tests want it in that space too.
	 */
	emit(
		instances: HexInstances,
		world: WorldPose,
		actorX: number,
		actorY: number,
		actorZ: number,
		actorYaw: number,
		options: EmitOptions = {},
	): void {
		if (options.hidden) return;
		const alphaScale = options.alpha ?? 1;

		const sinYaw = Math.sin(actorYaw / 2);
		const cosYaw = Math.cos(actorYaw / 2);
		const actorQ = [0, sinYaw, 0, cosYaw];

		for (const part of this.parts) {
			const bone = world[part.bone];
			if (!bone) continue;

			// bone x part, in the actor's space.
			quat.multiply(worldQuat, bone.q, part.rotation);
			quat.rotateVec3(scratchA, bone.q, part.position);
			const localX = bone.p[0] + scratchA[0]!;
			const localY = bone.p[1] + scratchA[1]!;
			const localZ = bone.p[2] + scratchA[2]!;

			// actor x that, into the world.
			quat.multiply(finalQuat, actorQ, worldQuat);
			scratchB[0] = localX;
			scratchB[1] = localY;
			scratchB[2] = localZ;
			quat.rotateVec3(scratchB, actorQ, scratchB);

			instances.push(
				actorX + scratchB[0]!,
				actorY + scratchB[1]!,
				actorZ + scratchB[2]!,
				part.scale[0],
				part.scale[1],
				part.scale[2],
				part.color,
				{ rotation: finalQuat, alpha: part.alpha * alphaScale, flags: part.flags },
			);
		}
	}

	/**
	 * Emit every part relative to one transform, ignoring bones entirely.
	 *
	 * This is how a prop lies in the grass. Worn, a prop's parts are in its
	 * bone's space and go through `emit`; put down, the very same parts are in
	 * the group's space and go through here. One model, two ways of placing it,
	 * which is what makes picking something up a change of parent and nothing
	 * else.
	 */
	emitDetached(
		instances: HexInstances,
		x: number,
		y: number,
		z: number,
		rotation: QuatLike,
		options: EmitOptions = {},
	): void {
		if (options.hidden) return;
		const alphaScale = options.alpha ?? 1;

		for (const part of this.parts) {
			quat.multiply(finalQuat, rotation, part.rotation);
			quat.rotateVec3(scratchA, rotation, part.position);

			instances.push(
				x + scratchA[0]!,
				y + scratchA[1]!,
				z + scratchA[2]!,
				part.scale[0],
				part.scale[1],
				part.scale[2],
				part.color,
				{ rotation: finalQuat, alpha: part.alpha * alphaScale, flags: part.flags },
			);
		}
	}
}

export interface SkeletonViewOptions {
	jointColor?: Rgb | number;
	boneColor?: Rgb | number;
	jointRadius?: number;
	shaftRadius?: number;
}

/**
 * The visible skeleton: a joint at every bone and a shaft towards every child,
 * generated from the hierarchy rather than modelled.
 *
 * Add a bone to the data and it shows up here for free, which is why the same
 * function draws a humanoid and a bat.
 */
export function buildSkeletonView(
	skeleton: Skeleton,
	tips: readonly BoneTip[] = [],
	options: SkeletonViewOptions = {},
): Model {
	const model = new Model();
	const jointColor = options.jointColor ?? 0xd8cfae;
	const boneColor = options.boneColor ?? 0xf2eddd;
	const jointRadius = options.jointRadius ?? 0.055;
	const shaftRadius = options.shaftRadius ?? 0.028;

	for (const bone of skeleton) {
		model.add(bone.name, [0, 0, 0], [jointRadius, 0.075, jointRadius], jointColor);
	}
	for (const bone of skeleton) {
		if (bone.parent) model.strut(bone.parent, [0, 0, 0], bone.offset, shaftRadius, boneColor);
	}
	for (const tip of tips) {
		model.strut(tip.bone, [0, 0, 0], tip.to, shaftRadius, boneColor);
	}

	return model;
}
