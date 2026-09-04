/*
 * How the dire hellhound holds itself, as pure functions.
 *
 * The same bargain the stride, the bat's poses and the hellhound's all make:
 * parameters in, a pose out, no state and no renderer types.
 *
 * Three of them, because the animal has three modes and no more:
 *
 *   runPose    the gallop — and, at amp 0, the stare it gallops from
 *   bitePose   the strike, keyed by hand: gather, throw, contact, wrench,
 *              recover — one key more than the bat's lunge and the hellhound's
 *              bite, because a jaw that has closed on something wrenches it
 *   restPose   down on its chest, forelegs out, head up and watching
 *
 * The gait is a gallop rather than the hellhound's trot. A trot moves diagonal
 * pairs half a cycle apart and keeps the back level; a gallop moves the hind
 * pair against the front pair, and the spine does the work in between —
 * arched while the hind legs gather under the body, hollow while they drive.
 * That flex is what makes a big animal look heavy at speed, and it is the
 * whole reason the rig's spine is three segments and the neck two.
 *
 * `runPose` covers two modes in one function, as the hellhound's does: `amp`
 * throttles between a standing animal and a full gallop, and the stare — head
 * low, hackles up, breathing — is faded in as the gallop fades out, so a blend
 * between the two passes through no pose that is neither.
 */

import { mixSparse, setSparse, type SparsePose } from '@hexdelve/engine';

import { groundPath, plus, turn, twoLink, type Planar } from './planar.js';

/*
 * The bones this gait was written against — see the note in batpose.ts for why
 * they travel with the function rather than being fetched. Pinned to
 * `direhound.rig.yaml` by `test/assets.test.ts`.
 */
const LEGS: Record<'frontL' | 'frontR' | 'backL' | 'backR', readonly string[]> = {
	frontL: ['shoulderL', 'frontLegL', 'frontShinL', 'frontWristL', 'frontPawL'],
	frontR: ['shoulderR', 'frontLegR', 'frontShinR', 'frontWristR', 'frontPawR'],
	backL: ['backLegL', 'backShinL', 'backHockL', 'backPawL'],
	backR: ['backLegR', 'backShinR', 'backHockR', 'backPawR'],
};

const PI = Math.PI;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** One full gallop stride, in seconds, at amp = 1. Big animals stride slowly. */
export const DIRE_STRIDE_PERIOD = 0.62;

/**
 * Where in the cycle (0..1) the rig's two measured feet land: the left hind
 * paw first, the left front paw half a cycle later. A gallop's hind pair and
 * front pair alternate the way a walker's two feet do, which is what lets the
 * engine's ground speed measurement read this gait at all — see the `feet`
 * note in the rig file.
 */
export const DIRE_RUN_CONTACTS: readonly [number, number] = [0.25, 0.75];

/**
 * How far the right leg of each pair lands after the left, in radians of the
 * cycle. A gallop's pairs land one paw and then the other, not both at once.
 */
const PAIR_LAG = 0.4;

/* -------------------------------------------------------------------- run -- */

/*
 * The rest offsets of the chain the gallop is solved on, in the y-z plane —
 * copied from `direhound.rig.yaml` and pinned to it by `test/assets.test.ts`,
 * for the same reason the stride carries its own leg length: a planted paw is
 * a statement about a particular skeleton, and fetching one would make this
 * something other than a function of an angle.
 *
 * Each entry is [y, z] of a bone's offset from its parent; x plays no part,
 * because every rotation in the gait is about x and the legs move in the
 * plane of the body — see planar.ts, which solves them.
 */
export const DIRE_CHAIN = {
	hipHeight: 0.8,
	spineMid: [0.03, 0.32],
	chest: [0.07, 0.34],
	shoulder: [0.05, 0.04],
	frontLeg: [-0.15, 0.03],
	humerus: [-0.28, -0.07],
	forearm: [-0.3, 0],
	pastern: [-0.15, 0.03],
	backLeg: [-0.02, -0.03],
	femur: [-0.26, 0.17],
	tibia: [-0.24, -0.19],
	metatarsus: [-0.21, 0.04],
	/** Where a paw bone sits with the paw on the ground: the paw's own depth. */
	pawHeight: 0.07,
} as const;

