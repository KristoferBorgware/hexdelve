/*
 * labs/shared/batpose.js — how the bat holds itself, as pure functions.
 *
 * The same bargain ../shared/walk.js makes for the humanoid: no renderer types
 * and no state, just parameters in and a pose out, so the same three functions
 * drive the creature in the lab and would drive a drawing of it on paper.
 *
 * There are three of them, because the animal has three modes and no more:
 *
 *   perchPose   asleep on the ground, wings wrapped round itself
 *   flyPose     wings working, which is every metre it ever travels
 *   lungePose   the strike, keyed by hand because it has a beginning, a
 *               moment of contact and a recovery — a sine wave cannot do that
 *
 * Everything in between is `mixPose`: waking is perch → fly, and the strike is
 * laid over the flight it interrupts.
 *
 * Wing sign conventions come from ../shared/batrig.js: rot.z raises the left
 * wing, rot.y sweeps it back, and the right wing is the same numbers negated.
 * `wing()` below is the only place that knows it.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.batpose = (function () {
'use strict';

const { WING, HOVER_Y, PERCH_Y } = Hexdelve.batrig;

// One full beat, in seconds, at amp = 1. Big animals beat slowly; this is what
// makes it read as two and a half metres of wing rather than a moth.
const FLAP_PERIOD = 0.72;

// How far the body drops from flying height when it settles on its feet.
const SETTLE = PERCH_Y - HOVER_Y;

function set(out, bone, rot, pos) {
	let entry = out[bone];
	if (!entry) entry = out[bone] = { rot: [0, 0, 0], pos: [0, 0, 0] };
	entry.rot[0] = rot[0];
	entry.rot[1] = rot[1];
	entry.rot[2] = rot[2];
	entry.pos[0] = pos ? pos[0] : 0;
	entry.pos[1] = pos ? pos[1] : 0;
	entry.pos[2] = pos ? pos[2] : 0;
	return entry;
}

/**
 * Write one wing, and mirror it onto the other.
 *
 * @param {number[]} lift   rot.z per bone, outboard: up is positive
 * @param {number[]} sweep  rot.y per bone, outboard: back is positive
 * @param {number[]} twist  rot.x per bone, optional
 */
function wing(out, lift, sweep, twist) {
	for (const side of ['L', 'R']) {
		const mirror = side === 'L' ? 1 : -1;
		const bones = WING[side];
		for (let i = 0; i < bones.length; i++) {
			set(out, bones[i], [
				twist ? twist[i] : 0,
				mirror * (sweep[i] || 0),
				mirror * (lift[i] || 0),
			]);
		}
	}
}

/* ----------------------------------------------------------------- perch -- */

/**
 * Asleep: down on its feet with the wings wrapped round the body, breathing.
 *
 * The wrap is the whole reason the wing has three folds. The humerus drops and
 * comes back, the forearm folds hard against it, the hand folds again and the
 * finger curls — so two and a half metres of wing ends up as a cloak the width
 * of the body, which is what lets the thing sit on a single hexagon.
 */
function perchPose(time, out = {}) {
	const breath = Math.sin(time * 1.5);

	set(out, 'root', [0.2, 0, 0], [0, SETTLE + 0.012 * breath, 0]);
	set(out, 'chest', [0.16 + 0.02 * breath, 0, 0]);
	set(out, 'neck', [0.2, 0, 0]);
	set(out, 'head', [0.28, 0.05 * Math.sin(time * 0.6), 0]);
	set(out, 'jaw', [0.04, 0, 0]);
	set(out, 'earL', [-0.15, 0, 0.1]);
	set(out, 'earR', [-0.15, 0, -0.1]);

	wing(out, [-1.0, -0.15, -0.1, -0.05], [0.55, 2.5, 1.55, 0.95], [0, 0, 0, 0]);

	// Hunched over its feet, knees out, gripping the ground.
	set(out, 'legL', [0.1, 0, 0.25]);
	set(out, 'legR', [0.1, 0, -0.25]);
	set(out, 'footL', [-0.25, 0, 0]);
	set(out, 'footR', [-0.25, 0, 0]);
	set(out, 'tail', [0.5, 0, 0]);
	return out;
}

/* ------------------------------------------------------------------- fly -- */

