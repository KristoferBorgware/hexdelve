/*
 * How the small kobold holds itself, as pure functions.
 *
 * The same bargain as every other gait here: parameters in, a pose out, no
 * state and no renderer types. Two of them, because the thing has two modes:
 *
 *   scurryPose  the walk and the run, one function at two settings of
 *               `gait` — and, at amp 0, the stand it goes from
 *   stabPose    the strike: it coils with the knife hand drawn back by the
 *               shoulder, steps in and drives the arm out straight, twists
 *               the blade, and comes back
 *
 * A small kobold is quick and never still. On its feet it fidgets: the head
 * darts rather than turns, the nose comes up to sniff, the ears flick one
 * after the other, the tail sways and twitches, the weight goes from foot
 * to foot, and the free hand comes round to rub at the belly. Moving, it goes
 * bandy-legged with short quick steps, and at a run it drops, leans into it
 * and pumps its arms with the elbows back.
 *
 * Each foot is solved against the ground through the plane of the body, as
 * the ghoul's are, so however far the pelvis rolls a planted foot stays put.
 *
 * Sign conventions are the kobold rig's, which are the humanoid's: it faces
 * +Z, +X is its left; limb bones hang down, so rot.x < 0 swings one FORWARD;
 * the spine, chest and head point up, so rot.x > 0 tips them FORWARD; the jaw
 * points forward, so rot.x > 0 opens it; the ears stand up, so rot.x > 0 lays
 * them back; the tail points back, so rot.x > 0 lifts it; a foot's rot.x > 0
 * points the toe DOWN; rot.y > 0 turns towards its own left.
 */

import { setSparse, type SparsePose } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink, type Planar } from './planar.js';

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u: number): number => u * u * (3 - 2 * u);

type Euler = readonly [number, number, number];

/**
 * The rig the legs are solved on, copied from `kobold.rig.yaml` and pinned
 * to it by `test/assets.test.ts` — the same reason every gait here carries
 * a copy of what it was written against. Each entry is [y, z] of a bone's
 * offset from its parent, in the plane the gait is solved in.
 */
export const KOBOLD_CHAIN = {
	hipHeight: 0.5,
	hip: [-0.03, 0] as const,
	hipWidth: 0.09,
	thigh: [-0.22, 0] as const,
	shin: [-0.2, 0] as const,
	spine: [0.1, 0] as const,
	chest: [0.14, 0] as const,
} as const;

/** Where the ankle sits with the sole on the ground: the depth of the foot. */
export const KOBOLD_SOLE = 0.05;

/** How far out the knees are turned: bandy-legged. */
const SPLAY = 0.2;

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
		plus(trunk.root, turn(KOBOLD_CHAIN.hip, trunk.rootRot)),
		[side * KOBOLD_CHAIN.hipWidth * Math.sin(roll), 0],
	);
	const [hip, knee] = twoLink(trunk.rootRot, hipAt, KOBOLD_CHAIN.thigh, KOBOLD_CHAIN.shin, target, -1);
	const level = -(trunk.rootRot + hip + knee);
	setSparse(out, `hip${s}`, [hip, 0, SPLAY * side]);
	setSparse(out, `shin${s}`, [knee, 0, 0]);
	setSparse(out, `foot${s}`, [level * (1 - 0.5 * swing) + 0.35 * swing, 0.2 * side, -0.1 * side]);
}

/** How far into its swing a foot at `phase` is, at this amp: 0 when standing. */
function swingOf(phase: number, amp: number): number {
	return Math.pow(Math.max(0, Math.cos(phase)), 0.8) * clamp01(amp);
}

/* ------------------------------------------------------------------ stand -- */

/**
 * The stand every strike starts from and comes back to, and the scurry at
 * amp 0 fidgets around: a little crouched, hunched over, the head low and
 * forward, the arms hanging out from the body, the tail up.
 */
const STAND = {
	crouch: 0.04,
	root: 0.1,
	spine: 0.15,
	chest: 0.05,
	neck: -0.05,
	head: -0.1,
	jaw: 0.1,
	tail: 0.25,
	tailTip: 0.1,
} as const;

/** An arm hanging straight down under the hunched trunk, and a little forward. */
const HANG = -(STAND.root + STAND.spine + STAND.chest) - 0.1;

/* ----------------------------------------------------------------- scurry -- */

/** One stride pair, in seconds, at a walk and at a run: quick, on legs this short. */
export const SCURRY_WALK_PERIOD = 0.7;
export const SCURRY_RUN_PERIOD = 0.45;

