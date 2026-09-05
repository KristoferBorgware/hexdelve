/*
 * How the hill giant holds itself, as pure functions.
 *
 * The same bargain as every other gait here: parameters in, a pose out, no
 * state and no renderer types. Four of them, because the animal has four
 * things it does:
 *
 *   lumberPose    the walk — and, at amp 0, the stand it walks from
 *   poundPose     the two-fisted blow: both fists hauled up over and behind
 *                 the head with the back arched, then the whole body over
 *                 and down after them
 *   backhandPose  the backhand: the right fist drawn across the chest to the
 *                 left shoulder with the trunk wound after it, then the
 *                 trunk unwinding and the arm sweeping out level, the back
 *                 of the fist leading
 *   stampPose     the stamp: the right foot hauled up to the belly, the body
 *                 leaning back off it, then driven down flat onto whatever
 *                 is in front
 *
 * A hill giant is built like a man and moves like a heavy one. The stand is
 * upright, the weight settling from foot to foot; the walk is long and
 * flat-footed, each step dropped rather than placed, the arms swinging wide
 * of the gut. A blow is the whole body: the giant winds up, the pelvis
 * drives, and the fist or the foot is what arrives at the end of it.
 *
 * The legs are handled as the troll's are. Each strike keys where the
 * pelvis is and where each foot stands, and the leg between them is solved
 * as two links in the pelvis's own frame, the plane of the leg tilted
 * sideways to reach a foot out from under a hip and the knee bent in that
 * plane. The foot then takes out everything above it, so the sole lies
 * level whatever the pelvis is doing — or, in the stamp, is lifted clear of
 * the ground and pitched. The lumber uses the same solve, which is what
 * lets its pelvis roll, yaw and sway without the feet sliding.
 *
 * Sign conventions are the giant rig's, which are the humanoid's: it faces
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
 * The rig the legs are solved on, copied from `giant.rig.yaml` and pinned to
 * it by `test/assets.test.ts` — the same reason every gait here carries a
 * copy of what it was written against.
 */
export const GIANT_CHAIN = {
	hipHeight: 3.0,
	/** The hip joint from the root: out along x, and down. */
	hip: [0.42, -0.12] as const,
	thigh: 1.4,
	shin: 1.3,
	spine: 0.5,
	chest: 0.72,
	/** The clavicle from the chest: out along x, and up. */
	shoulder: [0.4, 0.42] as const,
	/** The shoulder joint from the clavicle's root, out along x. */
	arm: 0.55,
	upperArm: 1.1,
	forearm: 0.95,
} as const;

/** Where the ankle sits with the sole on the ground: the depth of the foot. */
export const GIANT_SOLE = 0.3;

/** From the ankle to the end of the toes, along the foot. */
const FOOT = 0.65;

/** How far out either foot stands from the middle: a little wider than the hips. */
const STANCE = 0.5;

/** How far the toes turn out. */
const TOE_OUT = 0.1;

const THIGH: Planar = [-GIANT_CHAIN.thigh, 0];
const SHIN: Planar = [-GIANT_CHAIN.shin, 0];

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

	const dx = local[0] - side * GIANT_CHAIN.hip[0];
	const dy = local[1] - GIANT_CHAIN.hip[1];
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
	GIANT_SOLE + FOOT * Math.sin(pitch) + GIANT_SOLE * (1 - Math.cos(pitch));

/* ------------------------------------------------------------------ stand -- */

/**
 * The stand every strike starts from and comes back to, and the lumber at
 * amp 0 settles around: upright, the knees a little bent, the head a
 * little forward, the arms hanging out from the body because the body is
 * in the way.
 */
