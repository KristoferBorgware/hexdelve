/*
 * The humanoid rig, as the pose functions in this directory know it.
 *
 * The rig itself is `public/assets/rigs/humanoid.rig.yaml` and everything that
 * draws or poses a body reads it from there. This file is the small residue
 * that cannot: `stridePose` is a function of one phase angle that names
 * `hipL`, `shinR` and `armL` outright, and its arcs were solved against a leg
 * of a particular length; the ghoul's and the zombie's gaits solve a leg or
 * an arm onto the ground through the plane of the body, and need the chain
 * they are solving. None of them is rig-agnostic and none pretended to be —
 * which is exactly what makes them worth having, since a function of a
 * heading covers the whole circle of directions where a blend space over
 * clips covers four of them.
 *
 * Keeping these here rather than fetching them is what keeps every one of
 * those a pure function: the turn system solves a stride for a place in the
 * energy table at module load, the player samples it every frame, and neither
 * wants to be handed a rig to do it.
 *
 * The cost of a copy is that it can drift from the file, so it is not left to
 * chance: `test/assets.test.ts` pins every number below against
 * `humanoid.rig.yaml` and fails if the two stop agreeing. A stale leg length
 * would show up as a man whose feet slide, which is precisely the sort of bug
 * that gets blamed on the animation for a week.
 */

import type { Skeleton } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink, type Planar } from './planar.js';

/** Hip to ankle. The stride's arcs are solved against this. */
export const LEG_LENGTH = 0.43 + 0.37;

/**
 * Enough of the rig to measure a ground speed off.
 *
 * `measureGroundSpeed` resolves the pose and reads where the planted foot got
 * to, so it needs the chain from the root down to each foot and nothing else.
 * The arms and the head are left out because no measurement here asks about
 * them — this is the skeleton the stride is measured on, not the skeleton the
 * wanderer is drawn on.
 */
export const HUMANOID_SKELETON: Skeleton = [
	{ name: 'root', parent: null, offset: [0, 0.92, 0] },
	{ name: 'hipL', parent: 'root', offset: [0.16, -0.04, 0] },
	{ name: 'shinL', parent: 'hipL', offset: [0, -0.43, 0] },
	{ name: 'footL', parent: 'shinL', offset: [0, -0.37, 0] },
	{ name: 'hipR', parent: 'root', offset: [-0.16, -0.04, 0] },
	{ name: 'shinR', parent: 'hipR', offset: [0, -0.43, 0] },
	{ name: 'footR', parent: 'shinR', offset: [0, -0.37, 0] },
];

/**
 * The rest offsets of the chains a gait is solved on, in the y-z plane.
 *
 * Each entry is [y, z] of a bone's offset from its parent; x plays no part,
 * because every rotation in a gait is about x and the limbs move in the plane
 * of the body — see planar.ts, which solves them. The one x that matters is
 * how far out the hips sit, because a pelvis that rolls lifts one hip joint
 * and drops the other by that much.
 */
export const HUMANOID_CHAIN = {
	hipHeight: 0.92,
	hip: [-0.04, 0],
	hipWidth: 0.16,
	thigh: [-0.43, 0],
	shin: [-0.37, 0],
	spine: [0.14, 0],
	chest: [0.22, 0],
	shoulder: [0.12, 0],
	upperArm: [-0.34, 0],
	forearm: [-0.3, 0],
} as const;

/** How a limb's planted end travels: where it rests, how far, how high. */
export interface Step {
	readonly restZ: number;
	readonly halfStride: number;
	readonly lift: number;
}

/** The rotations of the spine, and where they put the hips. */
export interface Trunk {
	readonly root: Planar;
	readonly rootRot: number;
	readonly spineRot: number;
	readonly chestRot: number;
}

/** What a solved limb needs to be written: its two rotations and its state. */
export interface SolvedLimb {
	/** The first bone's rotation about x: the hip's, or the shoulder's. */
	readonly upper: number;
	/** The second bone's: the knee's, or the elbow's. */
	readonly lower: number;
	/**
	 * The rotation the end bone needs to lie level on the ground: minus
	 * everything above it.
	 */
	readonly level: number;
	/** How far into its swing the limb is, 0 planted to 1 mid-air, at this amp. */
	readonly swing: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How far into its swing a limb at `phase` is, at this amp: 0 when standing. */
function swingOf(phase: number, amp: number): number {
	return Math.pow(Math.max(0, Math.cos(phase)), 0.8) * clamp01(amp);
}

/**
 * One leg, hip to ankle, with the ankle put where `groundPath` says.
 *
 * The knee is solved for whatever the hips are doing, so the sole stays on
 * the ground through the stance however low a crouch drops. The hips roll
 * with a lurch, which lifts one hip joint and drops the other by the width
 * of the pelvis, and the solve is in the plane, so that lift goes in as a
 * change of height.
 *
 * @param sole where the ankle sits with the sole on the ground: the foot's depth
 */
export function solveLeg(
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
	roll: number,
	step: Step,
	sole: number,
): SolvedLimb {
	const hipAt = plus(
		plus(trunk.root, turn(HUMANOID_CHAIN.hip, trunk.rootRot)),
		[side * HUMANOID_CHAIN.hipWidth * Math.sin(roll), 0],
	);
	const target = groundPath(phase, step.restZ, step.halfStride, step.lift, sole, amp);
	const [hip, knee] = twoLink(trunk.rootRot, hipAt, HUMANOID_CHAIN.thigh, HUMANOID_CHAIN.shin, target, -1);
	return { upper: hip, lower: knee, level: -(trunk.rootRot + hip + knee), swing: swingOf(phase, amp) };
}

/** Forward kinematics down the spine to a shoulder joint, and the frame there. */
export function shoulderOf(trunk: Trunk): { at: Planar; frame: number } {
	let frame = trunk.rootRot;
	let at = plus(trunk.root, turn(HUMANOID_CHAIN.spine, frame));
	frame += trunk.spineRot;
	at = plus(at, turn(HUMANOID_CHAIN.chest, frame));
	frame += trunk.chestRot;
	at = plus(at, turn(HUMANOID_CHAIN.shoulder, frame));
	return { at, frame };
}

/**
 * One arm, shoulder to wrist, with the wrist put where `groundPath` says — a
 * front leg, for a creature on all fours. The elbow is solved to point back,
 * which is how an arm bears weight. `level` here is the rotation that lays
 * the hand flat with the fingers forward: everything above it taken out, and
 * a quarter turn more.
 *
 * @param palm where the wrist sits with the palm flat on the ground
 */
export function solveArm(phase: number, amp: number, trunk: Trunk, step: Step, palm: number): SolvedLimb {
	const { at, frame } = shoulderOf(trunk);
	const target = groundPath(phase, step.restZ, step.halfStride, step.lift, palm, amp);
	const [upper, elbow] = twoLink(frame, at, HUMANOID_CHAIN.upperArm, HUMANOID_CHAIN.forearm, target, 1);
	return {
		upper,
		lower: elbow,
		level: -Math.PI / 2 - (frame + upper + elbow),
		swing: swingOf(phase, amp),
	};
}
