/*
 * The gait, as a function of phase *and direction*. This is what lab 9 is for.
 *
 * Every character in labs 02-08 walked where it was looking. Facing and travel
 * were the same number, so one forward cycle was the whole of locomotion, and
 * a blend tree over forward clips had everything it needed.
 *
 * The moment the two come apart — the mouse owns the facing, the keys own the
 * travel — that stops being true. A man backing away from something he is
 * watching, or side-stepping round it, is not playing a forward walk: his legs
 * swing along a different line from the one his chest points down. The usual
 * answer is three more clips (back, left, right) and a blend space over them.
 *
 * It is not the answer this project needs, because the walk was never a clip.
 * It is a handful of harmonics of one phase angle, so the direction of travel
 * can simply be another argument and the stride turns with it. The step is
 * written as metres of foot travel rather than as joint angles, which is what
 * lets a heading ask for a mixture:
 *
 *   forward   the thigh pitches, which is the original walk unchanged
 *   sideways  it rolls instead, and much less far, because the leg swinging
 *             sideways has the other leg in its way
 *   backward  the same pitch with the sign of the heading, in shorter steps —
 *             which is the whole of a backward walk. The knee still bends on
 *             the swing half, since max(0, cos t) means "the foot is travelling
 *             the way the body is", and that holds whichever way the body goes.
 *
 * One cycle covers the whole circle of directions, with no blending between
 * clips and nothing to keep in step.
 *
 * Sign conventions (the character faces +Z, +X is its left):
 *   limb bones hang down -Y, so rot.x < 0 swings a limb FORWARD, > 0 BACK
 *   rot.z > 0 swings a limb towards the character's LEFT (+X)
 *   spine/chest/head point up +Y, so rot.x > 0 tips them FORWARD
 *   rot.y > 0 turns towards the character's left
 */

import { measureGroundSpeed, setSparse, type SparsePose } from '@hexdelve/engine';

import { HUMANOID_SKELETON, LEG_LENGTH } from './humanoid.js';

const PI = Math.PI;
const TAU = PI * 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** One stride pair, in seconds. A run is the same cycle taken faster. */
export const WALK_PERIOD = 0.95;
export const RUN_PERIOD = 0.66;

/** How far the pelvis opens towards the line of travel at a full side-step. */
const TWIST = 0.62;

/*
 * The stride, in metres of foot travel rather than in joint angles, because
 * the two axes are not worth the same and a direction has to be able to ask
 * for a mixture of them.
 *
 * Down the line of the body a half-stride is 0.36 m, which is the 0.5 rad of
 * thigh swing the walk has always used; backwards it is shorter, as it is in
 * anybody. Across the body there is another leg in the way, and 0.15 m is
 * about as far as one can go before the ankles pass inside a boot's width of
 * each other. So the stride is an ellipse, long one way and narrow the other,
 * and asking it for a bearing gives the radius in that direction — which is
 * why a side-step comes out at roughly half a walk. That is not a handicap
 * anybody typed in: it is the room the other leg leaves.
 */
const STRIDE_F = 0.36;
const STRIDE_B = 0.26;
const STRIDE_S = 0.15;

/**
 * How far the stance opens out when travelling sideways. Widening the base is
 * what anybody does to shuffle, and it is also what buys the ankles room to
 * pass each other on the diagonals, where the ellipse is longest across the
 * body.
 */
const WIDEN = 0.13;

export const stridePeriod = (gait: number): number =>
	WALK_PERIOD + (RUN_PERIOD - WALK_PERIOD) * gait;

/**
 * Phases at which a foot is furthest along the direction of travel, i.e. where
 * it lands. Direction-independent: a property of the cycle, not of the line.
 */
export const STRIDE_CONTACTS: readonly [number, number] = [0.25, 0.75];

export interface Direction {
	/** +1 is the character's own left. */
	readonly x: number;
	/** +1 is the way the character is facing. */
	readonly z: number;
}