/** The cycle at a setting of `gait`, 0 a walk to 1 a run. */
export function scurryPeriod(gait: number): number {
	return SCURRY_WALK_PERIOD + (SCURRY_RUN_PERIOD - SCURRY_WALK_PERIOD) * clamp01(gait);
}

/** Where in the cycle (0..1) the left and then the right foot land. */
export const SCURRY_CONTACTS: readonly [number, number] = [0.25, 0.75];

/** The step at a walk and at a run: short and low, then longer and higher. */
const WALK_STEP = { restZ: 0.02, halfStride: 0.1, lift: 0.05 } as const;
const RUN_STEP = { restZ: 0.05, halfStride: 0.16, lift: 0.09 } as const;

/**
 * The scurry, and the stand it starts from.
 *
 * Walking, the pelvis rolls onto each planted foot and turns the stepping
 * hip forward, the trunk turns against it, and the arms swing against the
 * legs. At a run the whole thing drops and leans forward, the steps
 * lengthen, the arms pump with the elbows back and the mouth hangs open,
 * panting. Standing, it fidgets: every rhythm in the stand is a multiple of
 * one at 0.6 rad/s, so a stand baked over that cycle closes on itself, and
 * every one is faded out with the stride, so a walk baked over its own
 * cycle does.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full stride
 * @param gait  0 = a walk, 1 = a run
 * @param time  seconds, driving the stand
 */
export function scurryPose(theta: number, amp: number, gait: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const g = clamp01(gait) * clamp01(amp);
	const sinT = Math.sin(theta);

	const breath = still * Math.sin(time * 1.2);
	// The head darts: a slow sine squashed towards a square wave, so it sits
	// looking one way, snaps across and sits looking the other.
	const dart = Math.tanh(3 * Math.sin(time * 0.6)) * still;
	const sniff = Math.pow(Math.max(0, Math.sin(time * 1.2 + 0.5)), 4) * still;
	const flickL = Math.pow(Math.max(0, Math.sin(time * 1.2 + 1.0)), 6) * still;
	const flickR = Math.pow(Math.max(0, Math.sin(time * 1.2 - 1.0)), 6) * still;
	// The tail sways slowly, and once a cycle breaks into a quick twitch.
	const sway = Math.sin(time * 0.6 + 1.0) * still;
	const twitch = Math.pow(Math.max(0, Math.sin(time * 0.6 - 2.2)), 8) * Math.sin(time * 3.0) * still;
	const shift = Math.sin(time * 0.6) * still;
	// Once a cycle the left hand comes round to the belly and rubs at it.
	const scratch = Math.pow(Math.max(0, Math.sin(time * 0.6 - 1.2)), 6) * still;
	const scratching = Math.sin(time * 3.6) * scratch;

	// The mass rides over whichever foot is planted — the left through the
	// middle of its stance, at theta = pi — and dips just after each lands.
	const over = -Math.cos(theta) * amp;
	const dip = (0.015 * amp * (1 + Math.cos(2 * theta - PI - 0.5))) / 2;
	const roll = (0.06 + 0.03 * g) * over + 0.03 * shift;
	const rootRot = STAND.root + 0.25 * g + 0.02 * amp * Math.cos(2 * theta);
	const rootY = KOBOLD_CHAIN.hipHeight - STAND.crouch - dip - 0.05 * g - 0.005 * breath;
	setSparse(
		out,
		'root',
		[rootRot, -0.1 * amp * sinT, roll],
		[0.02 * over + 0.012 * shift, rootY - KOBOLD_CHAIN.hipHeight, 0],
	);
	const trunk: Trunk = { root: [rootY, 0], rootRot };

	const restZ = WALK_STEP.restZ + (RUN_STEP.restZ - WALK_STEP.restZ) * g;
	const halfStride = WALK_STEP.halfStride + (RUN_STEP.halfStride - WALK_STEP.halfStride) * g;
	const lift = WALK_STEP.lift + (RUN_STEP.lift - WALK_STEP.lift) * g;
	for (const side of [1, -1] as const) {
		const phase = side > 0 ? theta : theta + PI;
		const target = groundPath(phase, restZ, halfStride, lift, KOBOLD_SOLE, amp);
		leg(out, side, trunk, roll, target, swingOf(phase, amp));
	}

	// The trunk: hunched, more so at a run, turning against the hips.
	setSparse(out, 'spine', [STAND.spine + 0.1 * g + 0.02 * breath, 0.1 * amp * sinT, -0.4 * roll]);
	setSparse(out, 'chest', [STAND.chest + 0.05 * g + 0.03 * breath, 0.08 * amp * sinT, -0.2 * roll]);
	// The head: low and forward, up to look ahead at a run, darting and
	// sniffing at the stand; the jaw open and panting at a run.
	setSparse(out, 'neck', [STAND.neck - 0.15 * g - 0.08 * sniff, 0.15 * dart, 0]);
	setSparse(out, 'head', [
		STAND.head - 0.1 * g - 0.2 * sniff + 0.03 * amp * Math.cos(2 * theta),
		0.35 * dart + 0.06 * amp * sinT,
		0.1 * dart,
	]);
	setSparse(out, 'jaw', [STAND.jaw + 0.2 * g + 0.05 * amp * (1 - Math.cos(2 * theta)) + 0.05 * breath + 0.1 * sniff, 0, 0]);
	// The ears: flicking one after the other at the stand, bouncing with the
	// stride, laid back at a run.
	setSparse(out, 'earL', [-0.35 * flickL + 0.1 * amp * Math.cos(2 * theta) + 0.6 * g, 0, 0.1 * flickL]);
	setSparse(out, 'earR', [-0.35 * flickR + 0.1 * amp * Math.cos(2 * theta) + 0.6 * g, 0, -0.1 * flickR]);

	// The arms swing against the legs, and pump with the elbows back at a
	// run. The left hand rubs at the belly at the stand; the right
	// holds the knife and hangs.
	const swing = (0.35 + 0.25 * g) * amp;
	setSparse(out, 'armL', [
		HANG + swing * sinT + 0.3 * g - 0.9 * scratch + 0.02 * breath,
		0.05 + 0.25 * scratch,
		0.2 + 0.15 * scratch,
	]);
	setSparse(out, 'forearmL', [-0.4 - 0.5 * g - 0.2 * amp * Math.max(0, -sinT) - 0.9 * scratch, 0.1, 0]);
	setSparse(out, 'handL', [-0.2 + 0.25 * scratching, 0.15 * scratch, 0]);
	setSparse(out, 'armR', [HANG - swing * sinT + 0.3 * g + 0.02 * breath, -0.05, -0.2]);
	setSparse(out, 'forearmR', [-0.4 - 0.5 * g - 0.2 * amp * Math.max(0, sinT), -0.1, 0]);
	setSparse(out, 'handR', [-0.15, 0, 0]);

	// The tail: up, wagging with the roll, swaying and twitching at the
	// stand, streaming out behind at a run.
	setSparse(out, 'tail', [STAND.tail + 0.1 * breath - 0.2 * g, 0.5 * roll + 0.12 * sway + 0.1 * twitch, 0]);
	setSparse(out, 'tailTip', [
		STAND.tailTip + 0.1 * amp * Math.sin(2 * theta) - 0.1 * g,
		0.3 * roll + 0.18 * sway + 0.15 * twitch,
		0,
	]);
	return out;
}

