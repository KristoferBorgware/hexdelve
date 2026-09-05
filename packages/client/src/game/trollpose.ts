/*
 * How the troll holds itself, as pure functions.
 *
 * The same bargain as every other gait here: parameters in, a pose out, no
 * state and no renderer types. Five of them, because the animal has five
 * things it does:
 *
 *   stompPose  the walk — and, at amp 0, the stand it walks from
 *   smashPose  the crushing blow: back on the heels with the club swung up
 *              behind the head, then the whole body over and down after it
 *   swipePose  the swing: the club out to the right and round level, the
 *              hips and shoulders coming through with it and the weight
 *              going onto the left foot
 *   pokePose   the shove: the club drawn back along the forearm and driven
 *              out straight, the right foot lunging in behind it
 *   sleepPose  down on his right side, curled, snoring
 *
 * There is no club yet. Every strike is animated to one all the same: the
 * right fist is closed round where its handle will be, and the arm moves
 * the way an arm moves with two metres of wood on the end of it.
 *
 * What is different about the troll is the legs. A blow this size is all
 * weight — the hips go back, then forward and down, then twist through a
 * swing — and a leg swung from keyed angles would let the feet skate under
 * that. So the legs are SOLVED: each strike keys where the pelvis is and
 * where each foot stands, and the leg between them is solved as two links in
 * the pelvis's own frame, the plane of the leg tilted sideways to reach a
 * foot out from under a hip and the knee bent in that plane. The foot then
 * takes out everything above it, so the sole lies level whatever the pelvis
 * is doing. The stomp uses the same solve, which is what lets its pelvis
 * roll, yaw and sway without the feet sliding.
 *
 * Sign conventions are the troll rig's, which are the humanoid's: it faces
 * +Z, +X is its left; limb bones hang down, so rot.x < 0 swings one FORWARD;
 * the spine, chest and head point up, so rot.x > 0 tips them FORWARD; the jaw
 * points forward, so rot.x > 0 opens it; a foot's rot.x > 0 points the toe
 * DOWN; rot.y > 0 turns towards its own left. A rotation is Euler XYZ with Z
 * applied first, so an arm's rot.z lifts it out sideways and its rot.y then
 * sweeps the lifted arm round the body — which is what a level swing is.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';
import { quat } from '@hexdelve/shared';

import { groundPath, twoLink, type Planar } from './planar.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u: number): number => u * u * (3 - 2 * u);

type Vec3 = readonly [number, number, number];
type Euler = readonly [number, number, number];

/**
 * The rig the legs are solved on, copied from `troll.rig.yaml` and pinned to
 * it by `test/assets.test.ts` — the same reason every gait here carries a
 * copy of what it was written against.
 */
export const TROLL_CHAIN = {
	hipHeight: 2.4,
	/** The hip joint from the root: out along x, and down. */
	hip: [0.36, -0.1] as const,
	thigh: 1.1,
	shin: 0.95,
	spine: 0.42,
	chest: 0.58,
	/** The clavicle from the chest: out along x, and up. */
	shoulder: [0.35, 0.45] as const,
	/** The shoulder joint from the clavicle's root, out along x. */
	arm: 0.55,
	upperArm: 0.95,
	forearm: 0.85,
} as const;

/** Where the ankle sits with the sole on the ground: the depth of the foot. */
export const TROLL_SOLE = 0.25;

/** How far out either foot stands from the middle: a little wider than the hips. */
const STANCE = 0.42;

/** How far the toes turn out. */
const TOE_OUT = 0.12;

const THIGH: Planar = [-TROLL_CHAIN.thigh, 0];
const SHIN: Planar = [-TROLL_CHAIN.shin, 0];

/** How the pelvis sits: its rotation and where its root is, in the actor's space. */
interface Body {
	readonly q: ArrayLike<number>;
	readonly at: Vec3;
}

const bodyQ = quat.quat();
const inverse = quat.quat();
const tiltQ = quat.quat();
const flexQ = quat.quat();
const hipQ = quat.quat();
const kneeQ = quat.quat();
const chainQ = quat.quat();
const footQ = quat.quat();
const extraQ = quat.quat();
const euler: [number, number, number] = [0, 0, 0];
const local: [number, number, number] = [0, 0, 0];

