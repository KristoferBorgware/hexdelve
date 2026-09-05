/*
 * How the mummified human holds itself, as pure functions.
 *
 * A corpse walking, as the zombie is, on the same rig — but dried and bound
 * rather than rotting, and everything it does comes out of that. The
 * wrappings hold it: the legs barely bend, the trunk is a plank, the head is
 * fixed on it, and the arms are held out stiff and straight ahead at the
 * height of a throat with the hands hanging open over it, which is what it
 * is walking towards. Three functions:
 *
 *   trudgePose  the walk — and, at amp 0, the stand it walks from
 *   graspPose   the strike: the arms drawn back and out, then driven out
 *               straight with the body lunging in behind them and the hands
 *               closing on what is there
 *   cloutPose   the other: the right arm swung out stiff to the side and
 *               round level through the target, the trunk turning with it
 *
 * Both feet are solved against the ground through the plane of the body —
 * see humanoid.ts, which owns the chain — so the scraping foot, carried a
 * finger's width off the ground, lands where it is meant to. A strike keys
 * where the pelvis is and where each foot stands, and solves the leg
 * between, so the lunge can go as far as it likes and the feet stay put.
 *
 * Sign conventions are the humanoid rig's: it faces +Z, +X is its left; limb
 * bones hang down, so rot.x < 0 swings one FORWARD; the spine, chest and head
 * point up, so rot.x > 0 tips them FORWARD; a foot's rot.x > 0 points the toe
 * DOWN; rot.y > 0 turns towards its own left, rot.z > 0 tips towards it. A
 * rotation is Euler XYZ with Z applied first, so an arm's rot.z lifts it out
 * sideways and its rot.y then sweeps the lifted arm round the body.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { HUMANOID_CHAIN, solveLeg, type Step, type Trunk } from './humanoid.js';
import { plus, turn, twoLink, type Planar } from './planar.js';
import { HUMANOID_SOLE } from './stride.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u: number): number => u * u * (3 - 2 * u);

type Euler = readonly [number, number, number];

/** Where the mummy's ankle sits with the sole on the ground: a wrapped foot's depth. */
export const MUMMY_SOLE = HUMANOID_SOLE;

/** One stride pair, in seconds, at amp = 1. Slow: it does not hurry. */
export const TRUDGE_PERIOD = 1.7;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const TRUDGE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** A short, flat step: the foot barely leaves the ground. */
const TRUDGE_STEP: Step = { restZ: 0, halfStride: 0.2, lift: 0.03 };

/**
 * How it stands and walks: nearly straight-legged, the trunk a little
 * forward, the head level on it, the feet turned out.
 */
const STAND = { crouch: 0.045, root: 0.02, spine: 0.05, chest: 0.05, neck: 0.04, head: -0.06, toeOut: 0.1 } as const;

/** The arms held out ahead: how far below level they point, and how far apart. */
const REACH = { drop: 0.08, apart: 0.06 } as const;

/** The trunk's bend at the stand, which an arm out ahead has to take back out at the shoulder. */
const BEND = STAND.root + STAND.spine + STAND.chest;

/** An arm out ahead at the stand, in the chest's frame. */
const AHEAD = -PI / 2 - BEND + REACH.drop;

/** The forearm: straight, near enough. */
const FOREARM = -0.05;

/**
 * The rotation a hand needs to hang level, pointing forward: everything
 * above it taken out, and a quarter turn more. Its rot.y then turns it about
 * the forearm to put the palm down.
 */
const handLevel = (bend: number, arm: number): number => -PI / 2 - (bend + arm + FOREARM);

/** A hand at the stand. */
const HAND_LEVEL = handLevel(BEND, AHEAD);

/* ----------------------------------------------------------------- trudge -- */

/**
 * The trudge, and the stand it starts from.
 *
 * Walking, the hips lurch from side to side to swing each stiff leg through,
 * and dip as each foot comes down; the trunk turns a little against them,
 * and the arms, held out ahead, bob with the steps. Standing, it sways
 * slowly on its feet, the arms drift up and down against each other, the
 * head tilts, and once a cycle a shudder runs through it.
 *
 * Every rhythm in the stand is a multiple of one at 0.6 rad/s, so a stand
 * baked over that cycle closes on itself, and every one is zero at the
 * start of it, so a strike, which ends in the stand at rest, ends where the
 * stand begins. Every one fades out with the stride, so a walk baked over
 * its own cycle closes too.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = the full trudge
 * @param time  seconds, driving the stand
 */