/* ------------------------------------------------------------------- stab -- */

/** How a segment arrives at its key: eased both ends, accelerating into it, or braking. */
type Ease = 'smooth' | 'in' | 'out';

/**
 * What the strike keys: the pelvis, the trunk, the arms, the ears and the
 * tail, and where each foot stands along the ground. The legs are not
 * keyed; they are solved from the pelvis to the feet, so the lunge can go
 * as far as it likes and the feet stay where they were put.
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
	readonly jaw: number;
	readonly ears: number;
	readonly tail: Euler;
	readonly tailTip: Euler;
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
	'neck',
	'head',
	'jaw',
	'ears',
	'tail',
	'tailTip',
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
	jaw: STAND.jaw,
	ears: 0,
	tail: [STAND.tail, 0, 0],
	tailTip: [STAND.tailTip, 0, 0],
	armL: [HANG, 0.05, 0.2],
	forearmL: [-0.4, 0.1, 0],
	handL: [-0.2, 0, 0],
	armR: [HANG, -0.05, -0.2],
	forearmR: [-0.4, -0.1, 0],
	handR: [-0.15, 0, 0],
	footL: WALK_STEP.restZ,
	footR: WALK_STEP.restZ,
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
	spine: [0, 0, 0],
	chest: [0, 0, 0],
	neck: [0, 0, 0],
	head: [0, 0, 0],
	jaw: 0,
	ears: 0,
	tail: [0, 0, 0],
	tailTip: [0, 0, 0],
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

/** The moment the point goes in, as a fraction of the stab. */
export const STAB_HIT = 0.42;