/**
 * One leg, hip to foot, with the ankle put at `target`.
 *
 * The target is taken into the pelvis's own frame. The plane of the leg is
 * tilted about z until it holds the target, which is how a foot is reached
 * out from under its hip, and the thigh and shin are solved as two links in
 * that plane with the knee ahead. The hip's rotation is the flex in the plane
 * followed by the tilt of the plane; the knee's is a flex about the same
 * axis, which in the hip's frame is still x. The foot takes out everything
 * above it, pelvis included, so the sole lies level and points forward, and
 * is then turned out and pitched as asked.
 *
 * @param pitch toe-down about the ankle: a heel lifted, or a toe dropped in the air
 */
function placeLeg(out: SparsePose, side: number, target: Vec3, body: Body, pitch: number): void {
	const s = side > 0 ? 'L' : 'R';
	quat.conjugate(inverse, body.q);
	local[0] = target[0] - body.at[0];
	local[1] = target[1] - body.at[1];
	local[2] = target[2] - body.at[2];
	quat.rotateVec3(local, inverse, local);

	const dx = local[0] - side * TROLL_CHAIN.hip[0];
	const dy = local[1] - TROLL_CHAIN.hip[1];
	const dz = local[2];
	const tilt = Math.atan2(dx, -dy);
	const down = Math.hypot(dx, dy);
	const [hip, knee] = twoLink(0, [0, 0], THIGH, SHIN, [-down, dz], -1);

	quat.set(tiltQ, 0, 0, Math.sin(tilt / 2), Math.cos(tilt / 2));
	quat.set(flexQ, Math.sin(hip / 2), 0, 0, Math.cos(hip / 2));
	quat.multiply(hipQ, tiltQ, flexQ);
	setSparse(out, `hip${s}`, quat.toEulerXYZ(euler, hipQ));
	setSparse(out, `shin${s}`, [knee, 0, 0]);

	quat.set(kneeQ, Math.sin(knee / 2), 0, 0, Math.cos(knee / 2));
	quat.multiply(chainQ, body.q, hipQ);
	quat.multiply(chainQ, chainQ, kneeQ);
	quat.conjugate(footQ, chainQ);
	quat.fromEulerXYZ(extraQ, pitch, side * TOE_OUT, 0);
	quat.multiply(footQ, footQ, extraQ);
	setSparse(out, `foot${s}`, quat.toEulerXYZ(euler, footQ));
}

/** Where the ankle is with the heel lifted by `pitch` and the toes still down. */
const ankleHeight = (pitch: number): number =>
	TROLL_SOLE + 0.55 * Math.sin(pitch) + TROLL_SOLE * (1 - Math.cos(pitch));

/* ------------------------------------------------------------------ stand -- */

/**
 * The stand every strike starts from and comes back to, and the stomp at
 * amp 0 settles around: hunched, the knees a little bent, the club arm
 * hanging back and out from the hip, the other loose at the side.
 */
const STAND = {
	crouch: 0.06,
	root: 0.08,
	spine: 0.14,
	chest: 0.12,
	neck: -0.12,
	head: -0.15,
	jaw: 0.08,
	/** The clavicles hunched forward and a touch up. */
	shoulderL: [0, -0.12, 0.04] as Euler,
	shoulderR: [0, 0.12, -0.04] as Euler,
	armL: [-0.45, 0, 0.3] as Euler,
	forearmL: [-0.4, 0, 0] as Euler,
	handL: [-0.1, 0, 0] as Euler,
	armR: [-0.15, 0, -0.3] as Euler,
	forearmR: [-0.5, 0, 0] as Euler,
	handR: [0.2, 0, 0] as Euler,
} as const;

/* ------------------------------------------------------------------ stomp -- */

/** One stride pair, in seconds, at amp = 1: slow, because each step is a metre and a half. */
export const STOMP_PERIOD = 1.6;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const STOMP_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** A long, high step: the foot picked well up and put down flat. */
const STOMP_STEP = { restZ: 0.05, halfStride: 0.8, lift: 0.3 } as const;

/** How far into its swing a foot at `phase` is, at this amp: 0 when standing. */
function swingOf(phase: number, amp: number): number {
	return Math.pow(Math.max(0, Math.cos(phase)), 0.8) * clamp01(amp);
}