export function trudgePose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const cos2 = Math.cos(2 * theta);

	const sway = still * Math.sin(time * 0.6);
	const tilt = still * Math.sin(time * 1.2);
	const drift = still * Math.sin(time * 1.8);
	const shudder = Math.pow(Math.max(0, Math.sin(time * 0.6 - 2.5)), 8) * Math.sin(time * 6) * still;

	// The hips: a lurch from side to side that throws the weight over each
	// foot in turn, which is how a leg that will not bend gets swung
	// forward, and a dip as it comes down on each.
	const rootRot = STAND.root + 0.01 * amp * cos2;
	const roll = 0.07 * amp * sinT + 0.03 * sway;
	const rootY = HUMANOID_CHAIN.hipHeight - STAND.crouch - 0.01 * amp * (1 - cos2);
	const trunk: Trunk = {
		root: [rootY, 0],
		rootRot,
		spineRot: STAND.spine + 0.01 * sway,
		chestRot: STAND.chest,
	};
	setSparse(
		out,
		'root',
		[rootRot, 0.04 * amp * sinT, roll],
		[0.03 * amp * sinT + 0.012 * sway, rootY - HUMANOID_CHAIN.hipHeight, 0],
	);

	// Each leg: stiff, the foot scraping, the toes staying down through the swing.
	for (const side of [1, -1] as const) {
		const s = side > 0 ? 'L' : 'R';
		const leg = solveLeg(side > 0 ? theta : theta + PI, amp, side, trunk, roll, TRUDGE_STEP, MUMMY_SOLE);
		setSparse(out, `hip${s}`, [leg.upper, 0, side * 0.03]);
		setSparse(out, `shin${s}`, [leg.lower, 0, 0]);
		setSparse(out, `foot${s}`, [leg.level * (1 - 0.3 * leg.swing) + 0.25 * leg.swing, side * STAND.toeOut, -side * 0.02]);
	}

	// The trunk: a plank, turning a little against the hips and tilting with
	// the sway; the head fixed on it, tilting slowly, shuddering.
	setSparse(out, 'spine', [trunk.spineRot, -0.03 * amp * sinT, -0.02 * amp * sinT - 0.015 * sway]);
	setSparse(out, 'chest', [trunk.chestRot, -0.03 * amp * sinT, 0.02 * sway]);
	setSparse(out, 'neck', [STAND.neck, 0, 0]);
	setSparse(out, 'head', [STAND.head + 0.02 * amp * Math.cos(2 * theta - 0.5), 0.04 * shudder + 0.03 * amp * sinT, 0.06 * tilt]);

	// The arms: out ahead and stiff, drifting up and down against each other
	// at the stand and bobbing together with the steps, the hands hanging
	// open with the palms down.
	const bend = rootRot + trunk.spineRot + trunk.chestRot;
	const ahead = -PI / 2 - bend + REACH.drop;
	const armL = ahead + 0.03 * drift + 0.02 * sway - 0.03 * amp * cos2;
	const armR = ahead - 0.03 * drift - 0.02 * sway - 0.03 * amp * cos2;
	setSparse(out, 'armL', [armL, 0.03 * sway, REACH.apart]);
	setSparse(out, 'forearmL', [FOREARM, 0, 0]);
	setSparse(out, 'handL', [handLevel(bend, armL) + 0.15 * shudder, -PI / 2, 0.05]);
	setSparse(out, 'armR', [armR, 0.03 * sway, -REACH.apart]);
	setSparse(out, 'forearmR', [FOREARM, 0, 0]);
	setSparse(out, 'handR', [handLevel(bend, armR) - 0.15 * shudder, PI / 2, -0.05]);
	return out;
}

/* ---------------------------------------------------------------- strikes -- */

/** How a segment arrives at its key: eased both ends, accelerating into it, or braking. */
type Ease = 'smooth' | 'in' | 'out';

