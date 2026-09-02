/*
 * labs/shared/stride.js — the gait, as a function of phase *and direction*.
 *
 * Every character in labs 02–08 walked where it was looking. Facing and travel
 * were the same number, so one forward cycle was the whole of locomotion, and a
 * blend tree over forward clips (blendtree.js) had everything it needed.
 *
 * The moment the two come apart — the mouse owns the facing, the keys own the
 * travel — that stops being true. A man backing away from something he is
 * watching, or side-stepping round it, is not playing a forward walk: the legs
 * swing along a different line from the one his chest is pointing down. There
 * are no clips here for that, and authoring three more (back, left, right) and
 * blending between them is the usual answer.
 *
 * It is not the answer this project needs, because the walk was never a clip in
 * the first place. `walk.js` is a *function* — a handful of harmonics of one
 * phase angle — so the direction of travel can simply be an argument, and the
 * stride turns with it. The step is written as metres of foot travel rather
 * than as joint angles, which is what lets a heading ask for a mixture:
 *
 *   forward   the thigh pitches, which is walk.js unchanged
 *   sideways  it rolls instead, and much less far, because the leg swinging
 *             sideways has the other leg in its way
 *   backward  the same pitch with the sign of the heading, and in shorter
 *             steps — which is the whole of a backward walk. The knee still
 *             bends on the swing half, since `max(0, cos θ)` means "the foot
 *             is travelling the way the body is", and that holds whichever way
 *             the body is going.
 *
 * The result is one cycle that covers the whole circle of directions, with no
 * blending between clips and nothing to keep in step.
 *
 * How fast it carries him is not written down here either — `strideVelocity`
 * at the bottom reads it off the pose. So a side-step travels at whatever a
 * side-step is worth, and changing the numbers below moves the character
 * without anyone editing a speed.
 *
 * Sign conventions are walk.js's (the character faces +Z, +X is its left):
 *   limb bones hang down -Y, so rot.x < 0 swings a limb FORWARD, > 0 BACK
 *   rot.z > 0 swings a limb towards the character's LEFT (+X)
 *   spine/chest/head point up +Y, so rot.x > 0 tips them FORWARD
 *   rot.y > 0 turns towards the character's left
 */

var Hexdelve = Hexdelve || {};