const STAB = keyed([
	{ t: 0 },
	// Coiled: down a little and turned to its right, the knife hand drawn
	// back to the shoulder with the blade pointing at the target, the other
	// arm out ahead, the ears back, the lip up off the teeth.
	{
		t: 0.25,
		crouch: 0.08,
		shift: -0.03,
		root: 0.15,
		spine: [0.2, -0.3, 0],
		chest: [0.05, -0.3, 0],
		neck: [0, 0.2, 0],
		head: [-0.15, 0.25, 0],
		jaw: 0.4,
		ears: 0.6,
		tail: [0.4, 0, 0],
		tailTip: [0.2, 0, 0],
		armR: [1.1, -0.2, -0.35],
		forearmR: [-1.6, 0, 0],
		handR: [0.3, 0, 0],
		armL: [-0.7, 0, 0.3],
		forearmL: [-0.5, 0.1, 0],
		handL: [-0.3, 0, 0],
	},
	// The stab: the left foot steps in, the pelvis drives forward, the
	// trunk turns through the other way and the arm goes out straight with
	// the point leading, the other arm thrown back. Accelerating into the
	// key, so the point is at full speed when it lands.
	{
		t: STAB_HIT,
		ease: 'in',
		crouch: 0.1,
		shift: 0.14,
		root: 0.35,
		spine: [0.3, 0.2, 0],
		chest: [0.2, 0.3, 0],
		neck: [0, -0.1, 0],
		head: [-0.2, -0.1, 0],
		jaw: 0.6,
		ears: 0.7,
		tail: [-0.1, 0, 0],
		tailTip: [-0.1, 0, 0],
		armR: [-2.0, 0.3, -0.1],
		forearmR: [-0.1, 0, 0],
		handR: [-0.2, 0, 0],
		armL: [0.6, 0, 0.4],
		forearmL: [-0.4, 0.1, 0],
		footL: 0.2,
	},
	// Twisted: the blade turned in the wound, the weight still coming.
	{
		t: 0.55,
		ease: 'out',
		crouch: 0.11,
		shift: 0.16,
		armR: [-2.1, 0.5, -0.1],
		handR: [-0.3, 0.3, 0],
		jaw: 0.5,
	},
	// Recovering: the knife drawn back, the weight coming back.
	{
		t: 0.75,
		crouch: 0.06,
		shift: 0.05,
		root: 0.15,
		spine: [0.18, 0, 0],
		chest: [0.08, 0.05, 0],
		neck: [STAND.neck, 0, 0],
		head: [-0.1, 0, 0],
		jaw: 0.25,
		ears: 0.3,
		tail: [0.2, 0, 0],
		tailTip: [0.1, 0, 0],
		armR: [-0.6, 0, -0.25],
		forearmR: [-0.9, -0.1, 0],
		handR: [-0.1, 0, 0],
		armL: [-0.2, 0.05, 0.25],
		forearmL: [-0.5, 0.1, 0],
		handL: [-0.2, 0, 0],
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
	return 0.05 * Math.min(1, distance / 0.18) * Math.sin(PI * w);
}

/** The strike. @param u 0 standing, 1 back standing */
export function stabPose(u: number, out: SparsePose = {}): SparsePose {
	const t = clamp01(u);
	let i = 0;
	while (i < STAB.length - 2 && t > STAB[i + 1]!.t) i++;
	const a = STAB[i]!;
	const b = STAB[i + 1]!;
	const span = b.t - a.t;
	const raw = span > 1e-6 ? (t - a.t) / span : 0;
	const w = b.ease === 'in' ? raw * raw : b.ease === 'out' ? 1 - (1 - raw) * (1 - raw) : smooth(raw);
	const k = blend(a, b, w);

	const rootY = KOBOLD_CHAIN.hipHeight - k.crouch;
	setSparse(out, 'root', [k.root, 0, 0], [0, -k.crouch, k.shift]);
	const trunk: Trunk = { root: [rootY, k.shift], rootRot: k.root };
	leg(out, 1, trunk, 0, [KOBOLD_SOLE + stepArc(a.footL, b.footL, w), k.footL], 0);
	leg(out, -1, trunk, 0, [KOBOLD_SOLE + stepArc(a.footR, b.footR, w), k.footR], 0);

	setSparse(out, 'spine', k.spine);
	setSparse(out, 'chest', k.chest);
	setSparse(out, 'neck', k.neck);
	setSparse(out, 'head', k.head);
	setSparse(out, 'jaw', [k.jaw, 0, 0]);
	setSparse(out, 'earL', [k.ears, 0, 0]);
	setSparse(out, 'earR', [k.ears, 0, 0]);
	setSparse(out, 'tail', k.tail);
	setSparse(out, 'tailTip', k.tailTip);
	setSparse(out, 'armL', k.armL);
	setSparse(out, 'forearmL', k.forearmL);
	setSparse(out, 'handL', k.handL);
	setSparse(out, 'armR', k.armR);
	setSparse(out, 'forearmR', k.forearmR);
	setSparse(out, 'handR', k.handR);
	return out;
}
