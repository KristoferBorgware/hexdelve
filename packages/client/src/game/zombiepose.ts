/*
 * How the zombie holds itself, as a pure function.
 *
 * A corpse walking. It wears the wanderer's rig, and what it does with it is
 * what is left of a walk once the mind has gone: one leg steps and the other
 * is dragged after it, the weight thrown from side to side to get each one
 * forward, the trunk slumped, the head thrust forward and hanging off to one
 * side, and both arms out ahead of it, reaching, the hands hooked into claws
 * that never stop closing on whatever is in front of them.
 *
 * One function, as the ghoul's gaits are: `amp` throttles between standing
 * and the full shuffle, and the stand is the same slump swaying on its
 * feet, since a corpse does not breathe and does not settle. Both feet are
 * solved against the ground through the plane of the body — see humanoid.ts,
 * which owns the chain — so the dragged foot, which is carried barely off
 * the ground, lands where it is meant to rather than through the floor.
 *
 * The overhead slash is not here. It has a beginning, a moment of contact
 * and a recovery, so it is a keyframed clip, `clips/overhead.clip.yaml`, the
 * same way the wanderer's cut is.
 *
 * Sign conventions are the humanoid rig's: it faces +Z, +X is its left; limb
 * bones hang down, so rot.x < 0 swings one FORWARD; the spine, chest and head
 * point up, so rot.x > 0 tips them FORWARD; a foot's rot.x > 0 points the toe
 * DOWN; rot.y > 0 turns towards its own left, rot.z > 0 tips towards it.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { HUMANOID_CHAIN, solveLeg, type Step, type Trunk } from './humanoid.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where the zombie's ankle sits with the sole on the ground: a boot's depth. */
export const ZOMBIE_SOLE = 0.1;

/** One shuffling stride pair, in seconds, at amp = 1. Slow. */
export const SHUFFLE_PERIOD = 1.7;

/** Where in the cycle (0..1) the good foot and then the dragged foot land. */
export const SHUFFLE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/**
 * The slump it stands and walks in: hips a little dropped and tipped, the
 * spine and chest sagging forward over them, the head hanging.
 */
const SLUMP = { crouch: 0.06, root: 0.06, spine: 0.18, chest: 0.22, neck: 0.32, head: -0.12 };

/** The good leg steps, short. The bad leg is dragged, barely off the ground. */
const GOOD_STEP: Step = { restZ: 0, halfStride: 0.2, lift: 0.07 };
const BAD_STEP: Step = { restZ: -0.03, halfStride: 0.2, lift: 0.02 };

/**
 * The shuffle, and the stand it starts from.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = the full shuffle
 * @param time  seconds, driving the sway and the roll of the head
 */
export function shufflePose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const sway = Math.sin(time * 0.7) * still;
	// The head hangs to its right and rolls there, slowly.
	const loll = -0.2 - 0.08 * Math.sin(time * 0.7 + 1);

	/*
	 * The hips: a lurch from side to side that throws the weight over each
	 * foot in turn, which is how a leg that will not bend gets dragged
	 * forward, and a dip as it comes down on each.
	 */
	const rootRot = SLUMP.root + 0.02 * amp * Math.cos(2 * theta);
	const roll = 0.09 * amp * sinT + 0.03 * sway;
	const rootY = HUMANOID_CHAIN.hipHeight - SLUMP.crouch - 0.015 * amp * (1 - Math.cos(2 * theta));
	const trunk: Trunk = {
		root: [rootY, 0],
		rootRot,
		spineRot: SLUMP.spine + 0.02 * sway,
		chestRot: SLUMP.chest,
	};
	setSparse(
		out,
		'root',
		[rootRot, 0.06 * amp * sinT, roll],
		[0.04 * amp * sinT + 0.015 * sway, rootY - HUMANOID_CHAIN.hipHeight, 0],
	);

	// The good leg, left: a short step, the toe dropping in the air.
	const left = solveLeg(theta, amp, 1, trunk, roll, GOOD_STEP, ZOMBIE_SOLE);
	setSparse(out, 'hipL', [left.upper, 0, 0.04]);
	setSparse(out, 'shinL', [left.lower, 0, 0]);
	setSparse(out, 'footL', [left.level * (1 - 0.5 * left.swing) + 0.4 * left.swing, 0.05, -0.03]);

	// The bad leg, right: turned out at the hip, dragged with the sole
	// nearly flat so the toes scrape.
	const right = solveLeg(theta + PI, amp, -1, trunk, roll, BAD_STEP, ZOMBIE_SOLE);
	setSparse(out, 'hipR', [right.upper, 0, -0.1]);
	setSparse(out, 'shinR', [right.lower, 0, 0]);
	setSparse(out, 'footR', [right.level * (1 - 0.2 * right.swing) + 0.1 * right.swing, -0.25, 0.05]);

	/*
	 * The trunk sags and rolls against the hips. The head is thrust forward
	 * off the slump and hangs to one side, snapping forward a little as each
	 * foot comes down and turning slowly when it stands.
	 */
	const snap = 0.06 * amp * Math.max(0, Math.cos(2 * theta));
	setSparse(out, 'spine', [trunk.spineRot, -0.04 * amp * sinT, -0.05 * amp * sinT - 0.02 * sway]);
	setSparse(out, 'chest', [trunk.chestRot, -0.05 * amp * sinT, 0.03 * sway]);
	setSparse(out, 'neck', [SLUMP.neck + snap, 0.05 * sway, -0.08]);
	setSparse(out, 'head', [
		SLUMP.head + snap + 0.05 * Math.sin(time * 0.4),
		0.15 * Math.sin(time * 0.3) * still + 0.08 * amp * sinT,
		loll,
	]);

	/*
	 * The arms, both out ahead of it and reaching: the right higher than the
	 * left, the elbows bent so the forearms come up towards whatever is in
	 * front, and each hand held level with its palm turned down over it, so
	 * the hooked fingers point at it. The reach rises and falls slowly and
	 * the hands paw, out of step with each other, which is the whole of its
	 * intent.
	 *
	 * An arm hangs in the chest's frame, so the slump is taken back out at
	 * the shoulder before either is pointed anywhere; and a hand held level
	 * takes out everything above it and a quarter turn more, then turns
	 * inwards about the forearm by a quarter turn to put the palm down.
	 */
	const bend = rootRot + trunk.spineRot + trunk.chestRot;
	const reach = 0.08 * Math.sin(time * 0.5);
	const armR = -bend - 1.4 - reach + 0.06 * amp * sinT;
	const armL = -bend - 1.1 + reach - 0.06 * amp * sinT;
	const forearmR = -0.55;
	const forearmL = -0.65;
	const level = (arm: number, forearm: number): number => -PI / 2 - (bend + arm + forearm);
	const pawR = 0.2 * Math.sin(time * 0.9);
	const pawL = 0.2 * Math.sin(time * 0.9 + 2.1);
	setSparse(out, 'armR', [armR, -0.15, -0.15]);
	setSparse(out, 'forearmR', [forearmR, 0, 0]);
	setSparse(out, 'handR', [level(armR, forearmR) + pawR, PI / 2, -0.1]);
	setSparse(out, 'armL', [armL, 0.15, 0.12 + 0.02 * sway]);
	setSparse(out, 'forearmL', [forearmL, 0, 0]);
	setSparse(out, 'handL', [level(armL, forearmL) + pawL, -PI / 2, 0.1]);

	return out;
}
