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
 * ## The hips drop by what the leg cannot reach
 *
 * His leg is exactly as long as the drop from his hip to his standing ankle,
 * so standing he is straight-legged with his soles down and there is no slack
 * to stride into. Every centimetre of that comes from the hips: a foot at the
 * end of its step is that far round a circle of the leg's own radius, and the
 * hip drops by what the circle takes off the vertical. The drop is deepest at
 * footfall, where the feet are furthest apart, and shallowest at mid-stance,
 * where the planted foot is directly below. A longer step is a lower hip, on
 * any leg, so the run drops further than the walk without either being a
 * number anyone chose.
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

import {
	HUMANOID_CHAIN,
	HUMANOID_SKELETON,
	LEG_LENGTH,
	solveLeg,
	type Step,
	type Trunk,
} from './humanoid.js';

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
 * Long enough to read as a stride, and free to be: the hips drop by whatever
 * the leg needs to reach it, so this sets how far he travels rather than how
 * bent he looks.
 */
const WALK_STRIDE = 0.34;
const RUN_STRIDE = 0.44;

/** How high the foot is carried at mid-swing. A run picks the knee up further. */
const WALK_LIFT = 0.12;
const RUN_LIFT = 0.2;

/** How far the hips roll over the planted foot, in radians, at a full stride. */
const ROLL = 0.05;

/**
 * How much shorter than the leg the hips are placed, once he is moving.
 *
 * A leg solved to exactly its own length is straight, and a leg that reaches
 * exactly its own length twice a cycle straightens and folds again through a
 * corner: the knee angle goes as the square root of the slack, so the last
 * millimetre of it is worth ten degrees. Holding the hips a few millimetres
 * inside the reach keeps a bend in the knee the whole way round, and the
 * corner becomes a curve. It is about the flexion a walking knee carries at
 * heel strike.
 */
const KNEE_RESERVE = 0.004;

/** The distance the hips are placed at from an ankle, rather than the leg. */
const REACH = LEG_LENGTH - KNEE_RESERVE;

/**
 * How far the root drops to put the leading hip `REACH` from its ankle.
 *
 * The hip sits on a circle of `REACH` about the ankle, and the vertical side
 * of that triangle is what is left of the radius once the horizontal side is
 * taken out. Everything between the root and the hip joint is in that side:
 * leaning tips the hip back off the root, so it is further from a foot in
 * front and the horizontal side grows; rolling lifts the hip the leading leg
 * hangs from, so the root has to come down by as much again.
 *
 * @param reach how far in front of the root the leading ankle lands
 * @param lean  the root's own pitch, in radians
 * @param roll  the root's own roll, in radians
 */
function hipDrop(reach: number, lean: number, roll: number): number {
	const [hipY] = HUMANOID_CHAIN.hip;
	const across = reach - hipY * Math.sin(lean);
	const down = Math.sqrt(Math.max(0, REACH * REACH - across * across));
	return (
		HUMANOID_CHAIN.hipHeight -
		HUMANOID_SOLE -
		down +
		hipY * Math.cos(lean) +
		HUMANOID_CHAIN.hipWidth * Math.abs(Math.sin(roll))
	);
}

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
	 * The legs' step, which the hips are placed from: how far each foot travels
	 * in a stance and how high it is carried between them.
	 */
	const step: Step = {
		restZ: 0,
		halfStride: WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * run,
		lift: WALK_LIFT + (RUN_LIFT - WALK_LIFT) * run,
	};

	/*
	 * The trunk. The hips roll over the planted foot, and dip twice a cycle to
	 * put the feet within reach: the reserve alone at mid-stance, where the
	 * planted foot is directly below, the full drop at footfall, where the feet
	 * are furthest apart, and a cosine between — which is above what the reach
	 * asks for the whole way, so no foot is ever left hanging. The spine leans
	 * into the travel, much harder at a run.
	 */
	const lean = (0.04 + 0.26 * run) * stride;
	const pitch = lean * 0.45;
	const roll = ROLL * stride * sinT;
	const rest = hipDrop(0, pitch, 0);
	const held = rest * stride;
	const reached = hipDrop(step.halfStride * stride, pitch, ROLL * stride) - rest;
	const dip = held + reached * (1 - Math.cos(2 * theta)) * 0.5;
	const rootY = HUMANOID_CHAIN.hipHeight - dip;

	const trunk: Trunk = {
		root: [rootY, 0],
		rootRot: pitch,
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
