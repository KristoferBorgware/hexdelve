/*
 * How the bat holds itself, as pure functions.
 *
 * The same bargain the stride makes for the humanoid: parameters in, a pose
 * out, no state and no renderer types.
 *
 * There are three of them, because the animal has three modes and no more:
 *
 *   perchPose   asleep on the ground, wings wrapped round itself
 *   flyPose     wings working, which is every metre it ever travels
 *   lungePose   the strike, keyed by hand because it has a beginning, a moment
 *               of contact and a recovery — a sine wave cannot do that
 *
 * Everything in between is a mix: waking is perch -> fly, and the strike is
 * laid over the flight it interrupts.
 */

import { mixSparse, setSparse, type SparsePose } from '@hexdelve/engine';

/*
 * The numbers this pose function was written against.
 *
 * A pose function is not rig-agnostic and never pretended to be: the lines
 * below name `armL` and `digitR` outright, because a wing beat is a statement
 * about a particular animal. So the handful of facts about that animal it
 * needs travel with it rather than being fetched — which keeps `flyPose` a
 * pure function of an angle, which is what lets the bat's hunt call it
 * directly and a blend tree treat it as a leaf.
 *
 * They are pinned to `bat.rig.yaml` by `test/assets.test.ts`, so editing the
 * rig and leaving these behind is a failing test rather than a bat whose
 * wings fold through its own body.
 */

/** How high the body rides above the ground when the wings are working. */
const HOVER_Y = 0.72;
/** And where it settles when it comes down on its feet. */
const PERCH_Y = 0.46;

/** The bones of one wing, outboard in order, so the flap can lag each joint. */
const WING: Record<'L' | 'R', readonly string[]> = {
	L: ['armL', 'foreL', 'handL', 'digitL'],
	R: ['armR', 'foreR', 'handR', 'digitR'],
};

/**
 * One full beat, in seconds, at amp = 1. Big animals beat slowly; this is what
 * makes it read as two and a half metres of wing rather than as a moth.
 */
export const FLAP_PERIOD = 0.72;

/** How far the body drops from flying height when it settles on its feet. */
const SETTLE = PERCH_Y - HOVER_Y;

/**
 * Write one wing, and mirror it onto the other.
 *
 * @param lift  rot.z per bone, outboard: up is positive
 * @param sweep rot.y per bone, outboard: back is positive
 * @param twist rot.x per bone, optional
 */
function wing(
	out: SparsePose,
	lift: readonly number[],
	sweep: readonly number[],
	twist?: readonly number[],
): void {
	for (const side of ['L', 'R'] as const) {
		const mirror = side === 'L' ? 1 : -1;
		const bones = WING[side];
		for (let i = 0; i < bones.length; i++) {
			setSparse(out, bones[i]!, [
				twist ? (twist[i] ?? 0) : 0,
				mirror * (sweep[i] ?? 0),
				mirror * (lift[i] ?? 0),
			]);
		}
	}
}

/* ------------------------------------------------------------------ perch -- */

/**
 * Asleep: down on its feet with the wings wrapped round the body, breathing.
 *
 * The wrap is the whole reason the wing has three folds. The humerus drops and
 * comes back, the forearm folds hard against it, the hand folds again and the
 * finger curls — so two and a half metres of wing ends up as a cloak the width
 * of the body, which is what lets the thing sit on a single hexagon.
 */
export function perchPose(time: number, out: SparsePose = {}): SparsePose {
	/*
	 * Two rhythms, the slower one the cycle: a perch is declared at 0.75 and
	 * breathes at twice that, so both come round together and the clip this
	 * bakes to closes on itself rather than jumping once a wrap.
	 */
	const breath = Math.sin(time * 1.5);

	setSparse(out, 'root', [0.2, 0, 0], [0, SETTLE + 0.012 * breath, 0]);
	setSparse(out, 'chest', [0.16 + 0.02 * breath, 0, 0]);
	setSparse(out, 'neck', [0.2, 0, 0]);
	setSparse(out, 'head', [0.28, 0.05 * Math.sin(time * 0.75), 0]);
	setSparse(out, 'jaw', [0.04, 0, 0]);
	setSparse(out, 'earL', [-0.15, 0, 0.1]);
	setSparse(out, 'earR', [-0.15, 0, -0.1]);

	wing(out, [-1.0, -0.15, -0.1, -0.05], [0.55, 2.5, 1.55, 0.95], [0, 0, 0, 0]);

	// Hunched over its feet, knees out, gripping the ground.
	setSparse(out, 'legL', [0.1, 0, 0.25]);
	setSparse(out, 'legR', [0.1, 0, -0.25]);
	setSparse(out, 'footL', [-0.25, 0, 0]);
	setSparse(out, 'footR', [-0.25, 0, 0]);
	setSparse(out, 'tail', [0.5, 0, 0]);
	return out;
}