/**
 * Wings working.
 *
 * Each joint outboard of the shoulder lags the one before it by a fixed slice
 * of the cycle, which is the whole trick: beat four bones in phase and you get
 * an oar, beat them a beat apart and the stroke travels out along the wing as a
 * wave, the way a real one does.
 *
 * @param {number} theta  cycle phase in radians (2π = one beat)
 * @param {number} amp    0 = holding a glide, 1 = full beat
 * @param {number} time   seconds, for the idle drift when amp ≈ 0
 */
function flyPose(theta, amp, time = 0, out = {}) {
	const LAG = 0.5;
	const LIFT = [0.85, 0.5, 0.42, 0.3];
	const drift = 0.05 * Math.sin(time * 0.9); // never perfectly still

	const lift = [];
	const sweep = [];
	const twist = [];
	for (let i = 0; i < 4; i++) {
		const phase = theta - i * LAG;
		lift.push(0.12 + amp * LIFT[i] * Math.sin(phase) + (1 - amp) * drift);
		// The wing rows forward as it comes down and back as it goes up, so the
		// stroke has somewhere to push.
		sweep.push(-amp * 0.14 * Math.cos(phase) + (i === 0 ? 0.05 : 0));
		twist.push(i >= 2 ? -amp * 0.25 * Math.cos(phase - 0.6) : 0);
	}
	wing(out, lift, sweep, twist);

	// The body rides the stroke: it is pushed up as the wings come down.
	set(out, 'root', [-0.12 - 0.05 * amp, 0, 0], [0, amp * 0.06 * Math.cos(theta - 0.9), 0]);
	set(out, 'chest', [0.06, 0, 0]);
	set(out, 'neck', [-0.1, 0, 0]);
	set(out, 'head', [0.16 + 0.04 * amp * Math.sin(theta), 0, 0]);
	set(out, 'jaw', [0.06, 0, 0]);
	set(out, 'earL', [-0.28, 0, 0.06]);
	set(out, 'earR', [-0.28, 0, -0.06]);

	// Legs and tail trail behind, and swing a little with the stroke.
	const trail = 0.75 + amp * 0.1 * Math.sin(theta - 1.2);
	set(out, 'legL', [trail, 0, 0.12]);
	set(out, 'legR', [trail, 0, -0.12]);
	set(out, 'footL', [-0.3, 0, 0]);
	set(out, 'footR', [-0.3, 0, 0]);
	set(out, 'tail', [0.35 + 0.08 * amp * Math.sin(theta - 1.5), 0, 0]);
	return out;
}

/* ----------------------------------------------------------------- lunge -- */

/*
 * The strike, as four keys: gather, throw, contact, recover. Same reasoning as
 * the hammer in ../shared/clips.js — the timing is the point, so it is spelt
 * out rather than derived. The wings sweep hard back on the throw, because that
 * is what puts the body forward, and the jaws are wide at contact.
 *
 * The forward drive in `rootPos` is what carries the bite across the gap. It
 * matters because the creature attacks from a hexagon and never leaves it:
 * neighbouring centres are 1.73 m apart, so a strike that only leaned would
 * close on nothing. It is a metre of travel inside the pose — a leap and a
 * recovery — rather than the animal being moved, which is why it can lunge and
 * still be exactly where the grid says it is.
 */
function keyPose(p) {
	const out = {};
	wing(out, p.lift, p.sweep, p.twist);
	set(out, 'root', p.root || [0, 0, 0], p.rootPos || [0, 0, 0]);
	set(out, 'chest', p.chest || [0, 0, 0]);
	set(out, 'neck', p.neck || [0, 0, 0]);
	set(out, 'head', p.head || [0, 0, 0]);
	set(out, 'jaw', [p.jaw || 0, 0, 0]);
	set(out, 'earL', [p.ear || 0, 0, 0.06]);
	set(out, 'earR', [p.ear || 0, 0, -0.06]);
	set(out, 'legL', [p.leg || 0, 0, 0.12]);
	set(out, 'legR', [p.leg || 0, 0, -0.12]);
	set(out, 'footL', [p.foot || 0, 0, 0]);
	set(out, 'footR', [p.foot || 0, 0, 0]);
	set(out, 'tail', [p.tail || 0, 0, 0]);
	return out;
}