/**
 * @param theta cycle phase in radians (2 pi = one full stride pair)
 * @param amp   0 = standing, 1 = full stride
 * @param dir   unit direction of travel in the character's own frame
 * @param gait  0 = walk, 1 = run
 * @param time  seconds, only used for the idle breathing at amp ~ 0
 * @param out   reused pose, to keep this allocation-free per frame
 */
export function stridePose(
	theta: number,
	amp: number,
	dir: Direction,
	gait = 0,
	time = 0,
	out: SparsePose = {},
): SparsePose {
	const side = dir.x;
	const run = gait;

	/*
	 * The hips turn towards where he is going, and the chest turns back.
	 *
	 * Nobody side-steps with their hips square: they open the pelvis towards
	 * the line they are travelling and let the shoulders stay where they were
	 * looking. Which is worth doing for more than the look of it — a leg
	 * swinging sideways is limited by the other leg, so a pelvis that has
	 * turned 35 degrees converts most of a side-step into the forward swing
	 * that has room to be big, and a strafe stops being a shuffle.
	 *
	 * The twist goes into the root, the spine and chest take it back out, and
	 * the head ends up facing exactly where it started: down the line of the
	 * aim. That is the upper-body mask argued the other way round — there the
	 * arms held a stance while the hips walked; here the hips take a heading
	 * while the chest holds the aim.
	 */
	const twist = TWIST * side;
	const tc = Math.cos(twist);
	const ts = Math.sin(twist);
	// The direction of travel as the *pelvis* sees it, once it has turned.
	const fwd = dir.z * tc + side * ts;
	const across = side * tc - dir.z * ts;

	/*
	 * The stride for this bearing: the ellipse above, asked for its radius in
	 * the direction the legs are actually travelling, then turned back into
	 * joint angles. Running lengthens it; `amp` is the throttle between
	 * standing and a full stride, and it scales the *angles*, so a half-hearted
	 * step is a small step rather than a slow one.
	 */
	const along = fwd >= 0 ? STRIDE_F : STRIDE_B; // a man backs up in shorter steps
	const scale = 1 / Math.max(1e-6, Math.hypot(fwd / along, across / STRIDE_S));
	const stepZ = scale * fwd * (1 + 0.32 * run);
	const stepX = scale * across * (1 + 0.24 * run);
	const swing = Math.asin(clamp(stepZ / LEG_LENGTH, -0.92, 0.92)) * amp;
	const roll = Math.asin(clamp(stepX / LEG_LENGTH, -0.92, 0.92)) * amp;
	// A short step needs less clearance than a long one, but it still needs some.
	const lift = (0.85 + 0.4 * run) * amp * Math.max(0.55, Math.min(1, scale / STRIDE_F));
	const armSwing = (0.38 + 0.3 * run) * amp;

	const sinT = Math.sin(theta);
	const sinO = Math.sin(theta + PI);
	const cosT = Math.cos(theta);
	const cosO = Math.cos(theta + PI);

	/*
	 * Legs. The thigh swings along the direction of travel — pitch for its
	 * forward part, roll for its sideways part — and the knee bends on the half
	 * of the cycle the foot is travelling *with* the body, which is cos t > 0
	 * whichever way that is. The ankle cancels most of thigh + shin so the sole
	 * stays near level, in both axes.
	 */
	const hipLx = -swing * sinT;
	const hipRx = -swing * sinO;
	const widen = WIDEN * Math.abs(across) * amp;
	const hipLz = roll * sinT + widen;
	const hipRz = roll * sinO - widen;
	const shinL = lift * Math.max(0, cosT) + 0.06 * amp;
	const shinR = lift * Math.max(0, cosO) + 0.06 * amp;

	setSparse(out, 'hipL', [hipLx, 0, hipLz]);
	setSparse(out, 'hipR', [hipRx, 0, hipRz]);
	setSparse(out, 'shinL', [shinL, 0, 0]);
	setSparse(out, 'shinR', [shinR, 0, 0]);

	// Toes turn a little towards where he is going, as they do when you shuffle
	// sideways; the late flick is toe-off, so it goes with the forward part.
	const toeOut = 0.2 * across * amp;
	setSparse(out, 'footL', [
		-(hipLx + shinL) * 0.65 + 0.12 * amp * fwd * Math.sin(theta - 2.2),
		toeOut,
		-hipLz * 0.6,
	]);
	setSparse(out, 'footR', [
		-(hipRx + shinR) * 0.65 + 0.12 * amp * fwd * Math.sin(theta + PI - 2.2),
		toeOut,
		-hipRz * 0.6,
	]);

	// Pelvis: the bob is twice the stride rate whatever the heading, since it
	// is one dip per step. Yaw belongs to the forward part — hips that
	// counter-turn during a side-step read as a limp — and the lean belongs to
	// the sideways part, because leaning is how you get over the foot you are
	// stepping onto.
	const rootYaw = -0.07 * amp * sinT * fwd + twist * amp;
	const rootRoll = 0.03 * amp * sinT * fwd - (0.1 + 0.05 * run) * amp * across;
	setSparse(
		out,
		'root',
		[0, rootYaw, rootRoll],
		[
			0.02 * amp * sinT,
			-(0.028 + 0.05 * run) * amp + (0.028 + 0.035 * run) * amp * Math.cos(2 * theta),
			0,
		],
	);

	// Torso: leans into the line of travel, forward or back or sideways, and
	// harder at a run. The shoulders counter-rotate the pelvis as they do in
	// the walk — again only for the forward part of the heading.
	const leanF = (0.05 + 0.3 * run) * amp * fwd;
	const leanS = (0.05 + 0.06 * run) * amp * across;
	// These two take the pelvis twist back out again — 0.3 and 0.7 of it — so
	// by the chest there is none of it left and his shoulders are square to the
	// aim however his hips are standing.
	const spineYaw = -twist * amp * 0.3;
	const chestYaw = (0.14 + 0.08 * run) * amp * sinT * fwd - twist * amp * 0.7;
	setSparse(out, 'spine', [leanF, spineYaw, -leanS]);
	setSparse(out, 'chest', [0.03 * amp * fwd, chestYaw, -leanS * 0.6]);

	// Head: level, and facing where he faces — which in this lab is where the
	// mouse is, not where his feet are taking him. So it cancels half of
	// whatever yaw the spine has ended up with, as the walk does.
	setSparse(out, 'head', [
		-0.04 * amp * fwd - leanF * 0.6 + 0.03 * amp * Math.sin(2 * theta + 1),
		-0.5 * (rootYaw + spineYaw + chestYaw),
		0,
	]);

	// Arms counter-swing the legs, so they swing with the forward part of the
	// heading; sideways they lift away from the body instead, which is what
	// keeps a side-step from looking like a man sliding on ice.
	const elbow = -0.28 - 0.85 * run;
	const flare = 0.16 * amp * Math.abs(across);
	setSparse(out, 'armL', [armSwing * sinT * fwd, 0, 0.14 + flare]);
	setSparse(out, 'armR', [armSwing * sinO * fwd, 0, -0.14 - flare]);
	setSparse(out, 'forearmL', [elbow - 0.3 * amp * Math.max(0, -sinT * fwd), 0, 0]);
	setSparse(out, 'forearmR', [elbow - 0.3 * amp * Math.max(0, -sinO * fwd), 0, 0]);

	// Standing still: breathe, so the rig is never perfectly frozen.
	if (amp < 0.02) {
		setSparse(out, 'chest', [0.02 + 0.012 * Math.sin(time * 1.8), 0, 0]);
		setSparse(out, 'armL', [0.03 * Math.sin(time * 1.8 + 0.4), 0, 0.14]);
		setSparse(out, 'armR', [0.03 * Math.sin(time * 1.8 + 0.7), 0, -0.14]);
	}

	return out;
}

