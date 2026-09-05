/*
 * How the ghoul holds itself, as pure functions.
 *
 * The ghoul wears the wanderer's rig and none of the wanderer's animations. A
 * man walks upright with his legs under him; a ghoul goes bent double, the
 * spine folded over knees that never straighten, the head craned up off the
 * end of that fold to keep its eyes on whatever it is going towards, and the
 * arms hanging out ahead of it with the claws open. Two gaits, because a
 * creature built like that has two ways of moving:
 *
 *   shamblePose   the walk — and, at amp 0, the crouched stand it walks from
 *   scramblePose  the run, on all fours: the hands come down and it goes
 *                 like a dog, diagonal pairs, the spine flat along the ground
 *
 * Both are one function of a phase, as the hellhounds' gaits are: `amp`
 * throttles between standing and a full stride, and everything about the
 * stand — the sway, the ragged breathing, the twitch of the head, the tremor
 * in the hands — is faded in as the stride fades out. Every foot and, in the
 * scramble, every hand is solved against the ground through the plane of the
 * body, so however low the crouch drops a planted limb stays planted.
 *
 * The leap is not here. It has a beginning, a moment of contact and a
 * recovery, so it is a keyframed clip, `clips/leap.clip.yaml`, the same way
 * the wanderer's cut is.
 *
 * Sign conventions are the humanoid rig's: it faces +Z, +X is its left; limb
 * bones hang down, so rot.x < 0 swings one FORWARD; the spine, chest and head
 * point up, so rot.x > 0 tips them FORWARD; a foot's rot.x > 0 points the toe
 * DOWN; rot.y > 0 turns towards its own left. An arm hangs in the chest's
 * frame, so under a chest pitched forward by the whole bend of the spine, an
 * arm that hangs straight down has that bend taken back out at the shoulder.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { HUMANOID_CHAIN, solveArm, solveLeg, type Step, type Trunk } from './humanoid.js';
import { HUMANOID_SOLE } from './stride.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Where the ghoul's ankle and wrist sit with the sole and the palm on the
 * ground: the depth of its own foot and hand. The chain they are solved on
 * is the rig's, in humanoid.ts.
 */
export const GHOUL_SOLE = HUMANOID_SOLE;
export const GHOUL_PALM = 0.05;

/** How far out the ghoul turns its knees on each gait. */
interface Stance {
	readonly step: Step;
	readonly splay: number;
}

/**
 * One leg, hip to foot, with the foot put where the step says. Knees out and
 * feet splayed: the bow-legged stance of something that stands on bent legs
 * all the time. In the air the toes drag, pointing down.
 */
function leg(
	out: SparsePose,
	bones: readonly [string, string, string],
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
	roll: number,
	stance: Stance,
): void {
	const solved = solveLeg(phase, amp, side, trunk, roll, stance.step, GHOUL_SOLE);
	const foot = solved.level * (1 - 0.6 * solved.swing) + 0.45 * solved.swing;
	setSparse(out, bones[0], [solved.upper, 0, stance.splay * side]);
	setSparse(out, bones[1], [solved.lower, 0, 0]);
	setSparse(out, bones[2], [foot, 0.18 * side, -0.08 * side]);
}

/**
 * One arm, shoulder to hand, as a front leg. The hand is turned palm down
 * and laid flat with the fingers forward while it is planted; in the air it
 * hangs off the wrist and the fingers curl under.
 */
function arm(
	out: SparsePose,
	bones: readonly [string, string, string],
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
	step: Step,
): void {
	const solved = solveArm(phase, amp, trunk, step, GHOUL_PALM);
	setSparse(out, bones[0], [solved.upper, 0, 0.15 * side]);
	setSparse(out, bones[1], [solved.lower, 0, 0]);
	// Palm down: a quarter turn about the forearm, inwards.
	setSparse(out, bones[2], [solved.level + 0.9 * solved.swing, -side * (PI / 2), 0]);
}

/* ---------------------------------------------------------------- shamble -- */

