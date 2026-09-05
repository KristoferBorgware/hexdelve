/*
 * How the hellhound holds itself, as pure functions.
 *
 * The same bargain the stride and the bat's poses both make: parameters in, a
 * pose out, no state and no renderer types.
 *
 * Three of them, because the animal has three modes and no more:
 *
 *   runPose    the trot — and, at amp 0, the standing idle it trots from
 *   bitePose   the lunge, keyed by hand because it has a gather, a throw, a
 *              contact and a recovery, the same shape the bat's lunge takes
 *   restPose   down on its haunches, breathing
 *
 * `runPose` covers two of the bat's three modes in one function because a walk
 * and a run are the same trot at two amplitudes here too: `amp` throttles
 * between a standing animal and a full one, and the standstill — the head up,
 * the ears twitching, the breathing — is faded in as the trot fades out, so a
 * blend between the two passes through no pose that is neither.
 *
 * The trot's paws are put on the ground and the legs solved to them, the way
 * the dire hellhound's gallop and the ghoul's shamble are. A paw is planted
 * from one contact to the other and travels straight back at a constant rate
 * in between, so the ground the animal covers is the ground its paws cover.
 */

import { mixSparse, setSparse, type SparsePose } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink, type Planar } from './planar.js';

/*
 * The bones this gait was written against — see the note in batpose.ts for why
 * they travel with the function rather than being fetched. Pinned to
 * `hellhound.rig.yaml` by `test/assets.test.ts`.
 */
const LEGS: Record<'frontL' | 'frontR' | 'backL' | 'backR', readonly string[]> = {
	frontL: ['frontLegL', 'frontShinL', 'frontPawL'],
	frontR: ['frontLegR', 'frontShinR', 'frontPawR'],
	backL: ['backLegL', 'backShinL', 'backPawL'],
	backR: ['backLegR', 'backShinR', 'backPawR'],
};

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One full stride pair, in seconds, at amp = 1. */
export const HOUND_STRIDE_PERIOD = 0.5;

/**
 * Where in the cycle (0..1) the rig's two measured paws land: the left hind
 * paw first, the right hind paw half a cycle later. The two hind paws are the
 * pair the rig names, and in a trot they alternate, which is what lets the
 * engine's ground speed measurement read this gait.
 */
export const HOUND_RUN_CONTACTS: readonly [number, number] = [0.25, 0.75];

/* -------------------------------------------------------------------- run -- */

/*
 * The rest offsets of the chain the trot is solved on, in the y-z plane —
 * copied from `hellhound.rig.yaml` and pinned to it by `test/assets.test.ts`,
 * for the same reason the stride carries its own leg length: a planted paw is
 * a statement about a particular skeleton, and fetching one would make this
 * something other than a function of an angle.
 *
 * Each entry is [y, z] of a bone's offset from its parent; x plays no part,
 * because every rotation in the gait is about x and the legs move in the plane
 * of the body — see planar.ts, which solves them. Both pairs are the same two
 * lengths, which is a fact about this animal rather than about quadrupeds.
 */
export const HOUND_CHAIN = {
	hipHeight: 0.5,
	spineMid: [0.05, 0.22],
	chest: [0.06, 0.22],
	frontLeg: [-0.04, 0.06],
	backLeg: [-0.04, -0.08],
	upper: [-0.22, 0],
	lower: [-0.19, 0],
	/** Where a paw bone sits with the paw flat on the ground: the paw's depth. */
	pawHeight: 0.05,
} as const;

/**
 * How the animal carries itself, standing and trotting alike.
 *
 * A leg is 0.41 m and a hip joint at rest sits 0.46 m up, so a hind leg
 * straight down reaches the ground and has nothing left over to stride with.
 * Both pairs therefore need the body lower than the rig's rest height, and
 * the front pair needs more of it than the hind: its shoulder is carried
 * 0.11 m higher up the spine than the hip. So the trunk crouches and pitches
 * nose-down together, which is how a hound stands anyway, and both pairs come
 * out with room either side of the joint they hang from.
 */
const STAND = { crouch: 0.1, root: 0.16 };