/** The rotations of the spine, and where they put the two leg roots. */
interface Trunk {
	readonly root: Planar;
	readonly rootRot: number;
	readonly spineRot: number;
	readonly chestRot: number;
}

/**
 * One front leg, scapula to paw, with the paw put where `groundPath` says.
 *
 * The scapula rocks with the phase, a third of the humerus's swing, so the
 * reach comes from the withers rather than from a pivot on the ribs; the
 * wrist folds the paw back through the swing; and the humerus and elbow are
 * solved for whatever those leave, so the paw lands where it is meant to
 * whatever the spine above is doing.
 */
function frontLeg(
	out: SparsePose,
	bones: readonly string[],
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
): void {
	const air = Math.max(0, Math.cos(phase));
	const fold = Math.pow(air, 0.8);
	const scapula = -0.2 * amp * Math.sin(phase);
	const wrist = 0.5 * amp * fold;

	// Forward kinematics down to the shoulder joint.
	let frame = trunk.rootRot;
	let at = plus(trunk.root, turn(DIRE_CHAIN.spineMid, frame));
	frame += trunk.spineRot;
	at = plus(at, turn(DIRE_CHAIN.chest, frame));
	frame += trunk.chestRot;
	at = plus(at, turn(DIRE_CHAIN.shoulder, frame));
	frame += scapula;
	at = plus(at, turn(DIRE_CHAIN.frontLeg, frame));

	const lower = plus(DIRE_CHAIN.forearm, turn(DIRE_CHAIN.pastern, wrist));
	const target = groundPath(phase, FRONT_PAW_Z, HALF_STRIDE, FRONT_LIFT, DIRE_CHAIN.pawHeight, amp);
	const [humerus, elbow] = twoLink(frame, at, DIRE_CHAIN.humerus, lower, target, 1);

	// Flat on the ground while planted; in the air it hangs from the wrist,
	// toes down.
	const level = -(frame + humerus + elbow + wrist);
	const paw = level * (1 - 0.6 * fold) + 0.35 * amp * fold;

	setSparse(out, bones[0]!, [scapula, 0, 0]);
	setSparse(out, bones[1]!, [humerus, 0, 0.04 * side]);
	setSparse(out, bones[2]!, [elbow, 0, 0]);
	setSparse(out, bones[3]!, [wrist, 0, 0]);
	setSparse(out, bones[4]!, [paw, 0, 0]);
}

/**
 * One hind leg, hip to paw, the same way. The hock folds through the swing
 * and straightens as the leg drives back off the ground, which is where a
 * gallop's push comes from; the femur and stifle are solved for the rest.
 */
function hindLeg(
	out: SparsePose,
	bones: readonly string[],
	phase: number,
	amp: number,
	side: number,
	trunk: Trunk,
): void {
	const swing = Math.sin(phase);
	const air = Math.max(0, Math.cos(phase));
	const fold = Math.pow(air, 0.8);
	const push = Math.pow(Math.max(0, -swing), 1.5) * (1 - air);
	const hock = -0.6 * amp * fold + 0.3 * amp * push;

	const frame = trunk.rootRot;
	const at = plus(trunk.root, turn(DIRE_CHAIN.backLeg, frame));

	const lower = plus(DIRE_CHAIN.tibia, turn(DIRE_CHAIN.metatarsus, hock));
	const target = groundPath(phase, BACK_PAW_Z, HALF_STRIDE, BACK_LIFT, DIRE_CHAIN.pawHeight, amp);
	const [femur, stifle] = twoLink(frame, at, DIRE_CHAIN.femur, lower, target, -1);

	const level = -(frame + femur + stifle + hock);
	const paw = level * (1 - 0.6 * fold) + 0.3 * amp * fold + 0.25 * amp * push;

	setSparse(out, bones[0]!, [femur, 0, 0.04 * side]);
	setSparse(out, bones[1]!, [stifle, 0, 0]);
	setSparse(out, bones[2]!, [hock, 0, 0]);
	setSparse(out, bones[3]!, [paw, 0, 0]);
}

/** Where the paws stand at rest along the body, from the rig's offsets. */
const FRONT_PAW_Z =
	DIRE_CHAIN.chest[1] +
	DIRE_CHAIN.shoulder[1] +
	DIRE_CHAIN.frontLeg[1] +
	DIRE_CHAIN.humerus[1] +
	DIRE_CHAIN.forearm[1] +
	DIRE_CHAIN.pastern[1] +
	DIRE_CHAIN.spineMid[1];
