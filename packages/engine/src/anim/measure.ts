/*
 * How fast a cycle actually carries a body.
 *
 * A locomotion clip does not come with a speed: it comes with legs, and the
 * speed is whatever those legs work out to. Something has to measure it, or
 * every threshold in a blend tree is a number somebody guessed and the feet
 * pay for it.
 *
 * The obvious way to measure — watch the feet over a cycle and decide which
 * one is planted by height — will not do, and this project has already been
 * bitten by it: at a bearing where the step is short, the pelvis bob is deeper
 * than the foot lift, so a height test finds "contact" in the middle of a
 * swing and reports a side-step travelling backwards.
 *
 * There is nothing to detect anyway. A cycle's CONTACT SCHEDULE is known — it
 * is the thing the phase sync lines clips up by — and a foot is planted from
 * one contact key to the other, half a cycle later, whichever way the body is
 * going. So ask the pose where that foot is at those two instants. Whatever
 * distance it covers backwards through the body's own space, the body covered
 * forwards through the world, in half a cycle.
 *
 * Both feet are read and averaged, because they are mirror images half a cycle
 * apart: that is symmetry, not smoothing.
 */

import type { SparsePose } from './pose.js';
import { solveWorld, type Skeleton, type WorldPose } from './skeleton.js';

/** Travel in the body's own frame, metres per second. */
export interface GroundVelocity {
	/** Along the body's +X, which is its left. */
	readonly x: number;
	/** Along the body's +Z, which is where it faces. */
	readonly z: number;
}

export interface GroundSpeedOptions {
	/** The two feet that alternate. Defaults to the humanoid's. */
	readonly feet?: readonly [string, string];
	/**
	 * Where in the cycle (0..1) the FIRST foot lands. The second lands half a
	 * cycle later, which is what makes this one number the whole schedule.
	 */
	readonly contactPhase?: number;
}

const poseA: SparsePose = {};
const poseB: SparsePose = {};
const worldA: WorldPose = {};
const worldB: WorldPose = {};
const ZERO: GroundVelocity = { x: 0, z: 0 };

/**
 * @param sample writes the pose at a normalised phase (0..1) into `out`
 * @param duration one cycle, in seconds
 */
export function measureGroundSpeed(
	skeleton: Skeleton,
	sample: (phase: number, out: SparsePose) => SparsePose,
	duration: number,
	options: GroundSpeedOptions = {},
): GroundVelocity {
	const half = duration / 2;
	if (half < 1e-6) return ZERO;

	const feet = options.feet ?? (['footL', 'footR'] as const);
	const contact = options.contactPhase ?? 0;

	const a = solveWorld(skeleton, sample(wrap(contact), poseA), worldA);
	const b = solveWorld(skeleton, sample(wrap(contact + 0.5), poseB), worldB);

	const aFirst = a[feet[0]!];
	const aSecond = a[feet[1]!];
	const bFirst = b[feet[0]!];
	const bSecond = b[feet[1]!];
	if (!aFirst || !aSecond || !bFirst || !bSecond) return ZERO;

	return {
		x: (aFirst.p[0] - bFirst.p[0] + bSecond.p[0] - aSecond.p[0]) / 2 / half,
		z: (aFirst.p[2] - bFirst.p[2] + bSecond.p[2] - aSecond.p[2]) / 2 / half,
	};
}

function wrap(phase: number): number {
	const p = phase % 1;
	return p < 0 ? p + 1 : p;
}