const STAND = {
	crouch: 0.08,
	root: 0.03,
	spine: 0.06,
	chest: 0.04,
	neck: -0.04,
	head: -0.05,
	jaw: 0.06,
	/** The clavicles hunched forward a touch. */
	shoulderL: [0, -0.06, 0.05] as Euler,
	shoulderR: [0, 0.06, -0.05] as Euler,
	armL: [-0.1, 0, 0.32] as Euler,
	forearmL: [-0.3, 0, 0] as Euler,
	handL: [-0.1, 0, 0] as Euler,
	armR: [-0.1, 0, -0.32] as Euler,
	forearmR: [-0.3, 0, 0] as Euler,
	handR: [-0.1, 0, 0] as Euler,
} as const;

/* ----------------------------------------------------------------- lumber -- */

/** One stride pair, in seconds, at amp = 1: slow, because each step is nearly two metres. */
export const LUMBER_PERIOD = 2.0;

/** Where in the cycle (0..1) the left and then the right foot land. */
export const LUMBER_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** A long step, picked up and dropped flat. */
const LUMBER_STEP = { restZ: 0.05, halfStride: 0.95, lift: 0.35 } as const;

/** How far into its swing a foot at `phase` is, at this amp: 0 when standing. */
function swingOf(phase: number, amp: number): number {
	return Math.pow(Math.max(0, Math.cos(phase)), 0.8) * clamp01(amp);
}

const at: [number, number, number] = [0, 0, 0];

/**
 * The lumber, and the stand it starts from.
 *
 * Walking, the pelvis drops onto each foot as it lands and rides back up
 * over it, rolls so the unsupported hip sags, and turns to put the stepping
 * hip forward; the shoulders turn against it and the arms swing against the
 * legs, wide of the gut. Standing, the weight shifts slowly from foot to
 * foot, the gut heaves, the head turns to look round, the jaw works, and
 * once a cycle the left hand comes up to rub the belly.
 *
 * Every rhythm in the stand is a multiple of one at 0.6 rad/s, so a stand
 * baked over that cycle closes on itself, and every one is zero at the
 * start of it, so a strike, which ends in the stand at rest, ends where the
 * stand begins. Every one fades out with the stride, so a walk baked over
 * its own cycle closes too.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full stride
 * @param time  seconds, driving the stand
 */