/**
 * What a strike keys: the pelvis, the trunk, the arms, and where each foot
 * stands along the ground. The legs are not keyed; they are solved from the
 * pelvis to the feet.
 */
interface Key {
	readonly t: number;
	readonly ease: Ease;
	readonly crouch: number;
	readonly shift: number;
	readonly root: number;
	readonly spine: Euler;
	readonly chest: Euler;
	readonly neck: Euler;
	readonly head: Euler;
	readonly armL: Euler;
	readonly forearmL: Euler;
	readonly handL: Euler;
	readonly armR: Euler;
	readonly forearmR: Euler;
	readonly handR: Euler;
	readonly footL: number;
	readonly footR: number;
}

type Channel = Exclude<keyof Key, 't' | 'ease'>;

const CHANNELS: readonly Channel[] = [
	'crouch',
	'shift',
	'root',
	'spine',
	'chest',
	'neck',
	'head',
	'armL',
	'forearmL',
	'handL',
	'armR',
	'forearmR',
	'handR',
	'footL',
	'footR',
];

const REST: Key = {
	t: 0,
	ease: 'smooth',
	crouch: STAND.crouch,
	shift: 0,
	root: STAND.root,
	spine: [STAND.spine, 0, 0],
	chest: [STAND.chest, 0, 0],
	neck: [STAND.neck, 0, 0],
	head: [STAND.head, 0, 0],
	armL: [AHEAD, 0, REACH.apart],
	forearmL: [FOREARM, 0, 0],
	handL: [HAND_LEVEL, -PI / 2, 0.05],
	armR: [AHEAD, 0, -REACH.apart],
	forearmR: [FOREARM, 0, 0],
	handR: [HAND_LEVEL, PI / 2, -0.05],
	footL: 0,
	footR: 0,
};

/** One key of a strike: its time, how it is arrived at, and what has changed since the last. */
type Step_ = { readonly t: number; readonly ease?: Ease } & Partial<Omit<Key, 't' | 'ease'>>;

/** The keys of a strike, each one the last with its changes laid over it. */
function keyed(steps: readonly Step_[]): readonly Key[] {
	const keys: Key[] = [];
	let previous = REST;
	for (const step of steps) {
		const key: Key = { ...previous, ease: 'smooth', ...step };
		keys.push(key);
		previous = key;
	}
	return keys;
}

/** The stand again, at `t`: every channel back where it started. */
const rest = (t: number): Step_ => ({ ...REST, t });

/** Every channel of a key, mutable, for the blend to write into. */
type Mixed = {
	-readonly [C in Channel]: Key[C] extends readonly [number, number, number] ? [number, number, number] : number;
};

const mixed: Mixed = {
	crouch: 0,
	shift: 0,
	root: 0,
	spine: [0, 0, 0],
	chest: [0, 0, 0],
	neck: [0, 0, 0],
	head: [0, 0, 0],
	armL: [0, 0, 0],
	forearmL: [0, 0, 0],
	handL: [0, 0, 0],
	armR: [0, 0, 0],
	forearmR: [0, 0, 0],
	handR: [0, 0, 0],
	footL: 0,
	footR: 0,
};

function blend(a: Key, b: Key, w: number): Mixed {
	const into = mixed as Record<Channel, number | number[]>;
	for (const channel of CHANNELS) {
		const from = a[channel] as number | readonly number[];
		const to = b[channel] as number | readonly number[];
		if (typeof from === 'number') {
			into[channel] = from + ((to as number) - from) * w;
		} else {
			const target = into[channel] as number[];
			for (let i = 0; i < from.length; i++) target[i] = from[i]! + ((to as readonly number[])[i]! - from[i]!) * w;
		}
	}
	return mixed;
}

/**
 * How high a foot is carried between two keys that stand it in different
 * places: a low arc over the move, since this is a foot that scrapes.
 */
function stepArc(from: number, to: number, w: number): number {
	const distance = Math.abs(to - from);
	if (distance < 1e-3) return 0;
	return 0.04 * Math.min(1, distance / 0.3) * Math.sin(PI * w);
}

/**
 * One leg, hip to foot, with the ankle put at `target` in the plane, solved
 * from wherever the pelvis is; the foot takes out everything above it so
 * the sole lies level, and is turned out.
 */
