/*
 * How the ghoul holds itself, as a pure function.
 *
 * The ghoul wears the wanderer's rig and none of the wanderer's animations. A
 * man walks upright with his legs under him; a ghoul goes hunched, the spine
 * bent over knees that never straighten, the head craned up off the end of
 * that bend to keep its eyes on whatever it is going towards, and the arms
 * hanging out in front of it with the claws open. That is not a lean laid
 * over the stride, because the legs are different too — bent through the
 * whole cycle, shuffling rather than stepping — so it is its own gait.
 *
 * One function, as the hellhounds' gaits are: `amp` throttles between
 * standing and a full shamble, and everything about the stand — the sway,
 * the ragged breathing, the twitch of the head, the tremor in the hands — is
 * faded in as the stride fades out.
 *
 * The leap is not here. It has a beginning, a moment of contact and a
 * recovery, so it is a keyframed clip, `clips/leap.clip.yaml`, the same way
 * the wanderer's cut is.
 *
 * Sign conventions are the humanoid rig's: it faces +Z, +X is its left; limb
 * bones hang down, so rot.x < 0 swings one FORWARD; the spine, chest and head
 * point up, so rot.x > 0 tips them FORWARD; a foot's rot.x > 0 points the toe
 * DOWN; rot.y > 0 turns towards its own left.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink } from './planar.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The rest offsets of the leg the shamble is solved on, in the y-z plane —
 * copied from `humanoid.rig.yaml` and pinned to it by `test/assets.test.ts`,
 * for the same reason the stride carries its own leg length: a planted foot
 * is a statement about a particular skeleton.
 */
export const GHOUL_CHAIN = {
	hipHeight: 0.92,
	hip: [-0.04, 0],
	/** How far out from the centre line each hip joint sits. */
	hipWidth: 0.16,
	thigh: [-0.41, 0],
	shin: [-0.35, 0],
	/** Where the ankle sits with the sole on the ground: the foot's own depth. */
	soleHeight: 0.09,
} as const;

/** One shuffling stride pair, in seconds, at amp = 1. */
export const SHAMBLE_PERIOD = 1.1;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const SHAMBLE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** How far the hips sit below their standing height. Constant: it never straightens. */
const CROUCH = 0.17;
/** Half the ground one foot covers in a stance, at amp 1. A shuffle, not a step. */
const HALF_STRIDE = 0.22;
/** How high a foot is carried at mid-swing. Barely off the ground. */
const LIFT = 0.09;

/**
 * The hunch, which is the same standing and walking: the pelvis tipped, the
 * spine and chest bent over it, the neck and head bent back up off the end.
 */
const ROOT_PITCH = 0.14;
const SPINE_PITCH = 0.5;
const CHEST_PITCH = 0.4;
const NECK_PITCH = -0.38;
const HEAD_PITCH = -0.42;

/**
 * One leg, hip to foot, with the foot put where `groundPath` says.
 *
 * The knee is solved for whatever the hips are doing, so the sole stays on
 * the ground through the stance however low the crouch drops; in the air the
 * toes drag, pointing down.
 */
function leg(
	out: SparsePose,
	bones: readonly [string, string, string],
	phase: number,
	amp: number,
	side: number,
	root: readonly [number, number],
	rootRot: number,
	roll: number,
): void {
	const air = Math.max(0, Math.cos(phase));
	const fold = Math.pow(air, 0.8);

	// The hips roll with the lurch, which lifts one hip joint and drops the
	// other by the width of the pelvis; the solve is in the plane, so that
	// lift goes in as a change of height.
	const hipAt = plus(
		plus(root, turn(GHOUL_CHAIN.hip, rootRot)),
		[side * GHOUL_CHAIN.hipWidth * Math.sin(roll), 0],
	);
	const target = groundPath(phase, 0, HALF_STRIDE, LIFT, GHOUL_CHAIN.soleHeight, amp);
	const [hip, knee] = twoLink(rootRot, hipAt, GHOUL_CHAIN.thigh, GHOUL_CHAIN.shin, target, -1);

	const level = -(rootRot + hip + knee);
	const foot = level * (1 - 0.6 * fold) + 0.45 * amp * fold;

	// Knees out and feet splayed: the bow-legged stance of something that
	// stands on bent legs all the time.
	setSparse(out, bones[0], [hip, 0, 0.1 * side]);
	setSparse(out, bones[1], [knee, 0, 0]);
	setSparse(out, bones[2], [foot, 0.18 * side, -0.08 * side]);
}