/*
 * How fast this gait carries him, for a heading and a stride length —
 * measured off the pose, in his own frame, so nothing here is a tuned speed.
 *
 * The measurement itself is the engine's, because the argument it rests on is
 * not about the stride: a cycle's contact schedule is known, so ask the pose
 * where the planted foot is at the two contact keys rather than hunting for
 * contact by height. The knee gate IS that schedule here — the left foot goes
 * down at one key and leaves at the other — so all this has to supply is where
 * the first one falls.
 */

export interface StrideVelocity {
	/** Metres per second along the character's own +X (its left). */
	readonly x: number;
	/** Metres per second along the character's own +Z (where it faces). */
	readonly z: number;
}

export function strideVelocity(dir: Direction, amp = 1, gait = 0): StrideVelocity {
	return measureGroundSpeed(
		HUMANOID_SKELETON,
		(phase, out) => stridePose(phase * TAU, amp, dir, gait, 0, out),
		stridePeriod(gait),
		{ contactPhase: STRIDE_CONTACTS[0] },
	);
}

/**
 * The calibration run backwards: the stride that carries him at a given speed.
 *
 * Lab 09 asked the pose how fast a throttle and a gait were worth. A world on
 * a turn clock needs the opposite question, because there the speed is not
 * his to choose — one action moves him one hexagon, and how long that action
 * lasts is fixed by his place in the energy table. So the distance and the
 * time are both given, and what has to be solved for is the walk that covers
 * exactly that ground.
 *
 * One monotone line covers everything the rig can do, from a crawl to a
 * sprint, in two pieces that meet at a full-length walk:
 *
 *   slower than a walk   shorten the stride (`amp`), keeping the walk's rate
 *   faster than a walk   blend towards the run (`gait`), keeping full length
 *
 * Which is what anybody does. You do not walk to the shops in slow motion;
 * you take smaller steps. And the point of solving it rather than tabulating
 * it is that speed is now a game rule with a visible consequence: haste a man
 * by +10 in the energy table and he breaks into a run here, because covering
 * a hexagon in half the time is the only thing that number can mean.
 *
 * Bisection rather than algebra because `strideVelocity` is a measurement of a
 * seventeen-bone solve, not a formula to invert. It is monotone in both
 * parameters, so bisection is exact to as many digits as anyone wants; this is
 * a once-per-actor cost, not a per-frame one.
 */