/** Half of how far a paw travels along the ground in one stance, at amp 1. */
const HALF_STRIDE = 0.16;

/** How high a paw is carried at mid-swing. */
const FRONT_LIFT = 0.09;
const BACK_LIFT = 0.1;

/** Where the paws stand at rest along the body, from the rig's offsets. */
const FRONT_PAW_Z = HOUND_CHAIN.spineMid[1] + HOUND_CHAIN.chest[1] + HOUND_CHAIN.frontLeg[1];
const BACK_PAW_Z = HOUND_CHAIN.backLeg[1];

/** The rotations of the spine, and where they put the two leg roots. */
interface Trunk {
	readonly root: Planar;
	readonly rootRot: number;
	readonly spineRot: number;
	readonly chestRot: number;
}

/**
 * One leg, from the joint it hangs off to the paw, with the paw put where
 * `groundPath` says.
 *
 * The two pairs differ in three things and no more: where they hang from, how
 * far forward they stand, and which way the middle joint folds — an elbow
 * points back, a stifle points forward. Everything else is one solve, which is
 * what lets a trot be four calls.
 *
 * @param at    the leg root, and the rotation of the frame it hangs in
 * @param bend  +1 folds the middle joint back (a front leg), -1 forward
 */
function leg(
	out: SparsePose,
	bones: readonly string[],
	phase: number,
	amp: number,
	side: number,
	at: { readonly joint: Planar; readonly frame: number },
	restZ: number,
	lift: number,
	bend: number,
): void {
	const fold = Math.pow(Math.max(0, Math.cos(phase)), 0.8);
	const target = groundPath(phase, restZ, HALF_STRIDE, lift, HOUND_CHAIN.pawHeight, amp);
	const [upper, lower] = twoLink(
		at.frame,
		at.joint,
		HOUND_CHAIN.upper,
		HOUND_CHAIN.lower,
		target,
		bend,
	);

	// Flat on the ground through the stance; in the air it hangs off the
	// ankle with the toes down, which is what reads as a paw rather than a peg.
	const level = -(at.frame + upper + lower);
	const paw = level * (1 - 0.6 * fold) + 0.3 * amp * fold;

	setSparse(out, bones[0]!, [upper, 0, 0.05 * side]);
	setSparse(out, bones[1]!, [lower, 0, 0]);
	setSparse(out, bones[2]!, [paw, 0, 0]);
}

/** Forward kinematics down the spine to the shoulder joint, and the frame there. */
function shoulderOf(trunk: Trunk): { joint: Planar; frame: number } {
	let frame = trunk.rootRot;
	let joint = plus(trunk.root, turn(HOUND_CHAIN.spineMid, frame));
	frame += trunk.spineRot;
	joint = plus(joint, turn(HOUND_CHAIN.chest, frame));
	frame += trunk.chestRot;
	joint = plus(joint, turn(HOUND_CHAIN.frontLeg, frame));
	return { joint, frame };
}

/**
 * The trot, and the standstill it trots from.
 *
 * Front left with back right, front right with back left — the two diagonal
 * pairs a real trot alternates, half a cycle apart. Faster than a walk needs
 * to be four legs taking turns one at a time, and reads as a run rather than
 * a totter the moment two paws are always down at once instead of one.
 *
 * Every paw is put on the ground by `groundPath` and the leg solved to it, so
 * a planted paw travels straight back at a constant rate whatever the spine
 * above it is doing. That is what makes the measured ground speed honest: the
 * animal covers exactly the ground its paws cover, rather than whatever a set
 * of joint angles happens to work out to.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full trot
 * @param time  seconds, driving the breathing and the idle at the standstill
 */