/* -------------------------------------------------------------------- fly -- */

/**
 * Wings working.
 *
 * Each joint outboard of the shoulder lags the one before it by a fixed slice
 * of the cycle, which is the whole trick: beat four bones in phase and you get
 * an oar, beat them a beat apart and the stroke travels out along the wing as
 * a wave, the way a real one does.
 */
export function flyPose(theta: number, amp: number, _time = 0, out: SparsePose = {}): SparsePose {
	const LAG = 0.5;
	const LIFT = [0.85, 0.5, 0.42, 0.3];

	const lift: number[] = [];
	const sweep: number[] = [];
	const twist: number[] = [];
	for (let i = 0; i < 4; i++) {
		const phase = theta - i * LAG;
		lift.push(0.12 + amp * LIFT[i]! * Math.sin(phase));
		// The wing rows forward as it comes down and back as it goes up, so the
		// stroke has somewhere to push.
		sweep.push(-amp * 0.14 * Math.cos(phase) + (i === 0 ? 0.05 : 0));
		twist.push(i >= 2 ? -amp * 0.25 * Math.cos(phase - 0.6) : 0);
	}
	wing(out, lift, sweep, twist);

	// The body rides the stroke: it is pushed up as the wings come down.
	setSparse(out, 'root', [-0.12 - 0.05 * amp, 0, 0], [0, amp * 0.06 * Math.cos(theta - 0.9), 0]);
	setSparse(out, 'chest', [0.06, 0, 0]);
	setSparse(out, 'neck', [-0.1, 0, 0]);
	setSparse(out, 'head', [0.16 + 0.04 * amp * Math.sin(theta), 0, 0]);
	setSparse(out, 'jaw', [0.06, 0, 0]);
	setSparse(out, 'earL', [-0.28, 0, 0.06]);
	setSparse(out, 'earR', [-0.28, 0, -0.06]);

	// Legs and tail trail behind, and swing a little with the stroke.
	const trail = 0.75 + amp * 0.1 * Math.sin(theta - 1.2);
	setSparse(out, 'legL', [trail, 0, 0.12]);
	setSparse(out, 'legR', [trail, 0, -0.12]);
	setSparse(out, 'footL', [-0.3, 0, 0]);
	setSparse(out, 'footR', [-0.3, 0, 0]);
	setSparse(out, 'tail', [0.35 + 0.08 * amp * Math.sin(theta - 1.5), 0, 0]);
	return out;
}

/* ------------------------------------------------------------------ lunge -- */

/*
 * The strike, as four keys: gather, throw, contact, recover. The timing is the
 * point, so it is spelt out rather than derived. The wings sweep hard back on
 * the throw, because that is what puts the body forward, and the jaws are wide
 * at contact.
 *
 * The forward drive in `rootPos` is what carries the bite across the gap. It
 * matters because the creature attacks from a hexagon and never leaves it:
 * neighbouring centres are 1.73 m apart, so a strike that only leaned would
 * close on nothing. It is a metre of travel inside the pose — a leap and a
 * recovery — rather than the animal being moved, which is why it can lunge and
 * still be exactly where the grid says it is.
 */

interface LungeKeySpec {
	lift: number[];
	sweep: number[];
	twist?: number[];
	root?: [number, number, number];
	rootPos?: [number, number, number];
	chest?: [number, number, number];
	neck?: [number, number, number];
	head?: [number, number, number];
	jaw?: number;
	ear?: number;
	leg?: number;
	foot?: number;
	tail?: number;
}