const BACK_PAW_Z =
	DIRE_CHAIN.backLeg[1] + DIRE_CHAIN.femur[1] + DIRE_CHAIN.tibia[1] + DIRE_CHAIN.metatarsus[1];

/** Half of how far a paw travels along the ground in one stance, at amp 1. */
const HALF_STRIDE = 0.34;
/** How high a paw is carried at mid-swing. */
const FRONT_LIFT = 0.3;
const BACK_LIFT = 0.26;

/**
 * The gallop, and the stare it starts from.
 *
 * Hind pair at `theta`, front pair half a cycle behind it, the right leg of
 * each pair a little behind the left: left hind, right hind, left front,
 * right front. The spine flexes once a cycle with the hind pair — arched as
 * they gather under the body, hollow as they drive — and the body drops
 * twice a cycle, as each pair reaches to the ends of its arc, and rises with
 * a pair straight beneath it.
 *
 * @param theta cycle phase in radians (2 pi = one full stride)
 * @param amp   0 = standing, 1 = a full gallop
 * @param time  seconds, driving the breathing and the slow weave of the stare
 */
export function runPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const still = 1 - clamp01(amp);

	/*
	 * The spine. `flex` is +1 with the hind legs gathered under the body and
	 * -1 with them stretched out behind; the pelvis tucks and the mid-back
	 * humps on the gather, and the whole line hollows on the drive. The
	 * pitch is the body's own: nose down as the front pair takes the weight,
	 * nose up as the hind pair throws it.
	 */
	const flex = Math.sin(theta);
	const pitch = Math.sin(theta - PI);
	const bob = -0.04 * amp * (1 - Math.cos(2 * theta));
	const breath = Math.sin(time * 1.6);

	const trunk: Trunk = {
		root: [DIRE_CHAIN.hipHeight + bob + 0.004 * still * breath, 0],
		rootRot: -0.1 * amp * flex + 0.06 * amp * pitch,
		spineRot: 0.2 * amp * flex,
		chestRot: 0.08 * amp * flex + 0.015 * still * breath,
	};
	setSparse(
		out,
		'root',
		[trunk.rootRot, 0, 0],
		[0.012 * still * Math.sin(time * 0.4), trunk.root[0] - DIRE_CHAIN.hipHeight, 0],
	);
	setSparse(out, 'spineMid', [trunk.spineRot, 0, 0]);
	setSparse(out, 'chest', [trunk.chestRot, 0, 0]);

	hindLeg(out, LEGS.backL, theta, amp, 1, trunk);
	hindLeg(out, LEGS.backR, theta - PAIR_LAG, amp, -1, trunk);
	frontLeg(out, LEGS.frontL, theta + PI, amp, 1, trunk);
	frontLeg(out, LEGS.frontR, theta + PI - PAIR_LAG, amp, -1, trunk);

	/*
	 * Neck and head. At a gallop the neck stretches out low and level and the
	 * head is carried on it, countering the spine so the eyes stay on what it
	 * is running at. Standing, the head is carried lower still — below the
	 * withers, nose level, staring — and weaves slowly from side to side.
	 */
	const weave = Math.sin(time * 0.7);
	setSparse(out, 'neckA', [0.3 * amp - 0.12 * amp * flex + 0.38 * still, 0, 0]);
	setSparse(out, 'neckB', [0.1 * amp - 0.05 * amp * flex + 0.16 * still, 0.08 * still * weave, 0]);
	setSparse(out, 'head', [
		-0.28 * amp + 0.06 * amp * flex - 0.5 * still,
		-0.04 * still * weave,
		0.03 * still * Math.sin(time * 0.45),
	]);
	setSparse(out, 'jaw', [0.05 * amp + still * (0.1 + 0.05 * Math.sin(time * 0.9)), 0, 0]);

	// Ears pinned flat at speed, half back and twitching at the stand.
	setSparse(out, 'earL', [
		0.55 * amp + 0.15 * still,
		0,
		0.1 + 0.05 * amp * Math.sin(2 * theta) + 0.04 * still * Math.sin(time * 2.3),
	]);
	setSparse(out, 'earR', [
		0.55 * amp + 0.15 * still,
		0,
		-0.1 - 0.05 * amp * Math.sin(2 * theta + 0.7) - 0.04 * still * Math.sin(time * 2.1 + 1),
	]);

	// The tail streams out behind at speed, each segment lagging the one
	// before it, and hangs low and lashes slowly at the stand.
	const lash = Math.sin(time * 0.6);
	setSparse(out, 'tailA', [
		0.35 * amp + 0.1 * amp * Math.sin(theta - 0.5) - 0.3 * still,
		0.05 * still * lash,
		0,
	]);
	setSparse(out, 'tailB', [
		0.12 * amp * Math.sin(theta - 1.2) - 0.15 * still,
		0.1 * still * Math.sin(time * 0.6 - 0.7),
		0,
	]);
	setSparse(out, 'tailC', [
		0.14 * amp * Math.sin(theta - 1.9) - 0.05 * still,
		0.14 * still * Math.sin(time * 0.6 - 1.4),
		0,
	]);

	return out;
}