export function runPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);
	const breath = Math.sin(time * 1.7);

	/*
	 * The body bounces twice a cycle, once a diagonal pair each, and the spine
	 * works with it the way a running animal's visibly does and a walking
	 * human's barely does: the back humps as a pair gathers under it and
	 * flattens as that pair drives.
	 */
	const bob = 0.02 * amp * Math.cos(2 * theta);
	const hump = 0.05 * amp * Math.cos(2 * theta);
	const trunk: Trunk = {
		root: [HOUND_CHAIN.hipHeight - STAND.crouch + bob + 0.004 * still * breath, 0],
		rootRot: STAND.root - hump,
		spineRot: 0.1 * amp * Math.cos(2 * theta),
		chestRot: -0.06 * amp + 0.015 * still * breath,
	};
	setSparse(
		out,
		'root',
		[trunk.rootRot, 0, 0],
		[0, trunk.root[0] - HOUND_CHAIN.hipHeight, 0],
	);
	setSparse(out, 'spineMid', [trunk.spineRot, 0, 0]);
	setSparse(out, 'chest', [trunk.chestRot, 0, 0]);

	const hip = { joint: plus(trunk.root, turn(HOUND_CHAIN.backLeg, trunk.rootRot)), frame: trunk.rootRot };
	const shoulder = shoulderOf(trunk);

	// The left hind paw leads, so it lands at a quarter of the way through and
	// the right at three quarters — which is the schedule the rig's pair of
	// feet is read at.
	leg(out, LEGS.backL, theta, amp, 1, hip, BACK_PAW_Z, BACK_LIFT, -1);
	leg(out, LEGS.backR, theta + PI, amp, -1, hip, BACK_PAW_Z, BACK_LIFT, -1);
	leg(out, LEGS.frontR, theta, amp, -1, shoulder, FRONT_PAW_Z, FRONT_LIFT, 1);
	leg(out, LEGS.frontL, theta + PI, amp, 1, shoulder, FRONT_PAW_Z, FRONT_LIFT, 1);

	/*
	 * Neck and head. At a trot the head is carried level and steady over the
	 * working back — an animal that bobs its head at every step is lame — and
	 * at the standstill it comes up and casts about instead.
	 */
	const cast = Math.sin(time * 0.85) * still;
	setSparse(out, 'neck', [-0.12 * amp - 0.1 * still, 0.06 * cast, 0]);
	setSparse(out, 'head', [
		-0.06 * amp + 0.03 * amp * Math.sin(2 * theta) - 0.05 * still,
		0.18 * cast,
		0.02 * still * Math.sin(time * 0.85 - 1.1),
	]);
	setSparse(out, 'jaw', [0.05 * amp + still * (0.02 + 0.02 * breath), 0, 0]);

	// Ears pin back at speed and twitch at the stand; the tail trails and
	// whips a little, one segment lagging the other.
	setSparse(out, 'earL', [-0.15 * amp, 0, 0.1 + 0.03 * still * Math.sin(time * 2.55)]);
	setSparse(out, 'earR', [-0.15 * amp, 0, -0.1 - 0.03 * still * Math.sin(time * 3.4 + 0.7)]);
	setSparse(out, 'tailA', [
		0.15 + 0.1 * amp,
		0.12 * amp * Math.sin(theta - 0.4) + 0.06 * cast,
		0,
	]);
	setSparse(out, 'tailB', [
		0.1 + 0.08 * amp,
		0.18 * amp * Math.sin(theta - 1.1) + 0.09 * Math.sin(time * 0.85 - 0.6) * still,
		0,
	]);

	return out;
}

/* ------------------------------------------------------------------- bite -- */

/*
 * The strike, as four keys: gather, throw, contact, recover — the bat's own
 * shape, because a lunging bite and a lunging peck are the same problem. The
 * hind legs load on the gather and drive on the throw, which is where all the
 * power in a real pounce actually comes from; the front legs mostly just
 * reach.
 *
 * `rootPos` carries the body forward inside the pose the same way it does for
 * the bat: a hexagon's neighbours are 1.73 m apart, so a strike that only
 * leaned would close on nothing. The travel is a leap and a recovery inside
 * the pose, not the creature being moved — it lunges and is still exactly
 * where the grid says it is.
 */

interface BiteKeySpec {
	front?: number;
	frontShin?: number;
	frontPaw?: number;
	back?: number;
	backShin?: number;
	backPaw?: number;
	root?: [number, number, number];
	rootPos?: [number, number, number];
	spine?: [number, number, number];
	chest?: [number, number, number];
	neck?: [number, number, number];
	head?: [number, number, number];
	jaw?: number;
	ear?: number;
	tailA?: number;
	tailB?: number;
}