const at: [number, number, number] = [0, 0, 0];

/**
 * The stomp, and the stand it starts from.
 *
 * Walking, the pelvis drops onto each foot as it lands and rides back up
 * over it, rolls so the unsupported hip sags, and turns to put the stepping
 * hip forward; the shoulders turn against it and the free arm swings against
 * the legs, while the club arm swings less, weighed down. Standing, the
 * weight shifts slowly from foot to foot, the chest heaves, the head turns to
 * look round, and the jaw works.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full stride
 * @param time  seconds, driving the stand
 */
export function stompPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const cosT = Math.cos(theta);
	const breath = Math.sin(time * 1.1);
	const shift = Math.sin(time * 0.45) * still;
	const look = Math.sin(time * 0.3) * still;
	const growl = Math.pow(Math.max(0, Math.sin(time * 0.8)), 3) * still;

	// The drop is heaviest just after each footfall, and the mass rides over
	// whichever foot is planted: the left through the middle of its stance,
	// at theta = pi, the right half a cycle on.
	const drop = (0.07 * amp * (1 + Math.cos(2 * theta - PI - 0.5))) / 2;
	const over = -cosT * amp;
	const rootY = TROLL_CHAIN.hipHeight - STAND.crouch - drop - 0.01 * still * breath;
	const rootX = 0.04 * over + 0.05 * shift;
	const rootRot = STAND.root + 0.025 * amp * Math.cos(2 * theta);
	const yaw = -0.1 * amp * sinT;
	const roll = 0.05 * over + 0.035 * shift;
	quat.fromEulerXYZ(bodyQ, rootRot, yaw, roll);
	setSparse(out, 'root', [rootRot, yaw, roll], [rootX, rootY - TROLL_CHAIN.hipHeight, 0]);
	at[0] = rootX;
	at[1] = rootY;
	at[2] = 0;
	const body: Body = { q: bodyQ, at };

	for (const side of [1, -1] as const) {
		const phase = side > 0 ? theta : theta + PI;
		const [y, z] = groundPath(phase, STOMP_STEP.restZ, STOMP_STEP.halfStride, STOMP_STEP.lift, TROLL_SOLE, amp);
		// In the air the toes drop; they come up again before the heel lands.
		placeLeg(out, side, [side * STANCE, y, z], body, 0.35 * swingOf(phase, amp));
	}

	// The trunk: hunched, turning against the hips, heaving at the stand.
	setSparse(out, 'spine', [STAND.spine, 0.1 * amp * sinT, -0.02 * shift]);
	setSparse(out, 'chest', [STAND.chest + 0.03 * breath, 0.12 * amp * sinT, 0.02 * breath - 0.02 * over]);
	setSparse(out, 'neck', [STAND.neck - 0.02 * breath, 0.15 * look - 0.06 * amp * sinT, 0]);
	setSparse(out, 'head', [STAND.head + 0.03 * amp * Math.cos(2 * theta - 0.5), 0.25 * look - 0.08 * amp * sinT, 0.02 * shift]);
	setSparse(out, 'jaw', [STAND.jaw + 0.1 * growl + 0.03 * amp * (1 - Math.cos(2 * theta)), 0, 0]);

	// The shoulders rise with the breath and roll with the stride.
	setSparse(out, 'shoulderL', [0, STAND.shoulderL[1], STAND.shoulderL[2] + 0.04 * breath + 0.03 * amp * sinT]);
	setSparse(out, 'shoulderR', [0, STAND.shoulderR[1], STAND.shoulderR[2] - 0.04 * breath + 0.03 * amp * sinT]);

	// The free arm swings against the legs: back as the left foot lands. The
	// club arm swings a third as far, and its fist tightens at the stand.
	const swing = 0.3 * amp;
	setSparse(out, 'armL', [STAND.armL[0] + swing * sinT + 0.02 * breath, 0, STAND.armL[2] + 0.02 * shift]);
	setSparse(out, 'forearmL', [STAND.forearmL[0] - 0.25 * amp * Math.max(0, -sinT), 0, 0]);
	setSparse(out, 'handL', [STAND.handL[0] - 0.05 * breath, 0, 0]);
	setSparse(out, 'armR', [STAND.armR[0] - 0.1 * amp * sinT + 0.02 * breath, 0, STAND.armR[2] - 0.02 * shift]);
	setSparse(out, 'forearmR', [STAND.forearmR[0] - 0.08 * amp * Math.max(0, sinT), 0, 0]);
	setSparse(out, 'handR', [STAND.handR[0] + 0.04 * growl, 0, 0]);
	return out;
}