export function lumberPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const cosT = Math.cos(theta);

	const breath = still * Math.sin(time * 1.2);
	const shift = still * Math.sin(time * 0.6);
	const look = still * Math.sin(time * 1.8);
	const chew = Math.pow(Math.max(0, Math.sin(time * 1.2)), 3) * still;
	// Once a cycle the left hand comes up to the belly and rubs at it.
	const scratch = Math.pow(Math.max(0, Math.sin(time * 0.6 - 2.0)), 6) * still;
	const rub = Math.sin(time * 2.4) * scratch;

	// The drop is heaviest just after each footfall, and the mass rides over
	// whichever foot is planted: the left through the middle of its stance,
	// at theta = pi, the right half a cycle on.
	const drop = (0.09 * amp * (1 + Math.cos(2 * theta - PI - 0.5))) / 2;
	const over = -cosT * amp;
	const rootY = GIANT_CHAIN.hipHeight - STAND.crouch - drop - 0.012 * breath;
	const rootX = 0.06 * over + 0.06 * shift;
	const rootRot = STAND.root + 0.03 * amp * Math.cos(2 * theta);
	const yaw = -0.12 * amp * sinT;
	const roll = 0.06 * over + 0.04 * shift;
	quat.fromEulerXYZ(bodyQ, rootRot, yaw, roll);
	setSparse(out, 'root', [rootRot, yaw, roll], [rootX, rootY - GIANT_CHAIN.hipHeight, 0]);
	at[0] = rootX;
	at[1] = rootY;
	at[2] = 0;
	const body: Body = { q: bodyQ, at };

	for (const side of [1, -1] as const) {
		const phase = side > 0 ? theta : theta + PI;
		const [y, z] = groundPath(phase, LUMBER_STEP.restZ, LUMBER_STEP.halfStride, LUMBER_STEP.lift, GIANT_SOLE, amp);
		// In the air the toes drop; they come up again before the heel lands.
		placeLeg(out, side, [side * STANCE, y, z], body, 0.35 * swingOf(phase, amp));
	}

	// The trunk: upright, turning against the hips, the gut heaving at the
	// stand and the chest coming down a little to the rubbing hand.
	setSparse(out, 'spine', [STAND.spine + 0.02 * breath, 0.1 * amp * sinT, -0.02 * shift]);
	setSparse(out, 'chest', [STAND.chest + 0.03 * breath + 0.03 * scratch, 0.12 * amp * sinT, 0.02 * breath - 0.02 * over]);
	setSparse(out, 'neck', [STAND.neck - 0.02 * breath, 0.15 * look - 0.06 * amp * sinT, 0]);
	setSparse(out, 'head', [
		STAND.head + 0.03 * amp * Math.cos(2 * theta - 0.5) + 0.12 * scratch,
		0.25 * look - 0.08 * amp * sinT,
		0.02 * shift,
	]);
	setSparse(out, 'jaw', [STAND.jaw + 0.12 * chew + 0.03 * amp * (1 - Math.cos(2 * theta)), 0, 0]);

	// The shoulders rise with the breath and roll with the stride.
	setSparse(out, 'shoulderL', [0, STAND.shoulderL[1] - 0.1 * scratch, STAND.shoulderL[2] + 0.04 * breath + 0.04 * amp * sinT]);
	setSparse(out, 'shoulderR', [0, STAND.shoulderR[1], STAND.shoulderR[2] - 0.04 * breath + 0.04 * amp * sinT]);

	// The arms swing against the legs: back as the left foot lands. At the
	// stand the left comes up to the belly, turned in so the forearm folds
	// across it, and the hand rubs; the right hangs, its fist working.
	const swing = 0.45 * amp;
	setSparse(out, 'armL', [
		STAND.armL[0] + swing * sinT + 0.02 * breath + 0.1 * scratch,
		-0.9 * scratch,
		STAND.armL[2] + 0.02 * shift - 0.02 * scratch,
	]);
	setSparse(out, 'forearmL', [STAND.forearmL[0] - 0.3 * amp * Math.max(0, -sinT) - 1.6 * scratch, 0, 0]);
	setSparse(out, 'handL', [STAND.handL[0] - 0.05 * breath - 0.1 * scratch + 0.2 * rub, 0, 0.1 * scratch]);
	setSparse(out, 'armR', [STAND.armR[0] - swing * sinT + 0.02 * breath, 0, STAND.armR[2] - 0.02 * shift]);
	setSparse(out, 'forearmR', [STAND.forearmR[0] - 0.3 * amp * Math.max(0, sinT), 0, 0]);
	setSparse(out, 'handR', [STAND.handR[0] + 0.06 * chew, 0, 0]);
	return out;
}

/* ---------------------------------------------------------------- strikes -- */

/** How a segment arrives at its key: eased both ends, accelerating into it, or braking. */
type Ease = 'smooth' | 'in' | 'out';

/**
 * What a strike keys: the pelvis, the trunk, the arms, and where each foot
 * stands — or, lifted, hangs. The legs are not keyed; they are solved from
 * the pelvis to the feet, so the weight can go anywhere and the feet stay
 * where they were put.
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
	/** Each foot held clear of the ground by this much, the sole level. */
	readonly liftL: number;
	readonly liftR: number;
	/** Each foot pitched toe-down in the air, which lifts nothing. */
	readonly toeL: number;
	readonly toeR: number;
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
	'liftL',
	'liftR',
	'toeL',
	'toeR',
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
	footL: [STANCE, LUMBER_STEP.restZ],
	footR: [-STANCE, LUMBER_STEP.restZ],
	heelL: 0,
	heelR: 0,
	liftL: 0,
	liftR: 0,
	toeL: 0,
	toeR: 0,
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
	liftL: 0,
	liftR: 0,
	toeL: 0,
	toeR: 0,
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
 * places on the ground: an arc over the move, higher the further it goes,
 * up to a stride. A foot that is lifted at either key is carried by its
 * lift, not by an arc.
 */
