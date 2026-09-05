/*
 * Planting a rig's feet on ground that is not flat.
 *
 * An animation is authored on a floor. The world has terraces in it, so a
 * stride that was right on the flat leaves one foot in the air and the other
 * through the grass — and the fix is not a different animation, it is the same
 * animation with the last two joints of each leg solved onto whatever is
 * actually underneath them.
 *
 * ## Nothing here is about a particular creature
 *
 * Which bones are feet is the rig's own answer — `feet` in the rig file — and
 * the chain above each one is read off the skeleton by walking up two parents:
 * a foot's parent is its shin and the shin's is its hip, on any rig where a leg
 * is a leg. So a man, a hound and a troll are the same call.
 *
 * ## The two passes, and why there are two
 *
 * The first asks where each foot wants to be and how far the hips must drop for
 * the lower one to reach. The drop is applied to the root, and only THEN is the
 * chain solved — because moving the hips moves the hips' children, and solving
 * against the pre-drop positions would leave the leg reaching for where the
 * ground used to be.
 *
 * ## Where the ground comes from
 *
 * A function somebody sets. The engine has never heard of a terrace, a tile or
 * a hexagon, and a component that had to be taught one would be a component
 * only this game could use. Flat until a world is wired in, which is right for
 * a bench: a body on a stand is standing on a floor.
 */

import { levelBone, solveTwoBone } from '../../anim/ik.js';
import { solveWorld, type Skeleton } from '../../anim/skeleton.js';
import { Component } from './Component.js';
import { param } from './parameters.js';
import { Rig } from './Rig.js';

/** Ground height in world units, under a point in the XZ plane. */
export type GroundHeight = (x: number, z: number) => number;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One foot's target for this frame. */
interface Target {
	readonly bone: string;
	readonly hip: string;
	readonly shin: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly weight: number;
}

export class FootIK extends Component {
	/** How far the sole sits below the ankle, in metres. */
	sole = param(0.12, { min: 0, max: 0.5, step: 0.005, label: 'Sole', hint: 'Ankle to ground' });

	/**
	 * How high above its target a foot still gets planted, in metres.
	 *
	 * A foot in mid-swing is left to the animation: it is supposed to be in the
	 * air, and dragging it down would be a limp rather than a correction. The
	 * weight falls off linearly across this height.
	 */
	reach = param(0.18, { min: 0.01, max: 1, step: 0.01, label: 'Reach', hint: 'Blend height' });

	/**
	 * Whether to plant anything at all.
	 *
	 * A parameter rather than a branch in the caller, because the caller is not
	 * one place: every creature solves its own feet inside its own frame, and a
	 * switch each of them had to be asked about is a switch one of them forgets
	 * to ask about.
	 */
	enabled = param(true, { label: 'Plant feet' });

	/**
	 * What is underneath. Flat until somebody sets it.
	 *
	 * Wired by code rather than declared as a parameter, because it is a
	 * function: the shape of the ground is not a number an entity file can
	 * carry, and the world that knows it is the caller's.
	 */
	groundAt: GroundHeight = () => 0;

	private readonly targets: Target[] = [];

	/** The bones this poses. Null on an object with none. */
	get rig(): Rig | null {
		return this.object.getComponent(Rig);
	}

	/**
	 * Plant the feet in the rig's current pose.
	 *
	 * Called after whatever built that pose and before the world transforms are
	 * composed — the same place in a frame the pose itself is written, because
	 * this is a correction to it rather than a separate thing to draw.
	 */
	solve(): void {
		if (!this.enabled) return;
		const rig = this.rig;
		const feet = rig?.asset.feet;
		if (!rig || !feet) return;

		const { pose, skeleton } = { pose: rig.pose, skeleton: rig.skeleton };
		const world0 = solveWorld(skeleton, pose);
		this.targets.length = 0;
		let pelvisDrop = 0;

		const { transform } = this.object;
		const sin = Math.sin(transform.yaw);
		const cos = Math.cos(transform.yaw);
		const originX = transform.position[0]!;
		const originY = transform.position[1]!;
		const originZ = transform.position[2]!;

		for (const bone of feet) {
			const chain = legOf(skeleton, bone);
			const at = world0[bone];
			if (!chain || !at) continue;

			// The foot, out in the world, so the ground can be asked about it.
			const worldX = originX + at.p[0]! * cos + at.p[2]! * sin;
			const worldZ = originZ - at.p[0]! * sin + at.p[2]! * cos;

			const desiredY = this.groundAt(worldX, worldZ) - originY + this.sole;
			const above = at.p[1]! - desiredY;
			const weight = clamp(1 - above / this.reach, 0, 1);

			this.targets.push({ ...chain, x: at.p[0]!, y: desiredY, z: at.p[2]!, weight });
			if (weight > 0.02) pelvisDrop = Math.min(pelvisDrop, (desiredY - at.p[1]!) * weight);
		}

		rig.pelvisDrop = pelvisDrop;
		if (pelvisDrop < -0.0005) {
			const root = (pose['root'] ??= { rot: [0, 0, 0], pos: [0, 0, 0] });
			root.pos ??= [0, 0, 0];
			root.pos[1] = (root.pos[1] ?? 0) + pelvisDrop;
		}

		const world2 = solveWorld(skeleton, pose);
		for (const target of this.targets) {
			if (target.weight <= 0.02) continue;
			solveTwoBone(
				skeleton,
				pose,
				{ root: target.hip, mid: target.shin, end: target.bone },
				[target.x, target.y, target.z],
				world2[target.shin]!.p,
				target.weight,
				world2,
			);
			levelBone(skeleton, pose, target.bone, target.weight);
		}
	}
}

/**
 * The two joints above a foot, or null where there are not two.
 *
 * Read off the hierarchy rather than named, so a rig that calls its bones
 * something else still solves: what makes a leg a leg is its shape.
 */
function legOf(
	skeleton: Skeleton,
	foot: string,
): { bone: string; shin: string; hip: string } | null {
	const shin = skeleton.find((bone) => bone.name === foot)?.parent;
	if (!shin) return null;
	const hip = skeleton.find((bone) => bone.name === shin)?.parent;
	if (!hip) return null;
	return { bone: foot, shin, hip };
}
