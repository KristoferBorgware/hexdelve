/*
 * The man's gait, solved onto the ground.
 *
 * A gait can be written two ways. One is as joint angles: the thigh swings as
 * a sine, the knee bends on the half of the cycle the foot is travelling with
 * the body. It reads plausibly and it is compact, and nothing in it says where
 * the foot IS — the foot's path is whatever the angles happen to work out to,
 * and a planted foot that slides is not expressible as an error because it is
 * not expressible as anything.
 *
 * The other is the way round this file works. The foot's path along the ground
 * is what is authored — it lands, it travels straight back at a constant rate
 * through the stance, it lifts and swings forward — and the leg is solved
 * backwards from it by `solveLeg`, in the plane of the body. The knee angle
 * stops being a thing anyone chooses.
 *
 * What that buys is the whole reason for it: the ground he covers is the
 * ground his feet cover, so his speed is a number set rather than a number
 * discovered, and it is exactly proportional to the stride. A sliding foot
 * cannot be written.
 *
 * ## The crouch is the stride's, not the rig's
 *
 * His hip sits 0.80 m above where his ankle stands and his leg is 0.86 m, so
 * standing costs him nothing but a soft knee. What the hips drop for is the
 * stride: a foot reaching 0.34 m in front of the hip is 0.34 m around a circle
 * of radius 0.86, and the hip comes down by the difference. That is geometry
 * rather than taste, and it is why the run drops further than the walk — a
 * longer step is a lower hip, on any leg.
 *
 * ## One direction
 *
 * On the grid he walks where he faces, and every caller passed a forward
 * heading. `groundPath` is a path along the body's own Z, so a gait solved
 * onto the ground is a forward gait; the strafing version of this, where the
 * mouse owns the facing and the keys own the travel, is lab 09 and stays
 * there.
 *
 * Sign conventions (the character faces +Z, +X is its left):
 *   limb bones hang down -Y, so rot.x < 0 swings a limb FORWARD, > 0 BACK
 *   rot.z > 0 swings a limb towards the character's LEFT (+X)
 *   spine/chest/head point up +Y, so rot.x > 0 tips them FORWARD
 *   rot.y > 0 turns towards the character's left
 */

import { measureGroundSpeed, setSparse, type SparsePose } from '@hexdelve/engine';

import { HUMANOID_CHAIN, HUMANOID_SKELETON, solveLeg, type Step, type Trunk } from './humanoid.js';

const PI = Math.PI;
const TAU = PI * 2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One stride pair, in seconds. A run is the same cycle taken faster. */
export const WALK_PERIOD = 0.95;
export const RUN_PERIOD = 0.66;

/**
 * Where an ankle sits with the sole flat on the ground.
 *
 * A fact about the humanoid rig rather than about any one creature on it, so
 * the ghoul and the zombie solve their legs against this too — a foot's depth
 * is the foot's, and three copies of it were three chances to be a centimetre
 * out. Pinned to `humanoid.rig.yaml`'s foot tip by `test/assets.test.ts`.
 */
export const HUMANOID_SOLE = 0.08;

/**
 * Half the ground one foot covers in a stance, at a full stride.
 *
 * Long enough to read as a stride and short enough for the leg to reach it
 * from the crouch below, which is the binding constraint rather than the look
 * of it: a leg of 0.76 reaching a foot 0.37 out in front has to have dropped
 * the hip to about 0.75 to do it.
 */
const WALK_STRIDE = 0.34;
const RUN_STRIDE = 0.44;

/** How high the foot is carried at mid-swing. A run picks the knee up further. */
const WALK_LIFT = 0.12;
const RUN_LIFT = 0.2;

/**
 * How far the hips drop below the rig's rest height.
 *
 * Standing costs a soft knee and no more. The rest is what the stride needs: a
 * foot reaching further forward is a foot reaching further round the leg's own
 * circle, and the hip comes down by what is left over.
 */
const STAND_CROUCH = 0;
const WALK_CROUCH = 0.04;
const RUN_CROUCH = 0.05;

export const stridePeriod = (gait: number): number =>
	WALK_PERIOD + (RUN_PERIOD - WALK_PERIOD) * gait;

/**
 * Phases at which a foot is furthest along the direction of travel, i.e. where
 * it lands. The left foot leads; the right is half a cycle behind it.
 */
export const STRIDE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/**
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = full stride
 * @param gait  0 = walk, 1 = run
 * @param time  seconds, driving the breathing at the stand
 * @param out   reused pose, to keep this allocation-free per frame
 */