/** One shuffling stride pair, in seconds, at amp = 1. */
export const SHAMBLE_PERIOD = 1.1;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const SHAMBLE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/**
 * The hunch, which is the same standing and walking: the hips dropped and
 * tipped, the spine and chest folded over them until the back is nearer
 * level than upright, the neck and head bent back up off the end.
 */
const HUNCH = { crouch: 0.22, root: 0.25, spine: 0.55, chest: 0.45, neck: -0.45, head: -0.5 };

/** A shuffle, not a step: short, and barely off the ground. */
const SHAMBLE_STANCE: Stance = { step: { restZ: 0, halfStride: 0.24, lift: 0.1 }, splay: 0.1 };

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
	 *
	 * Every rate here is a multiple of 0.85, and every one of them is faded out
	 * by the stride. Both of those are what let this be a clip. A cycle is
	 * played by wrapping a playhead at the duration it declares, so a rhythm
	 * that does not divide into that duration arrives back somewhere other than
	 * where it started and jumps; and a gait carrying a rhythm on a clock of
	 * its own could not close at any duration at all, since the stride and the
	 * breath would have to come round together. So the stand keeps the slow
	 * ones and the stride is a function of its phase and nothing else.
	 */
	const breath = still * (Math.sin(time * 1.7) + 0.3 * Math.sin(time * 5.1));
	const twitch = Math.pow(Math.sin(time * 2.55), 9) * still + 0.06 * amp * Math.sin(2 * theta + 0.8);
	const sway = Math.sin(time * 0.85) * still;

	/*
	 * The hips: crouched, lurching from side to side over each planted foot,
	 * and dipping twice a cycle as the weight comes onto each leg.
	 */
	const rootRot = HUNCH.root + 0.03 * amp * Math.cos(2 * theta);
	const roll = 0.07 * amp * sinT + 0.03 * sway;
	const rootY = HUMANOID_CHAIN.hipHeight - HUNCH.crouch - 0.02 * amp * (1 - Math.cos(2 * theta));
	const trunk: Trunk = {
		root: [rootY, 0],
		rootRot,
		spineRot: HUNCH.spine,
		chestRot: HUNCH.chest + 0.03 * breath,
	};
	setSparse(
		out,
		'root',
		[rootRot, 0.08 * amp * sinT, roll],
		[0.035 * amp * sinT + 0.02 * sway, rootY - HUMANOID_CHAIN.hipHeight, 0],
	);

	leg(out, ['hipL', 'shinL', 'footL'], theta, amp, 1, trunk, roll, SHAMBLE_STANCE);
	leg(out, ['hipR', 'shinR', 'footR'], theta + PI, amp, -1, trunk, roll, SHAMBLE_STANCE);

	// The fold: spine and chest over, neck and head back up, the chest
	// heaving and the shoulders rolling with the lurch.
	setSparse(out, 'spine', [trunk.spineRot, -0.08 * amp * sinT, -0.02 * sway]);
	setSparse(out, 'chest', [trunk.chestRot, -0.1 * amp * sinT, 0.02 * breath]);
	setSparse(out, 'neck', [HUNCH.neck - 0.02 * breath, 0.1 * amp * sinT, 0.14]);
	setSparse(out, 'head', [HUNCH.head + 0.03 * sway, 0.35 * twitch + 0.12 * amp * sinT, 0.05 + 0.1 * twitch]);

	/*
	 * The arms hang out ahead of the fold, swinging a little against the legs,
	 * elbows never quite straight, and the hands hanging off the wrists with
	 * the palms turned in, the claws open, and a tremor in them at the stand.
	 */
	const hang = -(rootRot + trunk.spineRot + trunk.chestRot) - 0.3;
	const swing = 0.25 * amp;
	const tremor = 0.05 * still * Math.sin(time * 4.25);
	setSparse(out, 'armL', [hang + swing * sinT + 0.02 * breath, 0.05, 0.28 + 0.03 * sway]);
	setSparse(out, 'armR', [hang - 0.06 - swing * sinT + 0.02 * breath, -0.05, -0.24 + 0.03 * sway]);
	setSparse(out, 'forearmL', [-0.5 - 0.15 * amp * Math.max(0, sinT), 0.1, 0.05]);
	setSparse(out, 'forearmR', [-0.6 - 0.15 * amp * Math.max(0, -sinT), -0.1, -0.05]);
	setSparse(out, 'handL', [-0.4 + tremor, -0.35, 0.1 + tremor]);
	setSparse(out, 'handR', [-0.45 - tremor, 0.35, -0.1 + tremor]);

	return out;
}

