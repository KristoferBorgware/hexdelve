/*
 * How the lemure holds itself, as pure functions.
 *
 * The same bargain as every other gait here: parameters in, a pose out, no
 * state and no renderer types. Two of them, because the thing has two modes:
 *
 *   waddlePose  the walk — and, at amp 0, the stand it walks from
 *   clawPose    the strike: it rears up with both arms drawn back and the
 *               mouth open, drops its whole weight forward onto a step, and
 *               rakes down with both hands
 *
 * A lemure is a larval demon, and it moves like something not finished: on
 * legs too short for the mass they carry, so every step is a heavy roll of
 * the pelvis onto the planted foot and a lurch of everything above it. The
 * belly is a bone of its own and lags the rest, so the sac heaves at the
 * stand and swings a beat behind the stride. The head has no neck and lolls
 * with the trunk; the jaw hangs open and works.
 *
 * Each foot is solved against the ground through the plane of the body, as
 * the ghoul's are, so however far the pelvis rolls a planted foot stays put.
 *
 * Sign conventions are the lemure rig's, which are the humanoid's: it faces
 * +Z, +X is its left; limb bones hang down, so rot.x < 0 swings one FORWARD;
 * the spine, chest and head point up, so rot.x > 0 tips them FORWARD; the jaw
 * points forward and the belly hangs forward, so rot.x > 0 opens the one and
 * drops the other; the tail points back, so rot.x > 0 lifts it; a foot's
 * rot.x > 0 points the toe DOWN; rot.y > 0 turns towards its own left.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink, type Planar } from './planar.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u: number): number => u * u * (3 - 2 * u);

type Euler = readonly [number, number, number];

/**
 * The rig the legs are solved on, copied from `lemure.rig.yaml` and pinned
 * to it by `test/assets.test.ts` — the same reason every gait here carries
 * a copy of what it was written against. Each entry is [y, z] of a bone's
 * offset from its parent, in the plane the gait is solved in.
 */
export const LEMURE_CHAIN = {
	hipHeight: 0.55,
	hip: [-0.06, 0] as const,
	hipWidth: 0.16,
	thigh: [-0.24, 0] as const,
	shin: [-0.19, 0] as const,
	spine: [0.18, 0] as const,
	chest: [0.22, 0] as const,
} as const;

/** Where the ankle sits with the sole on the ground: the depth of the flat foot. */
export const LEMURE_SOLE = 0.06;

/** How far out the knees are turned: bow-legged, under a body that wide. */
const SPLAY = 0.12;

/** The pelvis: where its root is in the plane, and its rotation. */
interface Trunk {
	readonly root: Planar;
	readonly rootRot: number;
}

/**
 * One leg, hip to foot, with the ankle put at `target` in the plane.
 *
 * The hip joint moves with the pelvis: it is turned with the root, and a
 * pelvis rolling lifts one hip and drops the other by the width of the
 * pelvis, which goes in as a change of height. The knee is solved ahead.
 * The foot takes out everything above it so the sole lies level, then is
 * turned out; in the air its toes drop.
 */
function leg(out: SparsePose, side: number, trunk: Trunk, roll: number, target: Planar, swing: number): void {
	const s = side > 0 ? 'L' : 'R';
	const hipAt = plus(
		plus(trunk.root, turn(LEMURE_CHAIN.hip, trunk.rootRot)),
		[side * LEMURE_CHAIN.hipWidth * Math.sin(roll), 0],
	);
	const [hip, knee] = twoLink(trunk.rootRot, hipAt, LEMURE_CHAIN.thigh, LEMURE_CHAIN.shin, target, -1);
	const level = -(trunk.rootRot + hip + knee);
	setSparse(out, `hip${s}`, [hip, 0, SPLAY * side]);
	setSparse(out, `shin${s}`, [knee, 0, 0]);
	setSparse(out, `foot${s}`, [level * (1 - 0.5 * swing) + 0.3 * swing, 0.25 * side, -0.05 * side]);
}

/** How far into its swing a foot at `phase` is, at this amp: 0 when standing. */
function swingOf(phase: number, amp: number): number {
	return Math.pow(Math.max(0, Math.cos(phase)), 0.8) * clamp01(amp);
}

/* ------------------------------------------------------------------ stand -- */

/**
 * The stand every strike starts from and comes back to, and the waddle at
 * amp 0 settles around: hunched over the sac, the knees a little bent, the
 * arms held out from the body and hanging, the mouth open.
 */