/* ---------------------------------------------------------------- strikes -- */

/** How a segment arrives at its key: eased both ends, accelerating into it, or braking. */
type Ease = 'smooth' | 'in' | 'out';

/**
 * What a strike keys: the pelvis, the trunk, the arms, and where each foot
 * stands. The legs are not keyed; they are solved from the pelvis to the
 * feet, so the weight can go anywhere and the feet stay where they were put.
 */
interface Key {
	readonly t: number;
	readonly ease: Ease;
	/** The pelvis: dropped, shifted forward, and swayed to the left. */
	readonly crouch: number;
	readonly shift: number;
	readonly sway: number;
	readonly root: Euler;
	readonly spine: Euler;
	readonly chest: Euler;
	readonly neck: Euler;
	readonly head: Euler;
	readonly jaw: number;
	readonly shoulderL: Euler;
	readonly armL: Euler;
	readonly forearmL: Euler;
	readonly handL: Euler;
	readonly shoulderR: Euler;
	readonly armR: Euler;
	readonly forearmR: Euler;
	readonly handR: Euler;
	/** Where each foot stands: x and z on the ground. */
	readonly footL: readonly [number, number];
	readonly footR: readonly [number, number];
	/** Each heel lifted: the foot pitched toe-down about a raised ankle. */
	readonly heelL: number;
	readonly heelR: number;
}

type Channel = Exclude<keyof Key, 't' | 'ease'>;

const CHANNELS: readonly Channel[] = [
	'crouch',
	'shift',
	'sway',
	'root',
	'spine',
	'chest',
	'neck',
	'head',
	'jaw',
	'shoulderL',
	'armL',
	'forearmL',
	'handL',
	'shoulderR',
	'armR',
	'forearmR',
	'handR',
	'footL',
	'footR',
	'heelL',
	'heelR',
];

const REST: Key = {
	t: 0,
	ease: 'smooth',
	crouch: STAND.crouch,
	shift: 0,
	sway: 0,
	root: [STAND.root, 0, 0],
	spine: [STAND.spine, 0, 0],
	chest: [STAND.chest, 0, 0],
	neck: [STAND.neck, 0, 0],
	head: [STAND.head, 0, 0],
	jaw: STAND.jaw,
	shoulderL: STAND.shoulderL,
	armL: STAND.armL,
	forearmL: STAND.forearmL,
	handL: STAND.handL,
	shoulderR: STAND.shoulderR,
	armR: STAND.armR,
	forearmR: STAND.forearmR,
	handR: STAND.handR,
	footL: [STANCE, STOMP_STEP.restZ],
	footR: [-STANCE, STOMP_STEP.restZ],
	heelL: 0,
	heelR: 0,
};

/** One key of a strike: its time, how it is arrived at, and what has changed since the last. */
type Step = { readonly t: number; readonly ease?: Ease } & Partial<Omit<Key, 't' | 'ease'>>;

/** The keys of a strike, each one the last with its changes laid over it. */
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

/** The stand again, at `t`: every channel back where it started. */
const rest = (t: number): Step => ({ ...REST, t });

/** Every channel of a key, mutable, for the blend to write into. */
type Mixed = {
	-readonly [C in Channel]: Key[C] extends readonly [number, number, number]
		? [number, number, number]
		: Key[C] extends readonly [number, number]
			? [number, number]
			: number;
};