function legTo(out: SparsePose, side: number, trunk: Trunk, target: Planar): void {
	const s = side > 0 ? 'L' : 'R';
	const hipAt = plus(trunk.root, turn(HUMANOID_CHAIN.hip, trunk.rootRot));
	const [hip, knee] = twoLink(trunk.rootRot, hipAt, HUMANOID_CHAIN.thigh, HUMANOID_CHAIN.shin, target, -1);
	setSparse(out, `hip${s}`, [hip, 0, side * 0.03]);
	setSparse(out, `shin${s}`, [knee, 0, 0]);
	setSparse(out, `foot${s}`, [-(trunk.rootRot + hip + knee), side * STAND.toeOut, -side * 0.02]);
}

/** A strike at `u`, 0 standing to 1 standing again. */
function strike(keys: readonly Key[], u: number, out: SparsePose): SparsePose {
	const t = clamp01(u);
	let i = 0;
	while (i < keys.length - 2 && t > keys[i + 1]!.t) i++;
	const a = keys[i]!;
	const b = keys[i + 1]!;
	const span = b.t - a.t;
	const raw = span > 1e-6 ? (t - a.t) / span : 0;
	const w = b.ease === 'in' ? raw * raw : b.ease === 'out' ? 1 - (1 - raw) * (1 - raw) : smooth(raw);
	const k = blend(a, b, w);

	const rootY = HUMANOID_CHAIN.hipHeight - k.crouch;
	setSparse(out, 'root', [k.root, 0, 0], [0, -k.crouch, k.shift]);
	const trunk: Trunk = { root: [rootY, k.shift], rootRot: k.root, spineRot: k.spine[0], chestRot: k.chest[0] };
	legTo(out, 1, trunk, [MUMMY_SOLE + stepArc(a.footL, b.footL, w), k.footL]);
	legTo(out, -1, trunk, [MUMMY_SOLE + stepArc(a.footR, b.footR, w), k.footR]);

	setSparse(out, 'spine', k.spine);
	setSparse(out, 'chest', k.chest);
	setSparse(out, 'neck', k.neck);
	setSparse(out, 'head', k.head);
	setSparse(out, 'armL', k.armL);
	setSparse(out, 'forearmL', k.forearmL);
	setSparse(out, 'handL', k.handL);
	setSparse(out, 'armR', k.armR);
	setSparse(out, 'forearmR', k.forearmR);
	setSparse(out, 'handR', k.handR);
	return out;
}

/* ------------------------------------------------------------------ grasp -- */

/** The moment the hands close, as a fraction of the grasp. */
export const GRASP_HIT = 0.5;

const GRASP = keyed([
	{ t: 0 },
	// Drawn: the trunk leaning back a little, the arms drawn back and out
	// with the hands open wide, the head coming up.
	{
		t: 0.3,
		crouch: 0.06,
		shift: -0.08,
		root: -0.02,
		spine: [-0.08, 0, 0],
		chest: [-0.1, 0, 0],
		neck: [0, 0, 0],
		head: [-0.12, 0, 0],
		armL: [-1.25, 0.1, 0.45],
		forearmL: [-0.15, 0, 0],
		handL: [-0.4, -PI / 2, 0.15],
		armR: [-1.25, -0.1, -0.45],
		forearmR: [-0.15, 0, 0],
		handR: [-0.4, PI / 2, -0.15],
	},
	// The grasp: the left foot steps in and the body lunges after it, the
	// trunk folding forward and the arms driving out straight ahead of it
	// at the height of a throat, the hands closing. Accelerating into the
	// key, so the hands are at full speed when they close.
	{
		t: GRASP_HIT,
		ease: 'in',
		crouch: 0.1,
		shift: 0.3,
		root: 0.1,
		spine: [0.22, 0, 0],
		chest: [0.18, 0, 0],
		neck: [0.05, 0, 0],
		head: [0.05, 0, 0],
		armL: [-2.05, 0.05, 0.1],
		forearmL: [-0.02, 0, 0],
		handL: [0.35, -PI / 2, 0.05],
		armR: [-2.05, -0.05, -0.1],
		forearmR: [-0.02, 0, 0],
		handR: [0.35, PI / 2, -0.05],
		footL: 0.32,
	},
	// Held: the hands squeezing together, the weight still coming.
	{
		t: 0.64,
		ease: 'out',
		crouch: 0.11,
		shift: 0.34,
		head: [0.08, 0, 0],
		armL: [-2.08, 0.1, 0.04],
		handL: [0.45, -PI / 2, 0.05],
		armR: [-2.08, -0.1, -0.04],
		handR: [0.45, PI / 2, -0.05],
	},
	// Recovering: straightening, the arms coming back to the reach.
	{
		t: 0.84,
		crouch: 0.05,
		shift: 0.1,
		root: STAND.root,
		spine: [STAND.spine, 0, 0],
		chest: [STAND.chest, 0, 0],
		neck: [STAND.neck, 0, 0],
		head: [STAND.head, 0, 0],
		armL: [AHEAD - 0.1, 0, REACH.apart + 0.05],
		forearmL: [FOREARM, 0, 0],
		handL: [HAND_LEVEL + 0.1, -PI / 2, 0.05],
		armR: [AHEAD - 0.1, 0, -REACH.apart - 0.05],
		forearmR: [FOREARM, 0, 0],
		handR: [HAND_LEVEL + 0.1, PI / 2, -0.05],
	},
	// And the foot back, last.
	rest(1),
]);