const STAND = {
	crouch: 0.03,
	root: 0.12,
	spine: 0.22,
	chest: 0.1,
	head: -0.15,
	jaw: 0.35,
	belly: 0.1,
	tail: 0.1,
} as const;

/** An arm hanging straight down under the hunched trunk, and a little forward. */
const HANG = -(STAND.root + STAND.spine + STAND.chest) - 0.15;

/* ----------------------------------------------------------------- waddle -- */

/** One stride pair, in seconds, at amp = 1: slow, on legs this short. */
export const WADDLE_PERIOD = 1.3;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const WADDLE_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** A short step, barely off the ground. */
const STEP = { restZ: 0.02, halfStride: 0.14, lift: 0.08 } as const;

/**
 * The waddle, and the stand it starts from.
 *
 * Walking, the pelvis rolls hard onto whichever foot is planted and the
 * trunk rolls half as far the other way to keep the head over the feet;
 * the body dips onto each footfall and the sac swings a beat behind the
 * stride. Standing, it heaves slowly, the sac heaving after the chest,
 * the head casting about, the jaw working, and twice in a cast of the
 * head the whole mass shudders.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full waddle
 * @param time  seconds, driving the stand
 */
export function waddlePose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	// Every rhythm in the stand is a multiple of one at 0.5 rad/s, so a
	// stand baked over that cycle closes on itself; and every one of them
	// is faded out with the stride, so a walk baked over its own cycle does.
	const breath = still * Math.sin(time * 1.0);
	const heave = still * Math.sin(time * 1.0 - 0.6);
	const shudder = Math.pow(Math.sin(time * 0.5), 12) * still;
	const cast = Math.sin(time * 0.5) * still;
	const chew = Math.max(0, Math.sin(time * 1.5)) * still;
	const twitch = Math.pow(Math.max(0, Math.sin(time * 1.5 + 1.0)), 7) * still;

	// The mass rides over whichever foot is planted — the left through the
	// middle of its stance, at theta = pi — and dips just after each lands.
	const over = -Math.cos(theta) * amp;
	const dip = (0.02 * amp * (1 + Math.cos(2 * theta - PI - 0.6))) / 2;
	const roll = 0.14 * over + 0.03 * shudder;
	const rootRot = STAND.root + 0.02 * amp * Math.cos(2 * theta);
	const rootY = LEMURE_CHAIN.hipHeight - STAND.crouch - dip - 0.008 * breath;
	setSparse(
		out,
		'root',
		[rootRot, -0.08 * amp * sinT, roll],
		[0.05 * over + 0.01 * shudder, rootY - LEMURE_CHAIN.hipHeight, 0],
	);
	const trunk: Trunk = { root: [rootY, 0], rootRot };

	for (const side of [1, -1] as const) {
		const phase = side > 0 ? theta : theta + PI;
		const target = groundPath(phase, STEP.restZ, STEP.halfStride, STEP.lift, LEMURE_SOLE, amp);
		leg(out, side, trunk, roll, target, swingOf(phase, amp));
	}

	// The trunk: hunched, rolling back against the pelvis, heaving.
	setSparse(out, 'spine', [STAND.spine + 0.02 * breath, 0.06 * amp * sinT, -0.5 * roll]);
	setSparse(out, 'chest', [STAND.chest + 0.03 * breath, 0.05 * amp * sinT, -0.2 * roll + 0.02 * shudder]);
	// The sac: heaving after the chest, swinging a beat behind the stride.
	setSparse(out, 'belly', [
		STAND.belly + 0.06 * heave + 0.08 * amp * Math.sin(2 * theta - 0.8),
		0.04 * amp * Math.sin(theta - 0.6),
		0.03 * shudder,
	]);
	// The head, with no neck to steady it: lolling with the roll, casting
	// about at the stand. The jaw hangs open and works.
	setSparse(out, 'head', [
		STAND.head + 0.03 * amp * Math.cos(2 * theta - 0.3) - 0.02 * breath,
		0.3 * cast + 0.1 * amp * sinT,
		0.3 * roll + 0.15 * cast,
	]);
	setSparse(out, 'jaw', [STAND.jaw + 0.2 * chew + 0.05 * amp * (1 - Math.cos(2 * theta)) + 0.05 * shudder, 0.05 * cast, 0]);

	// The arms held out from a body too wide to hang them past, swinging a
	// little against the legs, the hands hanging with the claws open, and
	// one of them twitching now and then at the stand.
	setSparse(out, 'armL', [HANG + 0.2 * amp * sinT + 0.03 * breath, 0.1, 0.55 + 0.03 * breath]);
	setSparse(out, 'armR', [HANG - 0.2 * amp * sinT + 0.03 * breath, -0.1, -0.55 - 0.03 * breath]);
	setSparse(out, 'forearmL', [-0.35 - 0.15 * amp * Math.max(0, -sinT) - 0.1 * twitch, 0.15, 0.1]);
	setSparse(out, 'forearmR', [-0.35 - 0.15 * amp * Math.max(0, sinT), -0.15, -0.1]);
	setSparse(out, 'handL', [-0.2 + 0.15 * twitch, 0, 0.1]);
	setSparse(out, 'handR', [-0.2, 0, -0.1]);
	// The tail stub swings against the roll.
	setSparse(out, 'tail', [STAND.tail + 0.05 * breath, 0.4 * roll, 0]);
	return out;
}