function stepArc(from: readonly [number, number], to: readonly [number, number], lifted: boolean, w: number): number {
	if (lifted) return 0;
	const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
	if (distance < 1e-3) return 0;
	return 0.45 * Math.min(1, distance / 0.7) * Math.sin(PI * w);
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
	at[1] = GIANT_CHAIN.hipHeight - k.crouch;
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

	const upL = k.liftL + stepArc(a.footL, b.footL, a.liftL > 0 || b.liftL > 0, w);
	const upR = k.liftR + stepArc(a.footR, b.footR, a.liftR > 0 || b.liftR > 0, w);
	placeLeg(out, 1, [k.footL[0], ankleHeight(k.heelL) + upL, k.footL[1]], body, k.heelL + k.toeL);
	placeLeg(out, -1, [k.footR[0], ankleHeight(k.heelR) + upR, k.footR[1]], body, k.heelR + k.toeR);
	return out;
}

/* ------------------------------------------------------------------ pound -- */

/** The moment the fists land, as a fraction of the pound. */
export const POUND_HIT = 0.5;

const POUND = keyed([
	{ t: 0 },
	// The windup: back on the heels, both fists hauled up over the head and
	// behind it with the elbows out, the back arched, the shoulders up, the
	// face up, the roar starting.
	{
		t: 0.32,
		crouch: 0.1,
		shift: -0.2,
		root: [-0.08, 0, 0],
		spine: [-0.22, 0, 0],
		chest: [-0.3, 0, 0],
		neck: [0.05, 0, 0],
		head: [-0.25, 0, 0],
		jaw: 0.4,
		shoulderL: [0, -0.05, 0.35],
		shoulderR: [0, 0.05, -0.35],
		armL: [-3.0, 0, 0.35],
		forearmL: [-1.1, 0, 0],
		handL: [0.3, 0, 0],
		armR: [-3.0, 0, -0.35],
		forearmR: [-1.1, 0, 0],
		handR: [0.3, 0, 0],
	},
	// The blow: the whole body comes over and down after the fists, the
	// pelvis driven forward and the left foot stepping in under it, the arms
	// straightening as they come. Accelerating into the key, so the fists
	// are at full speed when they land.
	{
		t: POUND_HIT,
		ease: 'in',
		crouch: 0.4,
		shift: 0.45,
		root: [0.3, 0, 0],
		spine: [0.45, 0, 0],
		chest: [0.35, 0, 0],
		neck: [0.05, 0, 0],
		head: [0.15, 0, 0],
		jaw: 0.55,
		shoulderL: [0, -0.2, -0.12],
		shoulderR: [0, 0.2, 0.12],
		armL: [-1.35, 0, 0.15],
		forearmL: [-0.1, 0, 0],
		handL: [0.35, 0, 0],
		armR: [-1.35, 0, -0.15],
		forearmR: [-0.1, 0, 0],
		handR: [0.35, 0, 0],
		footL: [STANCE + 0.05, 0.9],
	},
	// Landed: the body sinks onto the blow and the wrists give.
	{
		t: 0.6,
		ease: 'out',
		crouch: 0.45,
		shift: 0.48,
		spine: [0.5, 0, 0],
		head: [0.22, 0, 0],
		jaw: 0.5,
		armL: [-1.45, 0, 0.15],
		handL: [0.45, 0, 0],
		armR: [-1.45, 0, -0.15],
		handR: [0.45, 0, 0],
	},
	// Recovering: the fists dragged back up, the body coming up off them.
	{
		t: 0.8,
		crouch: 0.2,
		shift: 0.25,
		root: [0.1, 0, 0],
		spine: [0.2, 0, 0],
		chest: [0.15, 0, 0],
		head: [-0.05, 0, 0],
		jaw: 0.2,
		shoulderL: STAND.shoulderL,
		shoulderR: STAND.shoulderR,
		armL: [-0.7, 0, 0.3],
		forearmL: [-0.7, 0, 0],
		handL: STAND.handL,
		armR: [-0.7, 0, -0.3],
		forearmR: [-0.7, 0, 0],
		handR: STAND.handR,
	},
	// And the foot back, last.
	rest(1),
]);