export function stridePose(
	theta: number,
	amp: number,
	gait = 0,
	time = 0,
	out: SparsePose = {},
): SparsePose {
	const run = clamp01(gait);
	const stride = clamp01(amp);
	const still = 1 - stride;
	const sinT = Math.sin(theta);

	/*
	 * The stand breathes at one rate and nothing else, and it fades out with
	 * the stride. Both are what let this be a clip: a cycle is played by
	 * wrapping a playhead at the duration it declares, so a rhythm that does
	 * not divide into it comes back somewhere other than where it started, and
	 * a gait carrying a clock of its own could not close at any duration.
	 */
	const breath = still * Math.sin(time * 1.8);

	/*
	 * The trunk. The hips drop to put the feet within reach, dip twice a cycle
	 * as the weight comes onto each leg, and roll over the planted foot; the
	 * spine leans into the travel, much harder at a run.
	 */
	const crouch = STAND_CROUCH + WALK_CROUCH * stride + RUN_CROUCH * run * stride;
	const dip = 0.022 * stride * (1 - Math.cos(2 * theta));
	const roll = 0.05 * stride * sinT;
	const rootY = HUMANOID_CHAIN.hipHeight - crouch - dip;
	const lean = (0.04 + 0.26 * run) * stride;

	const trunk: Trunk = {
		root: [rootY, 0],
		rootRot: lean * 0.45,
		spineRot: lean * 0.35 + 0.02 * breath,
		chestRot: lean * 0.2 + 0.03 * breath,
	};

	// The pelvis turns towards the leg that is swinging through, and counter-
	// rolls over the one carrying him.
	const rootYaw = -0.07 * stride * sinT;
	setSparse(
		out,
		'root',
		[trunk.rootRot, rootYaw, roll],
		[0, rootY - HUMANOID_CHAIN.hipHeight, 0],
	);

	/*
	 * The legs. Each foot is put where `groundPath` says and the leg solved to
	 * it, so a planted foot travels straight back at a constant rate however
	 * far the hips have dropped. The ankle levels the sole through the stance
	 * and points the toe through the swing.
	 */
	const step: Step = {
		restZ: 0,
		halfStride: WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * run,
		lift: WALK_LIFT + (RUN_LIFT - WALK_LIFT) * run,
	};
	leg(out, ['hipL', 'shinL', 'footL'], theta, stride, 1, trunk, roll, step);
	leg(out, ['hipR', 'shinR', 'footR'], theta + PI, stride, -1, trunk, roll, step);

	// The shoulders counter-rotate the pelvis, and the chest heaves at the stand.
	setSparse(out, 'spine', [trunk.spineRot, -rootYaw * 0.5, -roll * 0.3]);
	setSparse(out, 'chest', [trunk.chestRot, -rootYaw * 0.8, -roll * 0.2]);
	setSparse(out, 'neck', [-lean * 0.35 - 0.02 * breath, 0, 0]);
	// The head stays level and facing where he faces, whatever the spine does.
	setSparse(out, 'head', [
		-(trunk.rootRot + trunk.spineRot + trunk.chestRot) * 0.55 + 0.02 * breath,
		-(rootYaw + -rootYaw * 0.5 + -rootYaw * 0.8) * 0.5,
		0,
	]);

	/*
	 * The arms counter-swing the legs — the left arm forward as the right leg
	 * is — and the elbow closes as the arm comes forward, more at a run. At the
	 * stand they hang, breathing.
	 */
	const armSwing = (0.38 + 0.32 * run) * stride;
	const elbow = -0.28 - 0.85 * run;
	const flare = 0.14 + 0.06 * run;
	setSparse(out, 'armL', [-armSwing * Math.sin(theta + PI) + 0.03 * breath, 0, flare]);
	setSparse(out, 'armR', [-armSwing * sinT + 0.03 * breath, 0, -flare]);
	setSparse(out, 'forearmL', [elbow - 0.3 * stride * Math.max(0, Math.sin(theta + PI)), 0, 0]);
	setSparse(out, 'forearmR', [elbow - 0.3 * stride * Math.max(0, sinT), 0, 0]);
	setSparse(out, 'handL', [0, 0, 0]);
	setSparse(out, 'handR', [0, 0, 0]);

	return out;
}

/**
 * One leg, hip to foot, with the ankle put where the step says.
 *
 * `level` is the rotation that lays the sole flat once everything above it is
 * taken out; through the swing the ankle gives most of that back and points
 * the toe, which is what stops the foot skimming the grass on its way past.
 */
function leg(
	out: SparsePose,
	bones: readonly [string, string, string],
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
	roll: number,
	step: Step,
): void {
	const solved = solveLeg(phase, amp, side, trunk, roll, step, HUMANOID_SOLE);
	const foot = solved.level * (1 - 0.5 * solved.swing) + 0.4 * solved.swing;
	setSparse(out, bones[0]!, [solved.upper, 0, 0.02 * side]);
	setSparse(out, bones[1]!, [solved.lower, 0, 0]);
	setSparse(out, bones[2]!, [foot, 0, 0]);
}

/*
 * How fast this gait carries him, measured off the pose in his own frame.
 *
 * Nothing here is a tuned speed: a cycle's contact schedule is known, so ask
 * the pose where the planted foot is at the two contact keys. Solved onto the
 * ground, that comes out exactly proportional to the stride — which is what
 * makes the number on a blend axis mean what it says.
 */

export function strideVelocity(amp = 1, gait = 0): { x: number; z: number } {
	return measureGroundSpeed(
		HUMANOID_SKELETON,
		(phase, out) => stridePose(phase * TAU, amp, gait, 0, out),
		stridePeriod(gait),
		{ contactPhase: STRIDE_CONTACTS[0] },
	);
}

/** Forward speed at a full-length walk, in m/s. The turn clock is set from this. */
export const WALK_SPEED = strideVelocity(1, 0).z;
/** Forward speed at a full run. Past this the feet slide. */
export const RUN_SPEED = strideVelocity(1, 1).z;