const mixed: Mixed = {
	crouch: 0,
	shift: 0,
	sway: 0,
	root: [0, 0, 0],
	spine: [0, 0, 0],
	chest: [0, 0, 0],
	neck: [0, 0, 0],
	head: [0, 0, 0],
	jaw: 0,
	shoulderL: [0, 0, 0],
	armL: [0, 0, 0],
	forearmL: [0, 0, 0],
	handL: [0, 0, 0],
	shoulderR: [0, 0, 0],
	armR: [0, 0, 0],
	forearmR: [0, 0, 0],
	handR: [0, 0, 0],
	footL: [0, 0],
	footR: [0, 0],
	heelL: 0,
	heelR: 0,
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
 * places: an arc over the move, higher the further it goes, up to a stride.
 */
function stepArc(from: readonly [number, number], to: readonly [number, number], w: number): number {
	const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
	if (distance < 1e-3) return 0;
	return 0.4 * Math.min(1, distance / 0.6) * Math.sin(PI * w);
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

	quat.fromEulerXYZ(bodyQ, k.root[0], k.root[1], k.root[2]);
	setSparse(out, 'root', k.root, [k.sway, -k.crouch, k.shift]);
	at[0] = k.sway;
	at[1] = TROLL_CHAIN.hipHeight - k.crouch;
	at[2] = k.shift;
	const body: Body = { q: bodyQ, at };
	setSparse(out, 'spine', k.spine);
	setSparse(out, 'chest', k.chest);
	setSparse(out, 'neck', k.neck);
	setSparse(out, 'head', k.head);
	setSparse(out, 'jaw', [k.jaw, 0, 0]);
	setSparse(out, 'shoulderL', k.shoulderL);
	setSparse(out, 'armL', k.armL);
	setSparse(out, 'forearmL', k.forearmL);
	setSparse(out, 'handL', k.handL);
	setSparse(out, 'shoulderR', k.shoulderR);
	setSparse(out, 'armR', k.armR);
	setSparse(out, 'forearmR', k.forearmR);
	setSparse(out, 'handR', k.handR);

	const liftL = stepArc(a.footL, b.footL, w);
	const liftR = stepArc(a.footR, b.footR, w);
	placeLeg(out, 1, [k.footL[0], ankleHeight(k.heelL) + liftL, k.footL[1]], body, k.heelL);
	placeLeg(out, -1, [k.footR[0], ankleHeight(k.heelR) + liftR, k.footR[1]], body, k.heelR);
	return out;
}

/* ------------------------------------------------------------------ smash -- */

/** The moment the club lands, as a fraction of the smash. */
export const SMASH_HIT = 0.5;

const SMASH = keyed([
	{ t: 0 },
	// The windup: back on the heels, the club swung up over and behind the
	// head with the elbow bent, the right shoulder hauled up after it, the
	// left arm out ahead for balance, the face up, the roar starting.
	{
		t: 0.32,
		crouch: 0.12,
		shift: -0.18,
		root: [-0.05, 0.05, 0],
		spine: [-0.2, 0.1, 0],
		chest: [-0.28, 0.15, 0.05],
		neck: [0.05, 0, 0],
		head: [-0.3, 0, 0],
		jaw: 0.35,
		shoulderR: [0, 0.15, 0.4],
		shoulderL: [0, -0.1, 0.05],
		armR: [-3.45, 0, -0.4],
		forearmR: [-1.2, 0, 0],
		handR: [0.3, 0, 0],
		armL: [-1.0, 0, 0.55],
		forearmL: [-0.9, 0, 0],
		handL: [-0.3, 0, 0],
	},
	// The blow: the whole body comes over and down after the club, the
	// pelvis driven forward and the left foot stepping in under it, the arm
	// straightening as it comes, the left arm thrown back. Accelerating
	// into the key, so the club is at full speed when it lands.
	{
		t: SMASH_HIT,
		ease: 'in',
		crouch: 0.36,
		shift: 0.4,
		root: [0.25, -0.05, 0],
		spine: [0.45, -0.1, 0],
		chest: [0.35, -0.1, -0.05],
		neck: [0.05, 0, 0],
		head: [0.12, 0, 0],
		jaw: 0.5,
		shoulderR: [0, 0.25, -0.15],
		shoulderL: [0, -0.15, 0.1],
		armR: [-1.9, 0, -0.15],
		forearmR: [0.05, 0, 0],
		handR: [0.35, 0, 0],
		armL: [0.35, 0, 0.45],
		forearmL: [-0.5, 0, 0],
		footL: [STANCE + 0.03, 0.75],
	},
	// Landed: the body sinks onto the blow and the wrist gives.
	{
		t: 0.6,
		ease: 'out',
		crouch: 0.42,
		shift: 0.42,
		spine: [0.5, -0.1, 0],
		head: [0.2, 0, 0],
		jaw: 0.45,
		shoulderR: [0, 0.25, -0.25],
		armR: [-2.0, 0, -0.15],
		handR: [0.45, 0, 0],
	},
	// Recovering: the club dragged back up, the body coming up off it.
	{
		t: 0.8,
		crouch: 0.18,
		shift: 0.25,
		root: [0.12, 0, 0],
		spine: [0.28, 0, 0],
		chest: [0.2, 0, 0],
		head: [-0.05, 0, 0],
		jaw: 0.2,
		shoulderR: [0, 0.15, 0],
		shoulderL: STAND.shoulderL,
		armR: [-1.1, 0, -0.3],
		forearmR: [-0.8, 0, 0],
		handR: [0.2, 0, 0],
		armL: [-0.3, 0, 0.35],
		forearmL: [-0.5, 0, 0],
		handL: STAND.handL,
	},
	// And the foot back, last.
	rest(1),
]);

/** The crushing blow. @param u 0 standing, 1 back standing */
export function smashPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(SMASH, u, out);
}