const FORWARD: Direction = { x: 0, z: 1 };

/** Below this the stride is a shuffle in place, and shortening it further only stalls. */
const MIN_AMP = 0.06;

export interface StrideSetting {
	/** 0 standing, 1 a full-length stride. */
	readonly amp: number;
	/** 0 walking, 1 running. */
	readonly gait: number;
	/** What that setting actually carries him at, in m/s. */
	readonly speed: number;
	/**
	 * What is left over, in m/s: asked-for minus achieved. Zero everywhere the
	 * rig can reach, and positive only past a full run, where the feet have to
	 * slide because there is no more leg.
	 */
	readonly slip: number;
}

/** Forward speed at a full-length walk, in m/s. The clock is set from this. */
export const WALK_SPEED = strideVelocity(FORWARD, 1, 0).z;
/** Forward speed at a full run. Past this the feet slide. */
export const RUN_SPEED = strideVelocity(FORWARD, 1, 1).z;

export function strideFor(target: number): StrideSetting {
	if (target <= 0) return { amp: 0, gait: 0, speed: 0, slip: 0 };

	const settle = (amp: number, gait: number): StrideSetting => {
		const speed = strideVelocity(FORWARD, amp, gait).z;
		return { amp, gait, speed, slip: Math.max(0, target - speed) };
	};

	if (target >= RUN_SPEED) return settle(1, 1);

	let lo: number;
	let hi: number;
	let at: (t: number) => StrideSetting;

	if (target >= WALK_SPEED) {
		// Between a walk and a run: blend the gait.
		lo = 0;
		hi = 1;
		at = (t) => settle(1, t);
	} else {
		// Slower than a walk: shorten the step.
		lo = MIN_AMP;
		hi = 1;
		at = (t) => settle(t, 0);
	}

	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (at(mid).speed < target) lo = mid;
		else hi = mid;
	}
	return at((lo + hi) / 2);
}
