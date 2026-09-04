/*
 * How the spider holds itself, as pure functions.
 *
 * The same bargain as every other gait here: parameters in, a pose out, no
 * state and no renderer types. Two of them, because the animal has two modes:
 *
 *   runPose   the scuttle — and, at amp 0, the stand it scuttles from
 *   spitPose  the strike, keyed by hand: it rears up onto its back legs, the
 *             front pairs off the ground and the fangs spread, snaps its head
 *             down and spits, and settles
 *
 * What is different about a spider is the legs. Every leg here points along
 * its own bearing round the body and works in its own vertical plane, so no
 * joint of it turns about the rig's x or z. Each leg is therefore SOLVED
 * rather than swung: the tip is put where the gait says, the leg's plane is
 * turned to face it, the femur and the rest of the leg are solved in that
 * plane as two links, and each joint's rotation is built as a quaternion —
 * a turn about the body's up axis and a turn about the plane's own axis —
 * and converted to the Euler angles a pose holds. That is what keeps eight
 * tips on the ground through a stride and lets the body rear without a leg
 * leaving the floor.
 *
 * The scuttle is the gait a real spider runs: the first and third legs of
 * one side with the second and fourth of the other, then the other four,
 * half a cycle apart. Two sets of four, each a tripod and more, which is why
 * it can go as fast as it does without ever being off the ground.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';
import { quat } from '@hexdelve/shared';

import { groundPath, twoLink, type Planar } from './planar.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u: number): number => u * u * (3 - 2 * u);

type Vec3 = readonly [number, number, number];

/**
 * The rig the legs are solved on, copied from `spider.rig.yaml` and pinned
 * to it by `test/assets.test.ts` — the same reason every gait here carries a
 * copy of what it was written against.
 */
export const SPIDER_CHAIN = {
	bodyHeight: 0.4,
	/** Out and up to the knee, in metres along the bearing and up. */
	femur: { out: 0.48 * Math.cos(deg(45)), rise: 0.48 * Math.sin(deg(45)) },
	tibia: { out: 0.5 * Math.cos(deg(25)), drop: 0.5 * Math.sin(deg(25)) },
	tarsus: { out: 0.5 * Math.cos(deg(70)), drop: 0.5 * Math.sin(deg(70)) },
	/** Each leg's root on the left side of the body, and the bearing it points along, +x round to +z. */
	legs: [
		{ coxa: [0.12, -0.02, 0.16] as Vec3, azimuth: deg(55) },
		{ coxa: [0.13, -0.02, 0.06] as Vec3, azimuth: deg(20) },
		{ coxa: [0.13, -0.02, -0.05] as Vec3, azimuth: deg(-20) },
		{ coxa: [0.12, -0.02, -0.15] as Vec3, azimuth: deg(-55) },
	],
} as const;

function deg(degrees: number): number {
	return (degrees * PI) / 180;
}

/** Where a tip bone sits with the claw on the ground: the claw's own radius. */
export const SPIDER_TIP = 0.038;

/** One leg as the solver sees it: its bones, its root, and where it rests. */
interface Leg {
	readonly names: readonly [string, string, string];
	readonly side: number;
	readonly coxa: Vec3;
	/** The bearing it points along at rest, as a unit vector in the body's plane. */
	readonly heading: Vec3;
	/** The axis its plane turns on: a turn about this by a positive angle tips the leg DOWN. */
	readonly normal: Vec3;
	/** Its tip at rest, in the actor's space. */
	readonly rest: Vec3;
}

/** The femur, and the tibia and tarsus as one rigid link, in a leg's plane: [up, out]. */
const FEMUR: Planar = [SPIDER_CHAIN.femur.rise, SPIDER_CHAIN.femur.out];
const LOWER: Planar = [
	-(SPIDER_CHAIN.tibia.drop + SPIDER_CHAIN.tarsus.drop),
	SPIDER_CHAIN.tibia.out + SPIDER_CHAIN.tarsus.out,
];

