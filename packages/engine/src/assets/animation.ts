/*
 * An animation an entity has, whichever of the two kinds it is.
 *
 * The editor's bench already found the smallest thing every animation in this
 * project has in common — a duration, and a function from a time to a pose —
 * and this is that, plus the two things a blend tree needs to put one in a
 * leaf: whether it takes part in the shared locomotion phase, and where in its
 * own cycle the first foot lands.
 *
 * Which is why a blend tree file can refer to `walk` and not care that the
 * walk is a function while the guard beside it is thirty keyframes.
 */

import { bindClip, sampleBound, type Clip } from '../anim/clip.js';
import { clipSource, poseSource, type PoseSource } from '../anim/blendtree.js';
import { createPose, denseToSparse, type SparsePose } from '../anim/pose.js';
import { measureGroundSpeed, type GroundVelocity } from '../anim/measure.js';
import type { RigAsset } from './rig.js';
import type { PoseFunction, PoseSampler } from './poseFunctions.js';

export interface AnimationAsset {
	/** The name the entity gave it, which is what a blend tree refers to. */
	readonly name: string;
	readonly label: string;
	readonly kind: 'clip' | 'procedural';
	/** One cycle, in seconds. */
	readonly duration: number;
	readonly loop: boolean;
	/** Where in the cycle (0..1) each foot lands. Empty when it does not walk. */
	readonly contacts: readonly number[];
	/** Whether a blend tree should sync this to the shared locomotion phase. */
	readonly sync: boolean;
	/** The keys, for anything that wants to look at them. Null for a function. */
	readonly clip: Clip | null;
	/** The pose at `t` seconds, written into `out` and returned. */
	sample(t: number, out: SparsePose): SparsePose;
	/**
	 * A blend-tree leaf source. Fresh each call, because a source keeps a
	 * scratch pose and two trees evaluating in one frame must not share it.
	 */
	source(): PoseSource;
	/**
	 * What this cycle actually carries the body at, measured off the pose
	 * rather than typed. Null unless the rig has feet and the cycle has a
	 * contact schedule to read them at.
	 */
	speed(): GroundVelocity | null;
}

export interface AnimationOptions {
	readonly name: string;
	readonly label: string;
	readonly sync: boolean;
	readonly contacts: readonly number[];
}

/** A keyframed clip as an animation. */
export function clipAnimation(clip: Clip, rig: RigAsset, options: AnimationOptions): AnimationAsset {
	const bound = bindClip(clip, new Map(rig.index));
	const dense = createPose(rig.bones.length);

	const sample = (t: number, out: SparsePose): SparsePose => {
		sampleBound(bound, t, dense);
		return denseToSparse(rig.bones, dense, out);
	};

	return finish({
		...options,
		kind: 'clip',
		duration: clip.duration,
		loop: clip.loop === 'loop',
		clip,
		sample,
		source: () => clipSource(clip, new Map(rig.index)),
		rig,
	});
}

/** A pose function as an animation, with the file's arguments applied. */
export function poseFunctionAnimation(
	fn: PoseFunction,
	rig: RigAsset,
	args: Readonly<Record<string, number>>,
	duration: number,
	options: AnimationOptions,
): AnimationAsset {
	const build = (): PoseSampler => fn.build({ rig, args, duration });
	const own = build();

	return finish({
		...options,
		kind: 'procedural',
		duration,
		loop: fn.loop ?? true,
		clip: null,
		sample: own,
		source: () => poseSource(options.name, duration, rig.bones, build()),
		rig,
	});
}

interface Parts extends AnimationOptions {
	readonly kind: 'clip' | 'procedural';
	readonly duration: number;
	readonly loop: boolean;
	readonly clip: Clip | null;
	readonly sample: PoseSampler;
	readonly source: () => PoseSource;
	readonly rig: RigAsset;
}

function finish(parts: Parts): AnimationAsset {
	const { rig, ...rest } = parts;
	let measured: GroundVelocity | null | undefined;

	return {
		...rest,
		/*
		 * Measured on demand and remembered, because a blend tree's thresholds
		 * ask for it at load and the bench's readout asks again every frame.
		 * There is nothing to invalidate: a clip's feet do not move.
		 */
		speed: () => {
			if (measured === undefined) {
				measured =
					rig.feet === null || rest.contacts.length === 0
						? null
						: measureGroundSpeed(
								rig.skeleton,
								(phase, out) => rest.sample(phase * rest.duration, out),
								rest.duration,
								{ feet: rig.feet, contactPhase: rest.contacts[0]! },
							);
			}
			return measured;
		},
	};
}