/* ------------------------------------------------------------------- bite -- */

/*
 * The strike, as five keys: gather, throw, contact, wrench, recover.
 *
 * The first three are the bat's lunge and the hellhound's bite — a spring
 * wound, a spring released, and a stop that sells the hit. The fourth is the
 * dire hound's own: a jaw this size does not tap what it bites, it closes and
 * wrenches, so the head whips to one side with the teeth shut before the
 * animal backs off.
 *
 * `rootPos` carries the body forward inside the pose, as it does for the bat:
 * a hexagon's neighbours are 1.73 m apart, so a strike that only leaned would
 * close on nothing. The travel is a leap and a recovery inside the pose, not
 * the creature being moved — it lunges and is still exactly where the grid
 * says it is.
 */

interface BiteKeySpec {
	/** Scapula, humerus, elbow, wrist, paw: rot.x for each front leg bone. */
	front: [number, number, number, number, number];
	/** Femur, stifle, hock, paw: rot.x for each hind leg bone. */
	back: [number, number, number, number];
	root?: [number, number, number];
	rootPos?: [number, number, number];
	spine?: [number, number, number];
	chest?: [number, number, number];
	neckA?: [number, number, number];
	neckB?: [number, number, number];
	head?: [number, number, number];
	jaw?: number;
	ear?: number;
	tail?: [number, number, number];
}

function keyPose(p: BiteKeySpec): SparsePose {
	const out: SparsePose = {};
	for (const [bones, side] of [
		[LEGS.frontL, 1],
		[LEGS.frontR, -1],
	] as const) {
		for (let i = 0; i < 5; i++) setSparse(out, bones[i]!, [p.front[i]!, 0, i === 1 ? 0.04 * side : 0]);
	}
	for (const [bones, side] of [
		[LEGS.backL, 1],
		[LEGS.backR, -1],
	] as const) {
		for (let i = 0; i < 4; i++) setSparse(out, bones[i]!, [p.back[i]!, 0, i === 0 ? 0.04 * side : 0]);
	}
	setSparse(out, 'root', p.root ?? [0, 0, 0], p.rootPos ?? [0, 0, 0]);
	setSparse(out, 'spineMid', p.spine ?? [0, 0, 0]);
	setSparse(out, 'chest', p.chest ?? [0, 0, 0]);
	setSparse(out, 'neckA', p.neckA ?? [0, 0, 0]);
	setSparse(out, 'neckB', p.neckB ?? [0, 0, 0]);
	setSparse(out, 'head', p.head ?? [0, 0, 0]);
	setSparse(out, 'jaw', [p.jaw ?? 0, 0, 0]);
	setSparse(out, 'earL', [p.ear ?? 0, 0, 0.1]);
	setSparse(out, 'earR', [p.ear ?? 0, 0, -0.1]);
	const tail = p.tail ?? [0, 0, 0];
	setSparse(out, 'tailA', [tail[0], tail[1], 0]);
	setSparse(out, 'tailB', [tail[0] * 0.5, tail[2], 0]);
	setSparse(out, 'tailC', [tail[0] * 0.3, tail[2] * 0.8, 0]);
	return out;
}