function makeLeg(index: number, side: number): Leg {
	const spec = SPIDER_CHAIN.legs[index]!;
	const n = index + 1;
	const s = side > 0 ? 'L' : 'R';
	const heading: Vec3 = [side * Math.cos(spec.azimuth), 0, Math.sin(spec.azimuth)];
	const coxa: Vec3 = [side * spec.coxa[0], spec.coxa[1], spec.coxa[2]];
	const reach = FEMUR[1] + LOWER[1];
	const drop = FEMUR[0] + LOWER[0];
	return {
		names: [`coxa${n}${s}`, `tibia${n}${s}`, `tarsus${n}${s}`],
		side,
		coxa,
		heading,
		// Up crossed with the heading: for a leg pointing out along +x that
		// is -z, and a positive turn about -z tips +x down.
		normal: [heading[2], 0, -heading[0]],
		rest: [
			coxa[0] + heading[0] * reach,
			SPIDER_CHAIN.bodyHeight + coxa[1] + drop,
			coxa[2] + heading[2] * reach,
		],
	};
}

/** The eight legs: index 0..3 left, 4..7 right. */
const LEGS: readonly Leg[] = [0, 1, 2, 3].map((i) => makeLeg(i, 1)).concat([0, 1, 2, 3].map((i) => makeLeg(i, -1)));

export const TIP_NAMES: readonly string[] = LEGS.map((leg) => leg.names[0].replace('coxa', 'tip'));