Hexdelve.stride = (function () {
'use strict';

const { solveWorld } = Hexdelve.anim;

const PI = Math.PI;
const TAU = PI * 2;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function set(out, bone, rot, pos) {
	if (!out[bone]) out[bone] = {};
	const entry = out[bone];
	entry.rot = rot;
	if (pos) entry.pos = pos;
	return entry;
}

// One stride pair, in seconds. A run is the same cycle taken faster — the
// period is the only thing outside the pose that `gait` changes.
const WALK_PERIOD = 0.95;
const RUN_PERIOD = 0.66;

// How far the pelvis opens towards the line of travel at a full side-step.
const TWIST = 0.62;

/*
 * The stride, in metres of foot travel rather than in joint angles — because
 * the two axes are not worth the same and a direction has to be able to ask for
 * a mixture of them.
 *
 * Down the line of the body a half-stride is 0.36 m, which is the 0.5 rad of
 * thigh swing walk.js has always used, and backwards it is shorter, as it is in
 * anybody. Across the body there is another leg in the way, and 0.15 m is about
 * as far as one can go before the ankles pass inside a boot's width of each
 * other. So the stride is an ellipse, long one way and narrow the other, and
 * asking it for a bearing gives the radius in that direction — which is why a
 * side-step here comes out at roughly half a walk. That is not a handicap
 * anybody typed in: it is the room the other leg leaves.
 */
const STRIDE_F = 0.36;
const STRIDE_B = 0.26;
const STRIDE_S = 0.15;
const LEG = 0.76; // hip to ankle, from skeleton.js

// How far the stance opens out when he is travelling sideways. Widening the
// base is what anybody does to shuffle, and it is also what buys the ankles
// room to pass each other on the diagonals, where the ellipse is at its
// longest across the body.
const WIDEN = 0.13;

const stridePeriod = (gait) => WALK_PERIOD + (RUN_PERIOD - WALK_PERIOD) * gait;

// Phases at which a foot is furthest along the direction of travel, i.e. where
// it lands. Direction-independent: it is a property of the cycle, not the line.
const STRIDE_CONTACTS = [0.25, 0.75];

/**
 * @param {number} theta  cycle phase in radians (2π = one full stride pair)
 * @param {number} amp    0 = standing, 1 = full stride
 * @param {object} dir    unit direction of travel in the character's own frame:
 *                        { x: +left, z: +forward }
 * @param {number} gait   0 = walk, 1 = run
 * @param {number} time   seconds, only used for the idle breathing at amp ≈ 0
 * @param {object} out    reused pose, to keep this allocation-free per frame
 */
function stridePose(theta, amp, dir, gait = 0, time = 0, out = {}) {
	const side = dir.x;
	const run = gait;

	/*
	 * The hips turn towards where he is going, and the chest turns back.
	 *
	 * Nobody side-steps with their hips square: they open the pelvis towards the
	 * line they are travelling and let the shoulders stay where they were
	 * looking. Which is worth doing here for more than the look of it — a leg
	 * swinging sideways is limited by the other leg (see below), so a pelvis
	 * that has turned 35 degrees converts most of a side-step into the forward
	 * swing that has room to be big, and a strafe stops being a shuffle.
	 *
	 * So the twist goes into the root, the spine and chest take it back out
	 * again, and the head ends up facing exactly where it started: down the line
	 * of the aim. That is lab 08's upper-body mask argued the other way round —
	 * there the arms held a stance while the hips walked; here the hips take a
	 * heading while the chest holds the aim.
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
	 * joint angles. Running lengthens it; `amp` is the throttle between standing
	 * and a full stride, and it is the *angles* it scales, so a half-hearted
	 * step is a small step rather than a slow one.
	 */
	const along = fwd >= 0 ? STRIDE_F : STRIDE_B; // a man backs up in shorter steps
	const scale = 1 / Math.max(1e-6, Math.hypot(fwd / along, across / STRIDE_S));
	const stepZ = scale * fwd * (1 + 0.32 * run);
	const stepX = scale * across * (1 + 0.24 * run);
	const swing = Math.asin(clamp(stepZ / LEG, -0.92, 0.92)) * amp;
	const roll = Math.asin(clamp(stepX / LEG, -0.92, 0.92)) * amp;
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
	 * of the cycle the foot is travelling *with* the body, which is `cos θ > 0`
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
	set(out, 'hipL', [hipLx, 0, hipLz]);
	set(out, 'hipR', [hipRx, 0, hipRz]);
	set(out, 'shinL', [shinL, 0, 0]);
	set(out, 'shinR', [shinR, 0, 0]);
	// Toes turn a little towards where he is going, as they do when you shuffle
	// sideways; the late flick is toe-off, so it goes with the forward part.
	const toeOut = 0.2 * across * amp;
	set(out, 'footL', [
		-(hipLx + shinL) * 0.65 + 0.12 * amp * fwd * Math.sin(theta - 2.2),
		toeOut,
		-hipLz * 0.6,
	]);
	set(out, 'footR', [
		-(hipRx + shinR) * 0.65 + 0.12 * amp * fwd * Math.sin(theta + PI - 2.2),
		toeOut,
		-hipRz * 0.6,
	]);

	// Pelvis: the bob is twice the stride rate whatever the heading, since it is
	// one dip per step. Yaw belongs to the forward part — hips that counter-turn
	// during a side-step read as a limp — and the lean belongs to the sideways
	// part, because leaning is how you get over the foot you are stepping onto.
	const rootYaw = -0.07 * amp * sinT * fwd + twist * amp;
	const rootRoll = 0.03 * amp * sinT * fwd - (0.1 + 0.05 * run) * amp * across;
	set(
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
	// harder at a run. The shoulders counter-rotate the pelvis as they do in the
	// walk — again only for the forward part of the heading.
	const leanF = (0.05 + 0.3 * run) * amp * fwd;
	const leanS = (0.05 + 0.06 * run) * amp * across;
	// The two of them take the pelvis twist back out again — 0.3 and 0.7 of it —
	// so by the chest there is none of it left and his shoulders are square to
	// the aim however his hips are standing.
	const spineYaw = -twist * amp * 0.3;
	const chestYaw = (0.14 + 0.08 * run) * amp * sinT * fwd - twist * amp * 0.7;
	set(out, 'spine', [leanF, spineYaw, -leanS]);
	set(out, 'chest', [0.03 * amp * fwd, chestYaw, -leanS * 0.6]);

	// Head: level, and facing where he faces — which in this lab is where the
	// mouse is, not where his feet are taking him. So it cancels half of whatever
	// yaw the spine has ended up with, as the walk does.
	set(out, 'head', [
		-0.04 * amp * fwd - leanF * 0.6 + 0.03 * amp * Math.sin(2 * theta + 1),
		-0.5 * (rootYaw + spineYaw + chestYaw),
		0,
	]);

	// Arms counter-swing the legs, so they swing with the forward part of the
	// heading; sideways they lift away from the body instead, which is what
	// keeps a side-step from looking like a man sliding on ice.
	const elbow = -0.28 - 0.85 * run;
	const flare = 0.16 * amp * Math.abs(across);
	set(out, 'armL', [armSwing * sinT * fwd, 0, 0.14 + flare]);
	set(out, 'armR', [armSwing * sinO * fwd, 0, -0.14 - flare]);
	set(out, 'forearmL', [elbow - 0.3 * amp * Math.max(0, -sinT * fwd), 0, 0]);
	set(out, 'forearmR', [elbow - 0.3 * amp * Math.max(0, -sinO * fwd), 0, 0]);

	// Standing still: breathe, so the rig is never perfectly frozen.
	if (amp < 0.02) {
		set(out, 'chest', [0.02 + 0.012 * Math.sin(time * 1.8), 0, 0]);
		set(out, 'armL', [0.03 * Math.sin(time * 1.8 + 0.4), 0, 0.14]);
		set(out, 'armR', [0.03 * Math.sin(time * 1.8 + 0.7), 0, -0.14]);
	}

	return out;
}

/*
 * How fast this gait carries him, for a heading and a stride length — measured
 * off the pose, in his own frame, so nothing here is a tuned speed.
 *
 * The other labs ask `measureGroundSpeed`, which watches the feet over a whole
 * cycle and works out for itself which one is planted. That will not do here.
 * Its test is height, and at a bearing where the step is short the pelvis bob
 * is deeper than the foot lift — so it finds "contact" in the middle of a
 * swing, and reports a side-step travelling backwards.
 *
 * There is nothing to detect anyway. The knee gate *is* the contact schedule:
 * the left foot goes down at one contact key and leaves at the other, and in
 * between it is planted, whichever way the body is going. So ask the pose where
 * that foot is at those two keys. Whatever distance it covers through the
 * body's space, the body covers the other way, in half a stride pair.
 */
const contactA = {};
const contactB = {};

function strideVelocity(skeleton, dir, amp = 1, gait = 0) {
	const half = stridePeriod(gait) / 2;
	const a = solveWorld(skeleton, stridePose(STRIDE_CONTACTS[0] * TAU, amp, dir, gait, 0, contactA));
	const b = solveWorld(skeleton, stridePose(STRIDE_CONTACTS[1] * TAU, amp, dir, gait, 0, contactB));
	// Both feet, because they are mirror images half a cycle apart: the left is
	// planted from the first key to the second, the right from the second to the
	// first. Averaging them is symmetry, not smoothing.
	return {
		x: (a.footL.p[0] - b.footL.p[0] + b.footR.p[0] - a.footR.p[0]) / 2 / half,
		z: (a.footL.p[2] - b.footL.p[2] + b.footR.p[2] - a.footR.p[2]) / 2 / half,
	};
}

return { stridePose, stridePeriod, strideVelocity, WALK_PERIOD, RUN_PERIOD, STRIDE_CONTACTS };
})();