const BITE_KEYS: { t: number; p: SparsePose }[] = [
	// Gather: the haunches fold and the hips drop, the shoulders hunch, the
	// head draws back over them with the lips off the teeth — a spring, wound.
	{
		t: 0,
		p: keyPose({
			front: [-0.2, 0.35, 0.9, 0.15, -0.5],
			back: [-0.35, 0.55, -0.45, 0.15],
			root: [0.06, 0, 0],
			rootPos: [0, -0.14, -0.15],
			spine: [0.08, 0, 0],
			neckA: [-0.2, 0, 0],
			neckB: [-0.1, 0, 0],
			head: [0.3, 0, 0],
			jaw: 0.25,
			ear: 0.65,
			tail: [-0.2, 0, 0],
		}),
	},
	// Throw: the hind legs snap straight and drive the whole animal forward
	// and up, the front pair reach out ahead of it, the neck stretches and
	// the jaws open wide.
	{
		t: 0.3,
		p: keyPose({
			front: [-0.35, -0.95, 0.5, 0.2, -0.2],
			back: [0.5, -0.4, 0.35, 0.3],
			root: [-0.18, 0, 0],
			rootPos: [0, 0.1, 0.5],
			spine: [-0.1, 0, 0],
			chest: [-0.04, 0, 0],
			neckA: [0.1, 0, 0],
			neckB: [0.05, 0, 0],
			head: [-0.05, 0, 0],
			jaw: 0.9,
			ear: 0.3,
			tail: [0.35, 0, 0],
		}),
	},
	// Contact: the jaws snap shut. The body has barely moved on from the
	// throw — the stop is what sells the hit — and the head drives down onto
	// whatever is in front of it.
	{
		t: 0.42,
		p: keyPose({
			front: [-0.25, -0.65, 0.7, 0.3, 0],
			back: [0.55, -0.3, 0.3, 0.2],
			root: [0.04, 0, 0],
			rootPos: [0, 0.02, 0.7],
			spine: [-0.04, 0, 0],
			neckA: [0.35, 0, 0],
			neckB: [0.15, 0, 0],
			head: [0.1, 0, 0],
			jaw: 0.12,
			ear: 0.15,
			tail: [0.2, 0, 0],
		}),
	},
	// Wrench: teeth still shut, the head whips to the left and rolls, the
	// front legs plant, and the hind legs come forward under the body.
	{
		t: 0.56,
		p: keyPose({
			front: [-0.1, -0.35, 0.45, 0.15, -0.1],
			back: [-0.15, 0.45, -0.25, 0.05],
			root: [0.02, 0.05, 0.08],
			rootPos: [0.02, -0.08, 0.64],
			spine: [0, 0.04, 0],
			neckA: [0.4, 0.1, 0],
			neckB: [0.2, 0.2, 0],
			head: [0.05, 0.45, -0.35],
			jaw: 0.08,
			ear: 0.2,
			tail: [0.1, 0.15, 0.1],
		}),
	},
	// Recover: back off the target, weight settling onto all four, the jaw
	// loosening and the head coming back up to the stare.
	{
		t: 1,
		p: keyPose({
			front: [0, 0.05, 0.1, 0.02, -0.1],
			back: [-0.05, 0.15, -0.1, 0.02],
			root: [0.02, 0, 0],
			rootPos: [0, -0.02, -0.03],
			neckA: [0.25, 0, 0],
			neckB: [0.08, 0, 0],
			head: [-0.3, 0, 0],
			jaw: 0.2,
			ear: 0.25,
			tail: [-0.05, 0, 0],
		}),
	},
];

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * The strike.
 * @param u 0 at the gather, 1 back at rest
 */
export function bitePose(u: number, out: SparsePose = {}): SparsePose {
	const t = clamp01(u);
	let i = 0;
	while (i < BITE_KEYS.length - 2 && t > BITE_KEYS[i + 1]!.t) i++;
	const a = BITE_KEYS[i]!;
	const b = BITE_KEYS[i + 1]!;
	const span = b.t - a.t;
	return mixSparse(out, a.p, b.p, smooth(span > 1e-6 ? (t - a.t) / span : 0));
}

/**
 * The fraction of the bite at which the jaws close — the moment worth
 * measuring a reach from, the same role `LUNGE_CONTACT` plays for the bat.
 */