function keyPose(p: BiteKeySpec): SparsePose {
	const out: SparsePose = {};
	for (const bones of [LEGS.frontL, LEGS.frontR]) {
		setSparse(out, bones[0]!, [p.front ?? 0, 0, 0]);
		setSparse(out, bones[1]!, [p.frontShin ?? 0, 0, 0]);
		setSparse(out, bones[2]!, [p.frontPaw ?? 0, 0, 0]);
	}
	for (const bones of [LEGS.backL, LEGS.backR]) {
		setSparse(out, bones[0]!, [p.back ?? 0, 0, 0]);
		setSparse(out, bones[1]!, [p.backShin ?? 0, 0, 0]);
		setSparse(out, bones[2]!, [p.backPaw ?? 0, 0, 0]);
	}
	setSparse(out, 'root', p.root ?? [0, 0, 0], p.rootPos ?? [0, 0, 0]);
	setSparse(out, 'spineMid', p.spine ?? [0, 0, 0]);
	setSparse(out, 'chest', p.chest ?? [0, 0, 0]);
	setSparse(out, 'neck', p.neck ?? [0, 0, 0]);
	setSparse(out, 'head', p.head ?? [0, 0, 0]);
	setSparse(out, 'jaw', [p.jaw ?? 0, 0, 0]);
	setSparse(out, 'earL', [p.ear ?? 0, 0, 0.1]);
	setSparse(out, 'earR', [p.ear ?? 0, 0, -0.1]);
	setSparse(out, 'tailA', [p.tailA ?? 0, 0, 0]);
	setSparse(out, 'tailB', [p.tailB ?? 0, 0, 0]);
	return out;
}

const BITE_KEYS: { t: number; p: SparsePose }[] = [
	// Gather: haunches loaded low and forward under the body, front legs
	// drawn in, head pulled back over the shoulders — a spring, wound.
	{
		t: 0,
		p: keyPose({
			front: -0.5,
			frontShin: 1.1,
			frontPaw: -0.3,
			back: 0.9,
			backShin: 1.6,
			backPaw: -0.5,
			root: [0.2, 0, 0],
			rootPos: [0, -0.04, -0.14],
			spine: [0.1, 0, 0],
			neck: [-0.15, 0, 0],
			head: [-0.1, 0, 0],
			jaw: 0.1,
			ear: -0.15,
			tailA: 0.05,
			tailB: 0.05,
		}),
	},
	// Throw: the hind legs snap straight and drive the whole animal forward;
	// the front pair reach out ahead of it, and the jaws start to open.
	{
		t: 0.32,
		p: keyPose({
			front: -1.1,
			frontShin: 0.3,
			frontPaw: 0.4,
			back: -0.6,
			backShin: 0.2,
			backPaw: 0.2,
			root: [-0.25, 0, 0],
			rootPos: [0, 0.06, 0.85],
			spine: [-0.15, 0, 0],
			chest: [-0.05, 0, 0],
			neck: [-0.05, 0, 0],
			head: [0.05, 0, 0],
			jaw: 0.55,
			ear: 0.1,
			tailA: -0.15,
			tailB: -0.2,
		}),
	},
	// Contact, a beat later and barely moved further: the stop sells the
	// hit, exactly as it does for the bat.
	{
		t: 0.45,
		p: keyPose({
			front: -0.9,
			frontShin: 0.5,
			frontPaw: 0.2,
			back: -0.7,
			backShin: 0.35,
			backPaw: 0.25,
			root: [-0.3, 0, 0],
			rootPos: [0, 0.02, 1.0],
			spine: [-0.1, 0, 0],
			chest: [-0.02, 0, 0],
			neck: [-0.02, 0, 0],
			head: [0.12, 0, 0],
			jaw: 0.95,
			ear: 0.25,
			tailA: -0.2,
			tailB: -0.3,
		}),
	},
	// Recover: haunches back under the body, jaw closing, weight settling.
	{
		t: 1,
		p: keyPose({
			front: 0.1,
			frontShin: 0.5,
			frontPaw: -0.2,
			back: 0.3,
			backShin: 0.7,
			backPaw: -0.2,
			root: [0.05, 0, 0],
			rootPos: [0, 0.0, -0.05],
			spine: [0, 0, 0],
			neck: [-0.1, 0, 0],
			head: [-0.02, 0, 0],
			jaw: 0.1,
			ear: -0.1,
			tailA: 0.08,
			tailB: 0.1,
		}),
	},
];

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * The strike.
 * @param u 0 at the gather, 1 back at rest
 */