const LUNGE_KEYS = [
	// Gather: wings high and forward, head drawn back over the shoulders.
	{
		t: 0,
		p: keyPose({
			lift: [1.0, 0.5, 0.45, 0.3], sweep: [-0.3, -0.2, -0.15, -0.1],
			root: [-0.22, 0, 0], rootPos: [0, 0.07, -0.18],
			chest: [-0.1, 0, 0], neck: [-0.24, 0, 0], head: [-0.2, 0, 0],
			jaw: 0.25, ear: -0.1, leg: 1.0, foot: -0.4, tail: 0.1,
		}),
	},
	// Throw: everything goes forward at once, wings driving back behind it.
	{
		t: 0.34,
		p: keyPose({
			lift: [-0.35, -0.2, -0.15, -0.1], sweep: [0.85, 0.5, 0.35, 0.2],
			root: [0.24, 0, 0], rootPos: [0, 0.02, 0.82],
			chest: [0.12, 0, 0], neck: [-0.08, 0, 0], head: [0.02, 0, 0],
			jaw: 0.85, ear: 0.3, leg: 0.2, foot: 0.5, tail: -0.25,
		}),
	},
	// Contact, a beat later and barely moved: the stop is what sells the hit.
	{
		t: 0.46,
		p: keyPose({
			lift: [-0.5, -0.3, -0.2, -0.12], sweep: [0.95, 0.55, 0.4, 0.25],
			root: [0.28, 0, 0], rootPos: [0, 0.0, 0.98],
			chest: [0.14, 0, 0], neck: [-0.06, 0, 0], head: [0.06, 0, 0],
			jaw: 0.3, ear: 0.35, leg: 0.15, foot: 0.55, tail: -0.3,
		}),
	},
	// Recover: back off, wings catching the air again.
	{
		t: 1,
		p: keyPose({
			lift: [0.55, 0.35, 0.3, 0.2], sweep: [-0.1, 0, 0, 0],
			root: [-0.1, 0, 0], rootPos: [0, 0.03, -0.05],
			chest: [0.05, 0, 0], neck: [-0.05, 0, 0], head: [0.12, 0, 0],
			jaw: 0.1, ear: -0.2, leg: 0.7, foot: -0.25, tail: 0.3,
		}),
	},
];

const smooth = (u) => u * u * (3 - 2 * u);

/**
 * The strike.
 * @param {number} u  0 at the gather, 1 back at rest
 */
function lungePose(u, out = {}) {
	const t = Math.max(0, Math.min(1, u));
	let i = 0;
	while (i < LUNGE_KEYS.length - 2 && t > LUNGE_KEYS[i + 1].t) i++;
	const a = LUNGE_KEYS[i];
	const b = LUNGE_KEYS[i + 1];
	const span = b.t - a.t;
	return mixPose(out, a.p, b.p, smooth(span > 1e-6 ? (t - a.t) / span : 0));
}

// The fraction of the lunge at which the jaws arrive — the moment the bat is
// closest to whatever it is biting, and so the moment worth measuring a stance
// from and worth spawning anything at.
const LUNGE_CONTACT = 0.46;

/* ------------------------------------------------------------------- mix -- */

/**
 * Blend two sparse poses. A bone missing from either side is at rest there, so
 * a pose only has to mention what it actually holds.
 */
function mixPose(out, a, b, t) {
	const u = Math.max(0, Math.min(1, t));
	for (const bone in a) if (!(bone in b)) blend(out, bone, a[bone], null, u);
	for (const bone in b) blend(out, bone, a[bone], b[bone], u);
	return out;
}

const ZERO = { rot: [0, 0, 0], pos: [0, 0, 0] };

function blend(out, bone, a, b, u) {
	const x = a || ZERO;
	const y = b || ZERO;
	set(
		out,
		bone,
		[
			x.rot[0] + (y.rot[0] - x.rot[0]) * u,
			x.rot[1] + (y.rot[1] - x.rot[1]) * u,
			x.rot[2] + (y.rot[2] - x.rot[2]) * u,
		],
		[
			x.pos[0] + (y.pos[0] - x.pos[0]) * u,
			x.pos[1] + (y.pos[1] - x.pos[1]) * u,
			x.pos[2] + (y.pos[2] - x.pos[2]) * u,
		],
	);
}

return { FLAP_PERIOD, LUNGE_CONTACT, perchPose, flyPose, lungePose, mixPose };
})();