/* ------------------------------------------------------------------ swipe -- */

/** The moment the club comes through the target, as a fraction of the swipe. */
export const SWIPE_HIT = 0.5;

const SWIPE = keyed([
	{ t: 0 },
	// Wound up: the club arm lifted out to the right and swung back, the
	// hips and shoulders turned after it, the weight over on the right foot
	// and the left heel up, the other arm across the body, the head still
	// on the target.
	{
		t: 0.3,
		crouch: 0.12,
		shift: -0.05,
		sway: -0.15,
		root: [0.05, -0.25, 0.03],
		spine: [0.05, -0.3, 0],
		chest: [-0.05, -0.35, 0.05],
		neck: [0, 0.2, 0],
		head: [-0.15, 0.35, 0],
		jaw: 0.3,
		shoulderR: [0, -0.1, 0.25],
		shoulderL: [0, -0.2, 0.05],
		armR: [0, -0.8, -1.2],
		forearmR: [-0.8, 0, 0],
		handR: [0.2, 0, 0],
		armL: [-0.6, 0, -0.2],
		forearmL: [-1.0, 0, 0],
		heelL: 0.2,
	},
	// Through: the arm sweeps round level and straight, and the whole body
	// comes with it — the hips and shoulders turning through, the chest
	// leaning into it, the weight going across onto the left foot as it
	// steps in, the right heel up as he pivots on the ball of it.
	{
		t: SWIPE_HIT,
		ease: 'in',
		crouch: 0.3,
		shift: 0.35,
		sway: 0.15,
		root: [0.1, 0.15, -0.05],
		spine: [0.15, 0.25, -0.08],
		chest: [0.3, 0.35, -0.2],
		neck: [0, -0.1, 0],
		head: [0.1, 0.05, 0],
		jaw: 0.5,
		shoulderR: [0, 0.2, -0.1],
		shoulderL: [0, -0.1, 0.15],
		armR: [0, 0.9, -1.35],
		forearmR: [-0.1, 0, 0],
		handR: [0, 0, 0],
		armL: [-0.2, 0, 0.6],
		forearmL: [-0.6, 0, 0],
		footL: [STANCE + 0.1, 0.5],
		heelL: 0,
		heelR: 0.35,
	},
	// Follow-through: the club carried on past to the left, the body
	// leaning after it, the head lagging behind the shoulders.
	{
		t: 0.62,
		ease: 'out',
		crouch: 0.35,
		shift: 0.35,
		sway: 0.25,
		root: [0.1, 0.35, -0.1],
		spine: [0.15, 0.4, -0.12],
		chest: [0.35, 0.45, -0.28],
		neck: [0, -0.25, 0],
		head: [0.1, -0.2, 0],
		jaw: 0.35,
		shoulderR: [0, 0.3, -0.15],
		shoulderL: [0, -0.05, 0.2],
		armR: [-0.1, 1.7, -1.25],
		forearmR: [-0.5, 0, 0],
		handR: [-0.1, 0, 0],
		armL: [0.2, 0, 0.7],
		forearmL: [-0.4, 0, 0],
		heelR: 0.6,
	},
	// Recovering: unwinding, the club coming back down to the hip.
	{
		t: 0.82,
		crouch: 0.15,
		shift: 0.1,
		sway: 0.05,
		root: [0.08, 0.1, 0],
		spine: [0.14, 0.1, 0],
		chest: [0.15, 0.1, 0],
		neck: [-0.1, 0, 0],
		head: [-0.1, 0, 0],
		jaw: 0.15,
		shoulderR: [0, 0.15, -0.05],
		shoulderL: [0, -0.12, 0.05],
		armR: [-0.4, 0.4, -0.6],
		forearmR: [-0.6, 0, 0],
		handR: [0.2, 0, 0],
		armL: [-0.4, 0, 0.35],
		forearmL: [-0.45, 0, 0],
		heelR: 0.1,
	},
	// And the foot back, last.
	rest(1),
]);