function keyPose(p: LungeKeySpec): SparsePose {
	const out: SparsePose = {};
	wing(out, p.lift, p.sweep, p.twist);
	setSparse(out, 'root', p.root ?? [0, 0, 0], p.rootPos ?? [0, 0, 0]);
	setSparse(out, 'chest', p.chest ?? [0, 0, 0]);
	setSparse(out, 'neck', p.neck ?? [0, 0, 0]);
	setSparse(out, 'head', p.head ?? [0, 0, 0]);
	setSparse(out, 'jaw', [p.jaw ?? 0, 0, 0]);
	setSparse(out, 'earL', [p.ear ?? 0, 0, 0.06]);
	setSparse(out, 'earR', [p.ear ?? 0, 0, -0.06]);
	setSparse(out, 'legL', [p.leg ?? 0, 0, 0.12]);
	setSparse(out, 'legR', [p.leg ?? 0, 0, -0.12]);
	setSparse(out, 'footL', [p.foot ?? 0, 0, 0]);
	setSparse(out, 'footR', [p.foot ?? 0, 0, 0]);
	setSparse(out, 'tail', [p.tail ?? 0, 0, 0]);
	return out;
}

const LUNGE_KEYS: { t: number; p: SparsePose }[] = [
	// Gather: wings high and forward, head drawn back over the shoulders.
	{
		t: 0,
		p: keyPose({
			lift: [1.0, 0.5, 0.45, 0.3],
			sweep: [-0.3, -0.2, -0.15, -0.1],
			root: [-0.22, 0, 0],
			rootPos: [0, 0.07, -0.18],
			chest: [-0.1, 0, 0],
			neck: [-0.24, 0, 0],
			head: [-0.2, 0, 0],
			jaw: 0.25,
			ear: -0.1,
			leg: 1.0,
			foot: -0.4,
			tail: 0.1,
		}),
	},
	// Throw: everything goes forward at once, wings driving back behind it.
	{
		t: 0.34,
		p: keyPose({
			lift: [-0.35, -0.2, -0.15, -0.1],
			sweep: [0.85, 0.5, 0.35, 0.2],
			root: [0.24, 0, 0],
			rootPos: [0, 0.02, 0.82],
			chest: [0.12, 0, 0],
			neck: [-0.08, 0, 0],
			head: [0.02, 0, 0],
			jaw: 0.85,
			ear: 0.3,
			leg: 0.2,
			foot: 0.5,
			tail: -0.25,
		}),
	},
	// Contact, a beat later and barely moved: the stop is what sells the hit.
	{
		t: 0.46,
		p: keyPose({
			lift: [-0.5, -0.3, -0.2, -0.12],
			sweep: [0.95, 0.55, 0.4, 0.25],
			root: [0.28, 0, 0],
			rootPos: [0, 0.0, 0.98],
			chest: [0.14, 0, 0],
			neck: [-0.06, 0, 0],
			head: [0.06, 0, 0],
			jaw: 0.3,
			ear: 0.35,
			leg: 0.15,
			foot: 0.55,
			tail: -0.3,
		}),
	},
	// Recover: back off, wings catching the air again.
	{
		t: 1,
		p: keyPose({
			lift: [0.55, 0.35, 0.3, 0.2],
			sweep: [-0.1, 0, 0, 0],
			root: [-0.1, 0, 0],
			rootPos: [0, 0.03, -0.05],
			chest: [0.05, 0, 0],
			neck: [-0.05, 0, 0],
			head: [0.12, 0, 0],
			jaw: 0.1,
			ear: -0.2,
			leg: 0.7,
			foot: -0.25,
			tail: 0.3,
		}),
	},
];

const smooth = (u: number): number => u * u * (3 - 2 * u);

/**
 * The strike.
 * @param u 0 at the gather, 1 back at rest
 */
export function lungePose(u: number, out: SparsePose = {}): SparsePose {
	const t = Math.max(0, Math.min(1, u));
	let i = 0;
	while (i < LUNGE_KEYS.length - 2 && t > LUNGE_KEYS[i + 1]!.t) i++;
	const a = LUNGE_KEYS[i]!;
	const b = LUNGE_KEYS[i + 1]!;
	const span = b.t - a.t;
	return mixSparse(out, a.p, b.p, smooth(span > 1e-6 ? (t - a.t) / span : 0));
}

/**
 * The fraction of the lunge at which the jaws arrive — the moment the bat is
 * closest to whatever it is biting, and so the moment worth measuring a reach
 * from and worth spawning anything at.
 */
export const LUNGE_CONTACT = 0.46;