export const DIRE_BITE_CONTACT = 0.42;

/* ------------------------------------------------------------------- rest -- */

/**
 * Down on its chest: forelegs stretched out along the ground ahead of it,
 * hind legs folded under the haunches, belly on the earth, head up and
 * turning — the way a big dog lies when it is waiting rather than sleeping.
 *
 * The leg angles are solved against the actual bone chain so that all four
 * paws lie within a centimetre of the ground and the chest rests on it; a paw
 * that is even a little wrong here reads as broken rather than as folded.
 */
export function restPose(time: number, out: SparsePose = {}): SparsePose {
	const breath = Math.sin(time * 1.3);
	const scan = Math.sin(time * 0.35);

	// The body sinks onto the ground: the root drops most of the standing hip
	// height and the spine settles flat along with it.
	setSparse(out, 'root', [0.05, 0, 0], [0, -0.56 - 0.006 * breath, 0]);
	setSparse(out, 'spineMid', [-0.06, 0, 0]);
	setSparse(out, 'chest', [-0.02 + 0.02 * breath, 0, 0]);

	// Head up and looking round, slowly, the ears following it.
	setSparse(out, 'neckA', [-0.25, 0.1 * scan, 0]);
	setSparse(out, 'neckB', [-0.1, 0.2 * scan, 0]);
	setSparse(out, 'head', [0.05, 0.1 * scan, 0]);
	setSparse(out, 'jaw', [0.08 + 0.03 * Math.sin(time * 0.9), 0, 0]);
	setSparse(out, 'earL', [-0.05, 0, 0.12 + 0.05 * Math.sin(time * 1.9)]);
	setSparse(out, 'earR', [-0.05, 0, -0.12 - 0.05 * Math.sin(time * 1.7 + 0.5)]);

	/*
	 * Forelegs out along the ground: the humerus drops to put the elbow down,
	 * the forearm folds forward flat from there, and the paw's own rotation
	 * cancels everything above it, so the paw lies flat with its toes pointing
	 * forward rather than standing on its heel at the end of the leg.
	 */
	const trunkPitch = 0.05 - 0.06 - 0.02;
	const foreleg = [0.15, 0.7, -2.3, 0.05] as const;
	const forePaw = -(trunkPitch + foreleg[0] + foreleg[1] + foreleg[2] + foreleg[3]);
	for (const [bones, side] of [
		[LEGS.frontL, 1],
		[LEGS.frontR, -1],
	] as const) {
		setSparse(out, bones[0]!, [foreleg[0], 0, 0]);
		setSparse(out, bones[1]!, [foreleg[1], 0, 0.1 * side]);
		setSparse(out, bones[2]!, [foreleg[2], 0, 0]);
		setSparse(out, bones[3]!, [foreleg[3], 0, 0]);
		setSparse(out, bones[4]!, [forePaw, 0, 0]);
	}

	// Hind legs folded under: femur forward and out, tibia folded back along
	// it, metatarsus folded forward again, and the paw flat on the ground
	// beside the belly, toes forward, cancelling the fold the same way.
	const hindLeg = [-0.6, 1.3, -2.2] as const;
	const hindPaw = -(0.05 + hindLeg[0] + hindLeg[1] + hindLeg[2]);
	for (const [bones, side] of [
		[LEGS.backL, 1],
		[LEGS.backR, -1],
	] as const) {
		setSparse(out, bones[0]!, [hindLeg[0], 0, 0.35 * side]);
		setSparse(out, bones[1]!, [hindLeg[1], 0, 0]);
		setSparse(out, bones[2]!, [hindLeg[2], 0, 0]);
		setSparse(out, bones[3]!, [hindPaw, 0, 0]);
	}

	// The tail lies on the ground and lifts its tip once in a while.
	const lift = Math.max(0, Math.sin(time * 0.5));
	setSparse(out, 'tailA', [-0.35, 0.08 * Math.sin(time * 0.5), 0]);
	setSparse(out, 'tailB', [-0.05 + 0.1 * lift, 0.1 * Math.sin(time * 0.5 - 0.6), 0]);
	setSparse(out, 'tailC', [0.1 + 0.3 * lift, 0.12 * Math.sin(time * 0.5 - 1.2), 0]);
	return out;
}