/** The level swing. @param u 0 standing, 1 back standing */
export function swipePose(u: number, out: SparsePose = {}): SparsePose {
	return strike(SWIPE, u, out);
}

/* ------------------------------------------------------------------- poke -- */

/** The moment the club's end reaches the target, as a fraction of the poke. */
export const POKE_HIT = 0.5;

const POKE = keyed([
	{ t: 0 },
	// Drawn back: the upper arm back and the elbow folded hard, so the club
	// lies along the forearm pointing at the target; the right side turned
	// away, the weight back on the right foot, the left arm up ahead.
	{
		t: 0.3,
		crouch: 0.1,
		shift: -0.15,
		sway: -0.08,
		root: [0.05, 0.2, 0],
		spine: [0.05, 0.15, 0],
		chest: [0, 0.25, 0.03],
		neck: [-0.05, -0.15, 0],
		head: [-0.1, -0.2, 0],
		jaw: 0.2,
		shoulderR: [0, -0.15, 0.2],
		shoulderL: [0, -0.15, 0.05],
		armR: [0.5, 0, -0.35],
		forearmR: [-1.95, 0, 0],
		handR: [0, 0, 0],
		armL: [-0.8, 0, 0.35],
		forearmL: [-0.6, 0, 0],
		handL: [-0.2, 0, 0],
		heelR: 0.15,
	},
	// The shove: the arm driven out straight with the right shoulder and
	// hip behind it, the pelvis driven forward, the right foot lunging in
	// under it and the left heel coming up, the head along the club.
	{
		t: POKE_HIT,
		ease: 'in',
		crouch: 0.35,
		shift: 0.6,
		sway: -0.05,
		root: [0.15, -0.15, 0],
		spine: [0.35, -0.1, 0],
		chest: [0.3, -0.2, -0.05],
		neck: [0, 0.1, 0],
		head: [0.05, 0.15, 0],
		jaw: 0.5,
		shoulderR: [0, 0.5, -0.1],
		shoulderL: [0, -0.2, 0.1],
		armR: [-1.65, 0, -0.2],
		forearmR: [-0.1, 0, 0],
		handR: [0.1, 0, 0],
		armL: [0.5, 0, 0.35],
		forearmL: [-0.5, 0, 0],
		footR: [-STANCE - 0.02, 0.9],
		heelR: 0,
		heelL: 0.5,
	},
	// Held: shoved through, a hand's width further.
	{
		t: 0.62,
		ease: 'out',
		crouch: 0.38,
		shift: 0.7,
		root: [0.18, -0.2, 0],
		spine: [0.38, -0.1, 0],
		chest: [0.32, -0.22, -0.05],
		jaw: 0.4,
		shoulderR: [0, 0.55, -0.1],
		armR: [-1.7, 0, -0.2],
		handR: [0.1, 0, 0],
	},
	// Recovering: the arm drawn back to the hip, the weight coming back.
	{
		t: 0.82,
		crouch: 0.15,
		shift: 0.2,
		sway: 0,
		root: [0.1, -0.1, 0],
		spine: [0.2, -0.05, 0],
		chest: [0.15, -0.1, 0],
		neck: [-0.1, 0.05, 0],
		head: [-0.12, 0.1, 0],
		jaw: 0.15,
		shoulderR: [0, 0.2, 0],
		shoulderL: STAND.shoulderL,
		armR: [-1.0, 0, -0.3],
		forearmR: [-0.9, 0, 0],
		handR: [0.1, 0, 0],
		armL: [-0.2, 0, 0.3],
		forearmL: [-0.4, 0, 0],
		handL: STAND.handL,
		heelL: 0.1,
	},
	// And the foot back, last.
	rest(1),
]);