/** The two-fisted blow. @param u 0 standing, 1 back standing */
export function poundPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(POUND, u, out);
}

/* --------------------------------------------------------------- backhand -- */

/** The moment the back of the fist comes through the target, as a fraction of the backhand. */
export const BACKHAND_HIT = 0.5;

const BACKHAND = keyed([
	{ t: 0 },
	// Wound: the trunk turned to its left with the weight over the left
	// foot and the right heel up, the right arm lifted and drawn across the
	// chest with the elbow folded, so the fist sits at the left shoulder
	// with its back out, the left arm out for balance, the head still on
	// the target.
	{
		t: 0.3,
		crouch: 0.12,
		shift: -0.05,
		sway: 0.12,
		root: [0.05, 0.2, -0.03],
		spine: [0.05, 0.3, 0],
		chest: [0.05, 0.35, -0.05],
		neck: [0, -0.2, 0],
		head: [-0.1, -0.35, 0],
		jaw: 0.3,
		shoulderR: [0, 0.35, 0.1],
		shoulderL: [0, -0.15, 0.1],
		armR: [0, 2.2, -1.15],
		forearmR: [-1.4, 0, 0],
		handR: [0.3, 0, 0],
		armL: [-0.5, 0, 0.75],
		forearmL: [-0.6, 0, 0],
		handL: [-0.2, 0, 0],
		heelR: 0.25,
	},
	// Through: the trunk unwinds and the arm goes with it, out straight and
	// level, the back of the fist leading through the target ahead; the
	// weight comes across onto the right foot as it steps out, the left
	// heel up. Accelerating into the key.
	{
		t: BACKHAND_HIT,
		ease: 'in',
		crouch: 0.3,
		shift: 0.45,
		sway: -0.12,
		root: [0.1, -0.05, 0.03],
		spine: [0.15, -0.08, 0.05],
		chest: [0.35, -0.1, 0.12],
		neck: [0, 0.05, 0],
		head: [0.05, 0.05, 0],
		jaw: 0.55,
		shoulderR: [0, -0.1, 0.15],
		shoulderL: [0, -0.1, -0.05],
		armR: [0, 1.75, -1.25],
		forearmR: [-0.15, 0, 0],
		handR: [0.1, 0, 0],
		armL: [-0.3, 0, 0.5],
		forearmL: [-0.5, 0, 0],
		footR: [-STANCE - 0.1, 0.7],
		heelR: 0,
		heelL: 0.3,
	},
	// Follow-through: the arm carried on out to the right and back, the
	// trunk turned after it, the head lagging behind the shoulders.
	{
		t: 0.62,
		ease: 'out',
		crouch: 0.34,
		shift: 0.45,
		sway: -0.2,
		root: [0.1, -0.3, 0.06],
		spine: [0.15, -0.35, 0.08],
		chest: [0.35, -0.4, 0.18],
		neck: [0, 0.25, 0],
		head: [0.1, 0.25, 0],
		jaw: 0.4,
		shoulderR: [0, -0.25, 0.2],
		shoulderL: [0, -0.05, -0.1],
		armR: [0, 0.6, -1.2],
		forearmR: [-0.4, 0, 0],
		handR: [-0.1, 0, 0],
		armL: [-0.1, 0, 0.35],
		heelL: 0.5,
	},
	// Recovering: unwinding, the arm coming down to the side.
	{
		t: 0.82,
		crouch: 0.15,
		shift: 0.1,
		sway: -0.05,
		root: [0.05, -0.1, 0],
		spine: [0.08, -0.1, 0],
		chest: [0.08, -0.1, 0],
		neck: [-0.05, 0.05, 0],
		head: [-0.05, 0.05, 0],
		jaw: 0.15,
		shoulderR: [0, 0, 0],
		shoulderL: STAND.shoulderL,
		armR: [-0.3, 0.2, -0.6],
		forearmR: [-0.5, 0, 0],
		handR: STAND.handR,
		armL: STAND.armL,
		forearmL: STAND.forearmL,
		handL: STAND.handL,
		heelL: 0.1,
	},
	// And the foot back, last.
	rest(1),
]);