/**
 * The shamble, and the stand it starts from.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full shamble
 * @param time  seconds, driving the breathing, the sway and the twitch
 */
export function shamblePose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);

	/*
	 * The breathing is ragged — a slow heave with a faster catch on top of
	 * it — and the head jerks rather than turns: a slow sine raised to a high
	 * odd power is nothing most of the time and a twitch for the rest.
	 */
	const breath = Math.sin(time * 1.7) + 0.3 * Math.sin(time * 5.1);
	const twitch = Math.pow(Math.sin(time * 1.3), 9) * still + 0.06 * amp * Math.sin(2 * theta + 0.8);
	const sway = Math.sin(time * 0.5) * still;

	/*
	 * The hips: crouched, lurching from side to side over each planted foot,
	 * and dipping twice a cycle as the weight comes onto each leg.
	 */
	const rootRot = ROOT_PITCH + 0.03 * amp * Math.cos(2 * theta);
	const roll = 0.07 * amp * sinT + 0.03 * sway;
	const rootY = GHOUL_CHAIN.hipHeight - CROUCH - 0.02 * amp * (1 - Math.cos(2 * theta));
	setSparse(
		out,
		'root',
		[rootRot, 0.08 * amp * sinT, roll],
		[0.035 * amp * sinT + 0.02 * sway, rootY - GHOUL_CHAIN.hipHeight, 0],
	);

	leg(out, ['hipL', 'shinL', 'footL'], theta, amp, 1, [rootY, 0], rootRot, roll);
	leg(out, ['hipR', 'shinR', 'footR'], theta + PI, amp, -1, [rootY, 0], rootRot, roll);

	// The bend: spine and chest over, neck and head back up, the chest
	// heaving and the shoulders rolling with the lurch.
	setSparse(out, 'spine', [SPINE_PITCH, -0.08 * amp * sinT, -0.02 * sway]);
	setSparse(out, 'chest', [CHEST_PITCH + 0.03 * breath, -0.1 * amp * sinT, 0.02 * breath]);
	setSparse(out, 'neck', [NECK_PITCH - 0.02 * breath, 0.1 * amp * sinT, 0.14]);
	setSparse(out, 'head', [HEAD_PITCH + 0.03 * sway, 0.35 * twitch + 0.12 * amp * sinT, 0.05 + 0.1 * twitch]);

	/*
	 * The arms hang out in front of the bend, swinging a little against the
	 * legs, elbows never quite straight, and the hands hanging off the wrists
	 * with the claws open and a tremor in them at the stand. An arm hangs in
	 * the chest's frame, and the chest is pitched forward by the whole bend,
	 * so hanging down and a little forward means taking that bend back out at
	 * the shoulder and adding the little.
	 */
	const bend = rootRot + SPINE_PITCH + CHEST_PITCH;
	const hang = -bend - 0.35;
	const swing = 0.22 * amp;
	const tremor = 0.05 * still * Math.sin(time * 9.3);
	setSparse(out, 'armL', [hang + swing * sinT + 0.02 * breath, 0.05, 0.28 + 0.03 * sway]);
	setSparse(out, 'armR', [hang - 0.06 - swing * sinT + 0.02 * breath, -0.05, -0.24 + 0.03 * sway]);
	setSparse(out, 'forearmL', [-0.45 - 0.15 * amp * Math.max(0, sinT), 0.1, 0.05]);
	setSparse(out, 'forearmR', [-0.55 - 0.15 * amp * Math.max(0, -sinT), -0.1, -0.05]);
	setSparse(out, 'handL', [-0.35 + tremor, 0, 0.15 + tremor]);
	setSparse(out, 'handR', [-0.45 - tremor, 0, -0.1 + tremor]);

	return out;
}