/** The shove. @param u 0 standing, 1 back standing */
export function pokePose(u: number, out: SparsePose = {}): SparsePose {
	return strike(POKE, u, out);
}

/* ------------------------------------------------------------------ sleep -- */

/** Where the root lies, in metres above the ground: the pelvis on its side. */
const SLEEP_HEIGHT = 0.68;

const shoulderQ = quat.quat();
const wantQ = quat.quat();
const armQ = quat.quat();

/**
 * An arm's rotation in its clavicle's frame, given the rotation wanted in
 * the chest's. A clavicle hauled forward and up turns the whole arm's frame
 * with it, and an arm that has to lie along the ground is easier to write
 * in the chest's frame and then take the clavicle back out of.
 */
function underClavicle(clavicle: Euler, wanted: Euler): Euler {
	quat.fromEulerXYZ(shoulderQ, clavicle[0], clavicle[1], clavicle[2]);
	quat.fromEulerXYZ(wantQ, wanted[0], wanted[1], wanted[2]);
	quat.conjugate(shoulderQ, shoulderQ);
	quat.multiply(armQ, shoulderQ, wantQ);
	return quat.toEulerXYZ(euler, armQ);
}

/**
 * Asleep on his right side.
 *
 * The root is rolled a quarter turn about z, so the body lies along x with
 * the head to the actor's right and the belly to its front, then rocked a
 * little onto its front about that axis. From there every rotation is in
 * the rolled frame: a "forward" swing of a leg curls it up towards the
 * belly, and a spine bent towards its own left lifts the chest. The right
 * clavicle is hauled forward and up, so the shoulder under the chest is
 * ahead of it rather than beneath it, and the right arm lies stretched out
 * along the ground past the head, which rests on the upper arm. The left
 * arm is draped over the body, the hand on the ground; the knees
 * are drawn up, the upper leg lying over the lower. He breathes slowly and
 * snores on each breath out, a foot and a hand twitching now and then.
 *
 * @param time seconds, driving the breathing
 */
export function sleepPose(time: number, out: SparsePose = {}): SparsePose {
	const breath = Math.sin(time * 1.2);
	const snore = Math.pow(Math.max(0, Math.sin(time * 1.2 - 0.9)), 3);
	const twitch = Math.pow(Math.max(0, Math.sin(time * 0.37)), 14);

	setSparse(out, 'root', [-0.2, 0.25, PI / 2], [0, SLEEP_HEIGHT - TROLL_CHAIN.hipHeight, 0]);
	setSparse(out, 'spine', [0.28 + 0.01 * breath, 0, -0.1]);
	setSparse(out, 'chest', [0.22 + 0.03 * breath, 0, -0.05]);
	setSparse(out, 'neck', [0.15, 0.15, -0.2]);
	setSparse(out, 'head', [0.2, 0.25, -0.35]);
	setSparse(out, 'jaw', [0.2 + 0.12 * snore, 0, 0]);

	const clavicleR: Euler = [0, 0.5, -0.6];
	setSparse(out, 'shoulderR', clavicleR);
	setSparse(out, 'armR', underClavicle(clavicleR, [2.93, 0, -0.15]));
	setSparse(out, 'forearmR', [-0.6, 0, 0]);
	setSparse(out, 'handR', [0.2, 0.2, 0]);

	const clavicleL: Euler = [0, -0.3, 0.05 + 0.05 * breath];
	setSparse(out, 'shoulderL', clavicleL);
	setSparse(out, 'armL', underClavicle(clavicleL, [-1.2, 0, -1.25]));
	setSparse(out, 'forearmL', [-0.4, 0, 0.1]);
	setSparse(out, 'handL', [-0.2 + 0.15 * twitch, 0, 0.2]);

	setSparse(out, 'hipL', [-1.2, 0.05, -0.15]);
	setSparse(out, 'shinL', [1.5, 0, 0]);
	setSparse(out, 'footL', [0.3 + 0.25 * twitch, 0, 0]);
	setSparse(out, 'hipR', [-0.9, 0, 0.1]);
	setSparse(out, 'shinR', [1.2, 0, 0]);
	setSparse(out, 'footR', [0.35, 0, 0]);
	return out;
}