/** The grasp. @param u 0 standing, 1 back standing */
export function graspPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(GRASP, u, out);
}

/* ------------------------------------------------------------------ clout -- */

/** The moment the back of the hand comes through the target, as a fraction of the clout. */
export const CLOUT_HIT = 0.5;

const CLOUT = keyed([
	{ t: 0 },
	// Wound: the trunk turned to its right, the right arm swung out stiff to
	// the side and back, the left staying out ahead; the head on the target.
	{
		t: 0.3,
		crouch: 0.06,
		shift: -0.05,
		root: 0.03,
		spine: [0.05, -0.25, 0.03],
		chest: [0.05, -0.3, 0.03],
		neck: [0, 0.15, 0],
		head: [-0.06, 0.25, 0],
		armR: [0, -0.5, -1.4],
		forearmR: [-0.02, 0, 0],
		handR: [0, PI / 2, 0],
		armL: [AHEAD + 0.1, 0.15, 0.2],
	},
	// Through: the trunk turning through to its left and the arm coming
	// round with it, stiff and level, the back of the hand through the
	// target ahead; the left foot stepping in. Accelerating into the key.
	{
		t: CLOUT_HIT,
		ease: 'in',
		crouch: 0.08,
		shift: 0.2,
		root: 0.08,
		spine: [0.12, 0.2, -0.02],
		chest: [0.12, 0.28, -0.02],
		neck: [0, -0.1, 0],
		head: [0.02, -0.15, 0],
		armR: [0, 1.0, -1.45],
		forearmR: [-0.02, 0, 0],
		handR: [0, PI / 2, 0],
		armL: [AHEAD - 0.2, 0.1, 0.35],
		footL: 0.25,
	},
	// Follow-through: the arm carried on across to the left, the trunk after it.
	{
		t: 0.62,
		ease: 'out',
		crouch: 0.09,
		shift: 0.22,
		spine: [0.12, 0.35, -0.03],
		chest: [0.12, 0.42, -0.03],
		neck: [0, -0.2, 0],
		head: [0.02, -0.25, 0],
		armR: [0, 1.7, -1.4],
		armL: [AHEAD - 0.3, 0.05, 0.45],
	},
	// Recovering: turning back square, the arm coming down and round to the reach.
	{
		t: 0.84,
		crouch: 0.05,
		shift: 0.08,
		root: STAND.root,
		spine: [STAND.spine, 0.1, 0],
		chest: [STAND.chest, 0.1, 0],
		neck: [STAND.neck, 0, 0],
		head: [STAND.head, 0, 0],
		armR: [AHEAD + 0.3, 0.3, -0.6],
		forearmR: [FOREARM, 0, 0],
		handR: [HAND_LEVEL, PI / 2, -0.05],
		armL: [AHEAD, 0, REACH.apart + 0.1],
	},
	// And the foot back, last.
	rest(1),
]);

/** The clout. @param u 0 standing, 1 back standing */
export function cloutPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(CLOUT, u, out);
}