/** A unit quaternion turning about `axis` by `angle`. */
function axisAngle(axis: Vec3, angle: number): [number, number, number, number] {
	const s = Math.sin(angle / 2);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

const scratchQ = quat.quat();
const scratchTilt = quat.quat();
const scratchYaw = quat.quat();
const scratchInverse = quat.quat();
const euler: [number, number, number] = [0, 0, 0];
const local: [number, number, number] = [0, 0, 0];

/** How the body sits: its rotation and where its root is, in the actor's space. */
interface Body {
	readonly q: ArrayLike<number>;
	readonly at: Vec3;
}

/**
 * One leg, put with its tip at `target`.
 *
 * The target is taken into the body's own frame, the leg's plane is turned
 * about the body's up axis to face it, and the femur and the lower leg are
 * solved as two links in that plane. The coxa's rotation is the tilt in the
 * plane followed by the turn of the plane; the tibia's is a tilt in the same
 * plane, which in the coxa's frame is still the same axis; the tarsus keeps
 * its rest angle to the tibia, the two having been solved as one link.
 */
function placeLeg(out: SparsePose, leg: Leg, target: Vec3, body: Body): void {
	quat.conjugate(scratchInverse, body.q);
	local[0] = target[0] - body.at[0];
	local[1] = target[1] - body.at[1];
	local[2] = target[2] - body.at[2];
	quat.rotateVec3(local, scratchInverse, local);

	const vx = local[0] - leg.coxa[0];
	const vy = local[1] - leg.coxa[1];
	const vz = local[2] - leg.coxa[2];
	const radius = Math.hypot(vx, vz);
	const dx = vx / radius;
	const dz = vz / radius;
	// The signed turn about up from the rest heading to the target's.
	const yaw = Math.atan2(leg.heading[2] * dx - leg.heading[0] * dz, leg.heading[0] * dx + leg.heading[2] * dz);

	const [tiltFemur, tiltLower] = twoLink(0, [0, 0], FEMUR, LOWER, [vy, radius], -1);

	quat.set(scratchYaw, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
	quat.set(scratchTilt, ...axisAngle(leg.normal, tiltFemur));
	quat.multiply(scratchQ, scratchYaw, scratchTilt);
	setSparse(out, leg.names[0], quat.toEulerXYZ(euler, scratchQ));

	quat.set(scratchTilt, ...axisAngle(leg.normal, tiltLower));
	setSparse(out, leg.names[1], quat.toEulerXYZ(euler, scratchTilt));
	setSparse(out, leg.names[2], [0, 0, 0]);
}

/* -------------------------------------------------------------------- run -- */

/** One scuttle, in seconds, at amp = 1: two sets of four, each down once. */
export const SPIDER_RUN_PERIOD = 0.32;

/** Where in the cycle (0..1) the left front tip and then the right land. */
export const SPIDER_RUN_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** How far a tip travels back along the ground in one stance, halved. */
const HALF_STRIDE = 0.24;
/** How high a tip is carried mid-swing. */
const LIFT = 0.12;

/**
 * Which set a leg runs with: the first and third legs of the left side and
 * the second and fourth of the right are one set, the rest the other.
 */
const SET_OF = (leg: Leg): number => {
	const index = LEGS.indexOf(leg) % 4;
	const first = index === 0 || index === 2;
	return (leg.side > 0) === first ? 0 : 1;
};

const bodyRest: Vec3 = [0, SPIDER_CHAIN.bodyHeight, 0];
const bodyQ = quat.quat();
const target: [number, number, number] = [0, 0, 0];

/**
 * The scuttle, and the stand it starts from.
 *
 * At a run the body stays level and low, as a spider's does, and only the
 * abdomen shows the stride, bobbing behind. Standing, the body settles and
 * lifts slowly, the abdomen pulses, the fangs twitch, and the front legs
 * lift in turn to feel at the air ahead.
 *
 * @param theta cycle phase in radians (2 pi = one full scuttle)
 * @param amp   0 = standing, 1 = a full run
 * @param time  seconds, driving the stand
 */
export function runPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const sinT = Math.sin(theta);
	const settle = 0.006 * still * Math.sin(time * 1.6);

	const pitch = 0.02 * amp * Math.sin(2 * theta);
	const yaw = 0.03 * amp * sinT;
	const roll = 0.02 * amp * sinT;
	const at: Vec3 = [0, bodyRest[1] + settle, 0];
	quat.fromEulerXYZ(bodyQ, pitch, yaw, roll);
	setSparse(out, 'root', [pitch, yaw, roll], [0, settle, 0]);
	const body: Body = { q: bodyQ, at };

	for (const leg of LEGS) {
		const phase = SET_OF(leg) === 0 ? theta : theta + PI;
		const [y, z] = groundPath(phase, leg.rest[2], HALF_STRIDE, LIFT, SPIDER_TIP, amp);
		target[0] = leg.rest[0];
		target[1] = y;
		target[2] = z;
		// Standing, the front legs lift in turn and feel at the air ahead.
		if (still > 0 && LEGS.indexOf(leg) % 4 === 0) {
			const feel = Math.pow(Math.max(0, Math.sin(time * 0.9 + (leg.side > 0 ? 0 : 2.5))), 6) * still;
			target[1] += 0.14 * feel;
			target[2] += 0.1 * feel;
		}
		placeLeg(out, leg, target, body);
	}

	// The abdomen bobs behind at a run and pulses at the stand; the head
	// nods with the stride; the fangs twitch.
	const twitch = Math.pow(Math.sin(time * 2.3), 8) * still;
	setSparse(out, 'abdomen', [0.06 * amp * Math.sin(2 * theta + 0.5) + 0.02 * still * Math.sin(time * 1.6), 0, 0]);
	setSparse(out, 'head', [0.03 * amp * Math.sin(2 * theta) + 0.02 * still * Math.sin(time * 0.7), 0.05 * still * Math.sin(time * 0.4), 0]);
	setSparse(out, 'fangL', [-0.15 * twitch, 0.1 * twitch, 0]);
	setSparse(out, 'fangR', [-0.15 * twitch, -0.1 * twitch, 0]);
	return out;
}

/* ------------------------------------------------------------------- spit -- */

/**
 * What the strike moves, key by key. The legs are not keyed: the body is,
 * and the front pairs' tips are, and every leg is solved to them, so the
 * back legs stay on the ground however the body rears.
 */
interface SpitKey {
	readonly t: number;
	/** Body pitch: negative rears the front up. */
	readonly pitch: number;
	readonly rise: number;
	readonly back: number;
	/** How far the front pair's tips lift, and reach forward. */
	readonly lift1: number;
	readonly reach1: number;
	/** The same for the second pair. */
	readonly lift2: number;
	/** The fangs, spread apart and swung forward. */
	readonly spread: number;
	readonly strike: number;
	readonly head: number;
	readonly abdomen: number;
}

const REST_KEY = { pitch: 0, rise: 0, back: 0, lift1: 0, reach1: 0, lift2: 0, spread: 0, strike: 0, head: 0, abdomen: 0 };

const SPIT_KEYS: readonly SpitKey[] = [
	{ t: 0, ...REST_KEY },
	// Reared: the front up on the back legs, the front two pairs off the
	// ground and raised, the fangs spread wide, the face up, the tail
	// cocked up so the sac clears the ground the body pitches it towards.
	{ t: 0.28, pitch: -0.5, rise: 0.1, back: -0.06, lift1: 0.45, reach1: 0.25, lift2: 0.28, spread: 0.55, strike: 0, head: -0.25, abdomen: 0.3 },
	// The spit: the head snaps down and forward, the fangs snap together and
	// forward, the front legs jab, the tail whips down after the head.
	{ t: 0.42, pitch: -0.35, rise: 0.08, back: 0.05, lift1: 0.4, reach1: 0.45, lift2: 0.25, spread: 0.15, strike: 0.4, head: 0.3, abdomen: 0.12 },
	// Held a moment, the fangs still forward.
	{ t: 0.6, pitch: -0.3, rise: 0.06, back: 0.02, lift1: 0.35, reach1: 0.35, lift2: 0.2, spread: 0.3, strike: 0.2, head: 0.1, abdomen: 0.18 },
	{ t: 1, ...REST_KEY },
];

/** The moment the venom leaves, as a fraction of the strike. */
export const SPIT_AT = 0.42;

/**
 * The strike.
 * @param u 0 standing, 1 back standing
 */
export function spitPose(u: number, out: SparsePose = {}): SparsePose {
	const t = clamp01(u);
	let i = 0;
	while (i < SPIT_KEYS.length - 2 && t > SPIT_KEYS[i + 1]!.t) i++;
	const a = SPIT_KEYS[i]!;
	const b = SPIT_KEYS[i + 1]!;
	const span = b.t - a.t;
	const w = smooth(span > 1e-6 ? (t - a.t) / span : 0);
	const mix = (key: keyof Omit<SpitKey, 't'>): number => a[key] + (b[key] - a[key]) * w;

	const pitch = mix('pitch');
	const at: Vec3 = [0, bodyRest[1] + mix('rise'), mix('back')];
	quat.fromEulerXYZ(bodyQ, pitch, 0, 0);
	setSparse(out, 'root', [pitch, 0, 0], [0, at[1] - bodyRest[1], at[2]]);
	const body: Body = { q: bodyQ, at };

	const lift1 = mix('lift1');
	const reach1 = mix('reach1');
	const lift2 = mix('lift2');
	for (const leg of LEGS) {
		const index = LEGS.indexOf(leg) % 4;
		target[0] = leg.rest[0];
		target[1] = leg.rest[1] + (index === 0 ? lift1 : index === 1 ? lift2 : 0);
		target[2] = leg.rest[2] + (index === 0 ? reach1 : index === 1 ? reach1 * 0.5 : 0);
		placeLeg(out, leg, target, body);
	}

	const spread = mix('spread');
	const strike = mix('strike');
	setSparse(out, 'head', [mix('head'), 0, 0]);
	setSparse(out, 'fangL', [-strike, spread, 0]);
	setSparse(out, 'fangR', [-strike, -spread, 0]);
	setSparse(out, 'abdomen', [mix('abdomen'), 0, 0]);
	return out;
}

