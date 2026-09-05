/*
 * The bones an object is built on, and the pose they are in this frame.
 *
 * A rig is not a thing in the world. It is one of the things a thing in the
 * world can HAVE — the game object is where the creature stands, and this is
 * the skeleton it stands there with. Splitting them that way is what lets a
 * prop hang off a bone without the prop knowing what a bone is.
 *
 * ## Why the pose lives here and not on the animator
 *
 * The pose is the state of the BONES, and the bones are this. An animator
 * writes into it, foot IK adjusts it, a death topples it, and the mesh and the
 * hit tests read whatever it ended up as — so a rig with no animator on it is
 * still a rig that can be posed, which is exactly what a bench does when it
 * drags a joint about.
 *
 * ## Two hierarchies, meeting once
 *
 * Bones are how a body is arranged; objects are how the world is. They meet at
 * one place — a sword hanging off a hand — and `Attach` is that place.
 */

import type { RigAsset } from '../../assets/rig.js';
import type { SparsePose } from '../../anim/pose.js';
import { solveWorld, type Skeleton, type WorldPose } from '../../anim/skeleton.js';
import { buildSkeletonView, Model } from '../Model.js';
import type { HexInstances } from '../HexInstances.js';
import type { GameObject } from '../GameObject.js';
import { Component } from './Component.js';

export class Rig extends Component {
	readonly asset: RigAsset;

	/** The pose for this frame, in the object's own space. */
	readonly pose: SparsePose = {};

	/** The resolved bone transforms for that pose. Reused, never reallocated. */
	readonly world: WorldPose = {};

	/** How far the foot IK had to lower the hips, in metres. Negative is down. */
	pelvisDrop = 0;

	/** Built on first use, because most rigs are never drawn as bones. */
	private view: Model | null = null;

	constructor(object: GameObject, asset: RigAsset) {
		super(object);
		this.asset = asset;
	}

	get skeleton(): Skeleton {
		return this.asset.skeleton;
	}

	/** Resolve the current pose. Everything downstream reads the result. */
	solve(): WorldPose {
		return solveWorld(this.skeleton, this.pose, this.world);
	}

	/** Draw the bones themselves — a joint each, and a shaft towards each child. */
	emitView(out: HexInstances): void {
		this.view ??= buildSkeletonView(this.skeleton, this.asset.tips);
		const { transform } = this.object;
		this.view.emit(
			out,
			this.world,
			transform.position[0]!,
			transform.position[1]!,
			transform.position[2]!,
			transform.yaw,
		);
	}
}