export function bitePose(u: number, out: SparsePose = {}): SparsePose {
	const t = Math.max(0, Math.min(1, u));
	let i = 0;
	while (i < BITE_KEYS.length - 2 && t > BITE_KEYS[i + 1]!.t) i++;
	const a = BITE_KEYS[i]!;
	const b = BITE_KEYS[i + 1]!;
	const span = b.t - a.t;
	return mixSparse(out, a.p, b.p, smooth(span > 1e-6 ? (t - a.t) / span : 0));
}

/**
 * The fraction of the bite at which the jaws arrive — the moment worth
 * measuring a reach from, the same role `LUNGE_CONTACT` plays for the bat.
 */
export const BITE_CONTACT = 0.45;

/* ------------------------------------------------------------------- rest -- */

/**
 * Down on the ground: legs folded under the body, belly close to the earth,
 * head up and watching rather than asleep — a hellhound rests the way a dog
 * that trusts nothing does, not the way one that is merely tired does.
 */
export function restPose(time: number, out: SparsePose = {}): SparsePose {
	const breath = Math.sin(time * 1.4);

	// The body sinks: root drops about half the standing hip height, and the
	// spine settles flatter along with it.
	setSparse(out, 'root', [0.1, 0, 0], [0, -0.28 - 0.007 * breath, 0]);
	setSparse(out, 'spineMid', [-0.05, 0, 0]);
	setSparse(out, 'chest', [0.03 + 0.015 * breath, 0, 0]);
	setSparse(out, 'neck', [-0.2, 0, 0]);
	setSparse(out, 'head', [-0.1 + 0.03 * Math.sin(time * 0.7), 0, 0]);
	setSparse(out, 'jaw', [0.05, 0, 0]);
	setSparse(out, 'earL', [0.05, 0, 0.12]);
	setSparse(out, 'earR', [0.05, 0, -0.12]);

	/*
	 * The legs, folded rather than merely bent: the front pair swing forward
	 * at the shoulder and fold back hard at the elbow, tucking the paws in
	 * just ahead of the chest; the hind pair draw up under the haunches the
	 * same way. Both pairs land within a centimetre of the ground doing it —
	 * checked against the actual bone chain, not eyeballed, because a paw
	 * that is even a little wrong here reads as broken rather than as folded.
	 * The paw's own rotation does not move it at all; it only turns the paw
	 * flat, cancelling most of what the leg and the shin added ahead of it.
	 */
	setSparse(out, 'frontLegL', [-1.19, 0, 0.08]);
	setSparse(out, 'frontShinL', [1.99, 0, 0]);
	setSparse(out, 'frontPawL', [-0.56, 0, 0]);
	setSparse(out, 'frontLegR', [-1.19, 0, -0.08]);
	setSparse(out, 'frontShinR', [1.99, 0, 0]);
	setSparse(out, 'frontPawR', [-0.56, 0, 0]);

	setSparse(out, 'backLegL', [0.87, 0, 0.15]);
	setSparse(out, 'backShinL', [-2.37, 0, 0]);
	setSparse(out, 'backPawL', [1.05, 0, 0]);
	setSparse(out, 'backLegR', [0.87, 0, -0.15]);
	setSparse(out, 'backShinR', [-2.37, 0, 0]);
	setSparse(out, 'backPawR', [1.05, 0, 0]);

	// The tail lies still, just settling once rather than looping — a wag
	// belongs to a dog that likes what it sees.
	setSparse(out, 'tailA', [0.3, 0.04 * Math.sin(time * 0.7), 0]);
	setSparse(out, 'tailB', [0.25, 0.05 * Math.sin(time * 0.7 - 0.4), 0]);
	return out;
}