/* ------------------------------------------------------------------- claw -- */

/** How a segment arrives at its key: eased both ends, accelerating into it, or braking. */
type Ease = 'smooth' | 'in' | 'out';

/**
 * What the strike keys: the pelvis, the trunk, the arms, and where each
 * foot stands along the ground. The legs are not keyed; they are solved
 * from the pelvis to the feet, so the lurch can go as far as it likes and
 * the feet stay where they were put.
 */
interface Key {
	readonly t: number;
	readonly ease: Ease;
	readonly crouch: number;
	readonly shift: number;
	readonly root: number;
	readonly spine: number;
	readonly chest: number;
	readonly head: Euler;
	readonly jaw: number;
	readonly belly: number;
	readonly tail: number;
	readonly armL: Euler;
	readonly forearmL: Euler;
	readonly handL: Euler;
	readonly armR: Euler;
	readonly forearmR: Euler;
	readonly handR: Euler;
	/** Where each foot stands along the ground. */
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
	'head',
	'jaw',
	'belly',
	'tail',
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
	spine: STAND.spine,
	chest: STAND.chest,
	head: [STAND.head, 0, 0],
	jaw: STAND.jaw,
	belly: STAND.belly,
	tail: STAND.tail,
	armL: [HANG, 0.1, 0.55],
	forearmL: [-0.35, 0.15, 0.1],
	handL: [-0.2, 0, 0.1],
	armR: [HANG, -0.1, -0.55],
	forearmR: [-0.35, -0.15, -0.1],
	handR: [-0.2, 0, -0.1],
	footL: STEP.restZ,
	footR: STEP.restZ,
};

/** One key of the strike: its time, how it is arrived at, and what has changed since the last. */
type Step = { readonly t: number; readonly ease?: Ease } & Partial<Omit<Key, 't' | 'ease'>>;

/** The keys of the strike, each one the last with its changes laid over it. */
function keyed(steps: readonly Step[]): readonly Key[] {
	const keys: Key[] = [];
	let previous = REST;
	for (const step of steps) {
		const key: Key = { ...previous, ease: 'smooth', ...step };
		keys.push(key);
		previous = key;
	}
	return keys;
}

/** Every channel of a key, mutable, for the blend to write into. */
type Mixed = {
	-readonly [C in Channel]: Key[C] extends readonly [number, number, number] ? [number, number, number] : number;
};