/* --------------------------------------------------------------- scramble -- */

/** One stride pair of the scramble, in seconds, at amp = 1. */
export const SCRAMBLE_PERIOD = 0.6;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const SCRAMBLE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/**
 * The crawl: hips dropped to under half their standing height and the spine
 * folded until the back lies along the ground, the head up off the front of
 * it. That low, because the arms are a third shorter than the legs and have
 * to reach the ground from the shoulders through the whole stance.
 */
const CRAWL = { crouch: 0.56, root: 0.55, spine: 0.5, chest: 0.35, neck: -0.65, head: -0.6 };

/** Feet under the hips, hands out ahead under the shoulders. */
const CRAWL_STANCE: Stance = { step: { restZ: -0.02, halfStride: 0.28, lift: 0.14 }, splay: 0.3 };
const CRAWL_HAND: Step = { restZ: 0.46, halfStride: 0.2, lift: 0.12 };

/**
 * The scramble: on all fours, diagonal pairs — the left foot with the right
 * hand, the right foot with the left hand — half a cycle apart, the way a
 * dog trots. Diagonal rather than bounding because the two feet then
 * alternate, which is what the rig's pair of feet measures a ground speed
 * off; a bound lands both feet together and reads as standing still.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = crouched on all fours, 1 = a full scramble
 * @param time  seconds, driving the breathing at the crouch
 */
export function scramblePose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const breath = Math.sin(time * 2.1);

	// The body drops onto each diagonal pair as it lands, twice a cycle, and
	// the spine works with it, humping as a pair swings under and flattening
	// as it drives.
	const dip = 0.025 * amp * (1 - Math.cos(2 * theta));
	const hump = 0.06 * amp * Math.cos(2 * theta);
	const rootRot = CRAWL.root - hump;
	const trunk: Trunk = {
		root: [HUMANOID_CHAIN.hipHeight - CRAWL.crouch - dip, 0],
		rootRot,
		spineRot: CRAWL.spine + hump,
		chestRot: CRAWL.chest + 0.5 * hump + 0.02 * still * breath,
	};
	setSparse(
		out,
		'root',
		[rootRot, 0.05 * amp * sinT, 0.04 * amp * sinT],
		[0.02 * amp * sinT, trunk.root[0] - HUMANOID_CHAIN.hipHeight, 0],
	);
	setSparse(out, 'spine', [trunk.spineRot, -0.04 * amp * sinT, 0]);
	setSparse(out, 'chest', [trunk.chestRot, -0.06 * amp * sinT, 0]);

	leg(out, ['hipL', 'shinL', 'footL'], theta, amp, 1, trunk, 0, CRAWL_STANCE);
	leg(out, ['hipR', 'shinR', 'footR'], theta + PI, amp, -1, trunk, 0, CRAWL_STANCE);
	arm(out, ['armR', 'forearmR', 'handR'], theta, amp, -1, trunk, CRAWL_HAND);
	arm(out, ['armL', 'forearmL', 'handL'], theta + PI, amp, 1, trunk, CRAWL_HAND);

	// The head up off the front of the fold, eyes ahead, bobbing with the
	// stride and casting about at the crouch.
	const cast = Math.sin(time * 0.9) * still;
	setSparse(out, 'neck', [CRAWL.neck - 0.03 * amp * Math.cos(2 * theta), 0.1 * cast, 0.1]);
	setSparse(out, 'head', [
		CRAWL.head - 0.04 * amp * Math.cos(2 * theta),
		0.2 * cast + 0.06 * amp * sinT,
		0.04,
	]);

	return out;
}