/** The backhand. @param u 0 standing, 1 back standing */
export function backhandPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(BACKHAND, u, out);
}

/* ------------------------------------------------------------------ stamp -- */

/** The moment the foot lands, as a fraction of the stamp. */
export const STAMP_HIT = 0.5;

const STAMP = keyed([
	{ t: 0 },
	// Raised: the weight over the left foot with the right hip hitched up,
	// the right foot hauled up to the belly with the knee out and the toes
	// down, the trunk leaning back and left off it, the arms out for
	// balance, the head down on the target.
	{
		t: 0.35,
		crouch: 0.16,
		shift: -0.05,
		sway: 0.28,
		root: [-0.08, 0.05, -0.08],
		spine: [-0.12, 0, -0.06],
		chest: [-0.15, 0, -0.08],
		neck: [0.1, 0, 0],
		head: [0.2, -0.05, 0.05],
		jaw: 0.35,
		shoulderL: [0, -0.05, 0.2],
		shoulderR: [0, 0.05, -0.2],
		armL: [-0.3, 0, 0.7],
		forearmL: [-0.3, 0, 0],
		handL: [-0.2, 0, 0],
		armR: [-0.3, 0, -0.7],
		forearmR: [-0.3, 0, 0],
		handR: [-0.2, 0, 0],
		footR: [-STANCE - 0.08, 0.55],
		liftR: 1.35,
		toeR: 0.45,
	},
	// The stamp: the foot driven down flat onto the ground a stride ahead,
	// the whole body dropping and coming forward onto it, the arms flung
	// down and back, the roar. Accelerating into the key.
	{
		t: STAMP_HIT,
		ease: 'in',
		crouch: 0.38,
		shift: 0.35,
		sway: 0.02,
		root: [0.15, 0, 0],
		spine: [0.3, 0, 0],
		chest: [0.2, 0, 0],
		neck: [0.05, 0, 0],
		head: [0.15, 0, 0],
		jaw: 0.6,
		shoulderL: [0, -0.12, -0.1],
		shoulderR: [0, 0.12, 0.1],
		armL: [0.35, 0, 0.5],
		forearmL: [-0.35, 0, 0],
		armR: [0.35, 0, -0.5],
		forearmR: [-0.35, 0, 0],
		footR: [-STANCE - 0.05, 1.15],
		liftR: 0,
		toeR: 0,
	},
	// Landed: sunk onto the foot, the trunk still coming.
	{
		t: 0.62,
		ease: 'out',
		crouch: 0.42,
		shift: 0.4,
		spine: [0.35, 0, 0],
		head: [0.2, 0, 0],
		jaw: 0.5,
		armL: [0.45, 0, 0.5],
		armR: [0.45, 0, -0.5],
	},
	// Recovering: the body coming up and back off the foot.
	{
		t: 0.82,
		crouch: 0.16,
		shift: 0.15,
		sway: 0,
		root: [0.06, 0, 0],
		spine: [0.1, 0, 0],
		chest: [0.08, 0, 0],
		neck: [STAND.neck, 0, 0],
		head: [-0.02, 0, 0],
		jaw: 0.15,
		shoulderL: STAND.shoulderL,
		shoulderR: STAND.shoulderR,
		armL: [-0.2, 0, 0.4],
		forearmL: STAND.forearmL,
		handL: STAND.handL,
		armR: [-0.2, 0, -0.4],
		forearmR: STAND.forearmR,
		handR: STAND.handR,
	},
	// And the foot back, last.
	rest(1),
]);

/** The stamp. @param u 0 standing, 1 back standing */
export function stampPose(u: number, out: SparsePose = {}): SparsePose {
	return strike(STAMP, u, out);
}
