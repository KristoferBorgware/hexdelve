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
 * and a run are the same trot at two amplitudes here too, exactly as the
 * humanoid's own stride is — `amp` throttles between a standing animal and a
 * full one, and below a hair above zero the legs stop and it just breathes.
 */

import { mixSparse, setSparse, type SparsePose } from '@hexdelve/engine';

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

/** One full stride pair, in seconds, at amp = 1. */
export const HOUND_STRIDE_PERIOD = 0.5;

/* -------------------------------------------------------------------- run -- */

/**
 * One leg, hip to paw, at a given phase of the cycle.
 *
 * The shape is the humanoid's own — the thigh swings along the line of
 * travel and the knee bends on the half of the cycle the paw is travelling
 * *with* the body — carried over unchanged because a leg is a leg whichever
 * end of the animal it hangs from. `stance` is a small constant roll that
 * keeps the paws under the shoulders and hips rather than under the spine.
 */
function leg(
	out: SparsePose,
	bones: readonly string[],
	phase: number,
	amp: number,
	swingAmp: number,
	liftAmp: number,
	stance: number,
): void {
	const swing = swingAmp * amp * Math.sin(phase);
	const bend = liftAmp * amp * Math.max(0, Math.cos(phase)) + 0.07 * amp;
	setSparse(out, bones[0]!, [swing, 0, stance]);
	setSparse(out, bones[1]!, [bend, 0, 0]);
	setSparse(out, bones[2]!, [-(swing + bend) * 0.6, 0, 0]);
}

/**
 * The trot: front left with back right, front right with back left — the two
 * diagonal pairs a real trot alternates, half a cycle apart. Faster than a
 * walk needs to be four legs taking turns one at a time, and reads as a run
 * rather than a totter the moment two feet are always down at once instead of
 * one.
 *
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = a full run
 * @param time  seconds, only used for the idle breathing at amp ~ 0
 */
export function runPose(theta: number, amp: number, time = 0, out: SparsePose = {}): SparsePose {
	const FRONT_SWING = 0.62;
	const FRONT_LIFT = 0.9;
	const BACK_SWING = 0.7;
	const BACK_LIFT = 1.05;

	leg(out, LEGS.frontL, theta, amp, FRONT_SWING, FRONT_LIFT, 0.05);
	leg(out, LEGS.frontR, theta + PI, amp, FRONT_SWING, FRONT_LIFT, -0.05);
	leg(out, LEGS.backL, theta + PI, amp, BACK_SWING, BACK_LIFT, 0.05);
	leg(out, LEGS.backR, theta, amp, BACK_SWING, BACK_LIFT, -0.05);

	// The body bounces twice a cycle, once a diagonal pair each — and the
	// spine flexes with it, the way a running animal's back visibly works
	// where a walking human's barely does.
	const bob = -0.03 * amp + 0.02 * amp * Math.cos(2 * theta);
	setSparse(out, 'root', [0.05 * amp, 0, 0], [0, bob, 0]);
	setSparse(out, 'spineMid', [-0.1 * amp - 0.05 * amp * Math.cos(2 * theta), 0, 0]);
	setSparse(out, 'chest', [-0.06 * amp, 0, 0]);
	setSparse(out, 'neck', [-0.12 * amp, 0, 0]);
	setSparse(out, 'head', [-0.06 * amp + 0.03 * amp * Math.sin(2 * theta), 0, 0]);

	// Ears pin back at speed; the tail trails and whips a little, one segment
	// lagging the other the way the bat's wingtip lags its own wrist.
	setSparse(out, 'earL', [-0.15 * amp, 0, 0.1]);
	setSparse(out, 'earR', [-0.15 * amp, 0, -0.1]);
	setSparse(out, 'tailA', [0.15 + 0.1 * amp, 0.12 * amp * Math.sin(theta - 0.4), 0]);
	setSparse(out, 'tailB', [0.1 + 0.08 * amp, 0.18 * amp * Math.sin(theta - 1.1), 0]);

	// Standing still: breathe, so it is never perfectly frozen between strides.
	if (amp < 0.02) {
		setSparse(out, 'chest', [0.02 * Math.sin(time * 1.7), 0, 0]);
		setSparse(out, 'earL', [0, 0, 0.1 + 0.03 * Math.sin(time * 2.3)]);
		setSparse(out, 'earR', [0, 0, -0.1 - 0.03 * Math.sin(time * 2.1)]);
		setSparse(out, 'tailA', [0.1, 0.06 * Math.sin(time * 0.8), 0]);
		setSparse(out, 'tailB', [0.08, 0.09 * Math.sin(time * 0.8 - 0.6), 0]);
	}

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
	setSparse(out, 'head', [-0.1 + 0.03 * Math.sin(time * 0.5), 0, 0]);
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
	setSparse(out, 'tailA', [0.3, 0.04 * Math.sin(time * 0.5), 0]);
	setSparse(out, 'tailB', [0.25, 0.05 * Math.sin(time * 0.5 - 0.4), 0]);
	return out;
}