const mixed: Mixed = {
	crouch: 0,
	shift: 0,
	root: 0,
	spine: 0,
	chest: 0,
	head: [0, 0, 0],
	jaw: 0,
	belly: 0,
	tail: 0,
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

/** The moment the claws come down, as a fraction of the strike. */
export const CLAW_HIT = 0.48;

/** The left arm's keys, mirrored for the right: y and z negated. */
const mirror = (arm: Euler): Euler => [arm[0], -arm[1], -arm[2]];

const CLAW = keyed([
	{ t: 0 },
	// Reared: up off the hunch, the sac drawn in, both arms swung back and
	// up over the head with the claws spread, the face up, the mouth wide.
	{
		t: 0.28,
		crouch: -0.02,
		shift: -0.04,
		root: 0.0,
		spine: -0.15,
		chest: -0.1,
		head: [-0.3, 0, 0],
		jaw: 0.7,
		belly: -0.1,
		tail: 0.4,
		armL: [2.7, 0.3, 0.7],
		forearmL: [-0.6, 0, 0],
		handL: [-0.5, 0, 0.3],
		armR: mirror([2.7, 0.3, 0.7]),
		forearmR: [-0.6, 0, 0],
		handR: mirror([-0.5, 0, 0.3]),
	},
	// The strike: the whole mass pitches forward and down onto a step, the
	// sac swinging after it, both arms swinging over and down with the
	// claws leading, the face held up on the target through all of it.
	// Accelerating into the key, so the claws are at full speed when they
	// land.
	{
		t: CLAW_HIT,
		ease: 'in',
		crouch: 0.12,
		shift: 0.16,
		root: 0.3,
		spine: 0.35,
		chest: 0.25,
		head: [-0.35, 0, 0],
		jaw: 0.9,
		belly: 0.25,
		tail: -0.2,
		armL: [-1.9, 0.1, 0.45],
		forearmL: [-0.3, 0, 0],
		handL: [0.3, 0, 0.2],
		armR: mirror([-1.9, 0.1, 0.45]),
		forearmR: [-0.3, 0, 0],
		handR: mirror([0.3, 0, 0.2]),
		footL: 0.18,
	},
	// Raked through: the claws dragged on down, the weight still coming.
	{
		t: 0.6,
		ease: 'out',
		crouch: 0.14,
		shift: 0.18,
		head: [-0.25, 0, 0],
		jaw: 0.7,
		armL: [-2.1, 0.1, 0.35],
		handL: [0.5, 0, 0.2],
		armR: mirror([-2.1, 0.1, 0.35]),
		handR: mirror([0.5, 0, 0.2]),
	},
	// Recovering: the arms coming back up, the trunk coming up off the lurch.
	{
		t: 0.8,
		crouch: 0.05,
		shift: 0.08,
		root: 0.15,
		spine: 0.25,
		chest: 0.12,
		head: [-0.1, 0, 0],
		jaw: 0.45,
		belly: 0.15,
		tail: 0.05,
		armL: [-0.8, 0.1, 0.55],
		forearmL: [-0.6, 0, 0],
		handL: [-0.2, 0, 0.1],
		armR: mirror([-0.8, 0.1, 0.55]),
		forearmR: [-0.6, 0, 0],
		handR: mirror([-0.2, 0, 0.1]),
	},
	// And the foot back, last.
	{ ...REST, t: 1 },
]);

/**
 * How high a foot is carried between two keys that stand it in different
 * places: an arc over the move, higher the further it goes, up to a step.
 */
function stepArc(from: number, to: number, w: number): number {
	const distance = Math.abs(to - from);
	if (distance < 1e-3) return 0;
	return 0.07 * Math.min(1, distance / 0.16) * Math.sin(PI * w);
}

/** The strike. @param u 0 standing, 1 back standing */
export function clawPose(u: number, out: SparsePose = {}): SparsePose {
	const t = clamp01(u);
	let i = 0;
	while (i < CLAW.length - 2 && t > CLAW[i + 1]!.t) i++;
	const a = CLAW[i]!;
	const b = CLAW[i + 1]!;
	const span = b.t - a.t;
	const raw = span > 1e-6 ? (t - a.t) / span : 0;
	const w = b.ease === 'in' ? raw * raw : b.ease === 'out' ? 1 - (1 - raw) * (1 - raw) : smooth(raw);
	const k = blend(a, b, w);

	const rootY = LEMURE_CHAIN.hipHeight - k.crouch;
	setSparse(out, 'root', [k.root, 0, 0], [0, -k.crouch, k.shift]);
	const trunk: Trunk = { root: [rootY, k.shift], rootRot: k.root };
	leg(out, 1, trunk, 0, [LEMURE_SOLE + stepArc(a.footL, b.footL, w), k.footL], 0);
	leg(out, -1, trunk, 0, [LEMURE_SOLE + stepArc(a.footR, b.footR, w), k.footR], 0);

	setSparse(out, 'spine', [k.spine, 0, 0]);
	setSparse(out, 'chest', [k.chest, 0, 0]);
	setSparse(out, 'head', k.head);
	setSparse(out, 'jaw', [k.jaw, 0, 0]);
	setSparse(out, 'belly', [k.belly, 0, 0]);
	setSparse(out, 'tail', [k.tail, 0, 0]);
	setSparse(out, 'armL', k.armL);
	setSparse(out, 'forearmL', k.forearmL);
	setSparse(out, 'handL', k.handL);
	setSparse(out, 'armR', k.armR);
	setSparse(out, 'forearmR', k.forearmR);
	setSparse(out, 'handR', k.handR);
	return out;
}
