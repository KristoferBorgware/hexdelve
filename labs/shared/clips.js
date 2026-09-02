/*
 * labs/shared/clips.js — hand-authored animation clips, as plain data.
 *
 * No renderer types here either. Each clip is a list of poses at times; the
 * player interpolates between them. A bone omitted from a pose gets no key
 * there and simply interpolates through, which is why these tables only ever
 * mention the bones that are actually doing something.
 *
 * Sign conventions (character faces +Z, +X is its left):
 *   limb bones hang down -Y  →  rot.x < 0 swings FORWARD, rot.x > 0 swings BACK
 *   spine/chest/head point up →  rot.x > 0 tips FORWARD (head looks down)
 *   feet                      →  rot.x > 0 points the toe DOWN
 *   rot.y > 0                 →  turns towards the character's left
 *
 * Two rules keep the poses grounded, and the numbers below follow them:
 *   a foot stays flat when      foot.x ≈ -(hip.x + shin.x)
 *   bending the knees lowers the hips AND pushes them forward, so a crouch
 *   carries a matching negative root pos.y and pos.z.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.clips = (function () {
'use strict';

const { poseClip, mirrorPose } = Hexdelve.anim;

const ELBOW = -0.3; // a relaxed arm still has a little bend in it

/* ------------------------------------------------------------------ idle -- */
// Nothing but breathing and a slow weight shift. Deliberately dull: it is the
// pose everything else fades back to.

const IDLE = poseClip('idle', 4.4, 'loop', [
	{
		t: 0,
		p: {
			root: { rot: [0, 0, 0], pos: [0, 0, 0] },
			spine: [0.03, 0, 0],
			chest: [0.02, 0, 0],
			head: [0, 0.04, 0],
			armL: [0, 0, 0.05],
			armR: [0, 0, -0.05],
			forearmL: [ELBOW, 0, 0],
			forearmR: [ELBOW - 0.04, 0, 0],
			hipL: [-0.04, 0, 0.06],
			hipR: [-0.02, 0, -0.06],
			shinL: [0.07, 0, 0],
			shinR: [0.04, 0, 0],
			footL: [-0.03, 0, 0],
			footR: [-0.02, 0, 0],
		},
	},
	{
		t: 1.1,
		p: {
			root: { rot: [0, 0, -0.015], pos: [0.015, -0.012, 0] },
			chest: [0.05, 0, 0],
			head: [0.02, 0.03, 0],
			armL: [0.03, 0, 0.07],
			armR: [0.02, 0, -0.06],
			forearmL: [ELBOW - 0.03, 0, 0],
			forearmR: [ELBOW - 0.07, 0, 0],
		},
	},
	{
		t: 2.2,
		p: {
			root: { rot: [0, 0, 0], pos: [0.01, -0.004, 0] },
			chest: [0.02, 0, 0],
			head: [0, -0.05, 0],
			armL: [0, 0, 0.05],
			armR: [0, 0, -0.05],
			forearmL: [ELBOW, 0, 0],
			forearmR: [ELBOW - 0.04, 0, 0],
		},
	},
	{
		t: 3.3,
		p: {
			root: { rot: [0, 0, 0.015], pos: [-0.01, -0.012, 0] },
			chest: [0.05, 0, 0],
			head: [0.01, -0.02, 0],
			armL: [0.03, 0, 0.07],
			armR: [0.02, 0, -0.06],
			forearmL: [ELBOW - 0.03, 0, 0],
			forearmR: [ELBOW - 0.07, 0, 0],
		},
	},
]);

/* ---------------------------------------------------------------- hammer -- */
// The clip a sine wave cannot write: an event with a beginning, an impact and
// a settle. Note the timing — a slow raise (0.36s), a hold at the top for
// anticipation, then the whole strike in 0.14s, a 45ms recoil, and a long
// relaxed return. The keys cluster where the motion is fast.

const HAMMER = poseClip(
	'hammer',
	1.3,
	'loop',
	[
		{
			t: 0,
			p: {
				root: { rot: [0, 0, 0], pos: [0, -0.004, -0.01] },
				spine: [0.12, 0, 0],
				chest: [0.1, -0.1, 0],
				head: [0.3, 0.06, 0],
				armR: [-0.5, 0, 0.14],
				forearmR: [-1.25, 0, 0],
				handR: [0, 0, 0],
				armL: [-0.55, 0, 0.28],
				forearmL: [-1.05, 0, 0],
				handL: [0.2, 0, 0],
				hipL: [-0.1, 0, 0.07],
				shinL: [0.18, 0, 0],
				footL: [-0.08, 0, 0],
				hipR: [-0.08, 0, -0.07],
				shinR: [0.15, 0, 0],
				footR: [-0.07, 0, 0],
			},
		},
		{
			t: 0.26,
			p: {
				root: { pos: [0, 0.01, -0.01] },
				spine: [0.04, 0, 0],
				chest: [0.02, -0.16, 0],
				head: [0.24, 0.06, 0],
				armR: [0.75, 0, 0.1],
				forearmR: [-2.1, 0, 0],
				armL: [-0.5, 0, 0.26],
			},
		},
		// Anticipation: a beat of stillness at the top, tangents flattened so
		// it truly holds instead of easing straight through.
		{
			t: 0.36,
			e: 'flat',
			p: {
				chest: [-0.02, -0.18, 0],
				armR: [0.85, 0, 0.09],
				forearmR: [-2.18, 0, 0],
			},
		},
		{
			t: 0.5,
			p: {
				root: { pos: [0, -0.033, -0.05] },
				spine: [0.16, 0, 0],
				chest: [0.22, -0.06, 0],
				head: [0.38, 0.04, 0],
				armR: [-1.16, 0, 0.27],
				forearmR: [-0.15, 0, 0],
				armL: [-0.62, 0, 0.26],
				forearmL: [-1, 0, 0],
				hipL: [-0.34, 0, 0.07],
				shinL: [0.58, 0, 0],
				footL: [-0.24, 0, 0],
				hipR: [-0.3, 0, -0.07],
				shinR: [0.52, 0, 0],
				footR: [-0.22, 0, 0],
			},
		},
		// Impact: linear into a hard stop, then bounce back off the anvil.
		{
			t: 0.545,
			e: 'linear',
			p: {
				root: { pos: [0, -0.02, -0.04] },
				chest: [0.18, -0.06, 0],
				armR: [-1.02, 0, 0.27],
				forearmR: [-0.3, 0, 0],
				armL: [-0.58, 0, 0.26],
			},
		},
		{
			t: 0.7,
			p: {
				root: { pos: [0, -0.012, -0.03] },
				spine: [0.14, 0, 0],
				chest: [0.12, -0.08, 0],
				head: [0.32, 0.06, 0],
				armR: [-0.75, 0, 0.26],
				forearmR: [-0.8, 0, 0],
				hipL: [-0.2, 0, 0.07],
				shinL: [0.34, 0, 0],
				footL: [-0.14, 0, 0],
				hipR: [-0.18, 0, -0.07],
				shinR: [0.3, 0, 0],
				footR: [-0.12, 0, 0],
			},
		},
		{
			t: 1.02,
			p: {
				chest: [0.11, -0.1, 0],
				armR: [-0.52, 0, 0.15],
				forearmR: [-1.2, 0, 0],
				armL: [-0.55, 0, 0.28],
				forearmL: [-1.05, 0, 0],
			},
		},
	],
	[{ t: 0.5, name: 'impact' }],
);

/* ----------------------------------------------------------------- swing -- */
// The sword-swing shape, done with the hammer: the power comes from the spine
// and hips rotating, not the arm. Windup one way, hold, whip the other way,
// overshoot, recover.

const SWING = poseClip(
	'swing',
	1.5,
	'loop',
	[
		{
			t: 0,
			p: {
				root: { rot: [0, -0.06, 0], pos: [0, -0.01, -0.02] },
				spine: [0.06, -0.06, 0],
				chest: [0.06, -0.12, 0],
				head: [0.04, -0.04, 0],
				armR: [-0.25, 0, -0.3],
				forearmR: [-1.2, 0, 0],
				armL: [-0.3, 0, 0.3],
				forearmL: [-1.3, 0, 0],
				hipL: [-0.12, 0.1, 0.08],
				shinL: [0.2, 0, 0],
				footL: [-0.08, 0, 0],
				hipR: [-0.08, 0.1, -0.08],
				shinR: [0.16, 0, 0],
				footR: [-0.08, 0, 0],
			},
		},
		{
			t: 0.34,
			p: {
				root: { rot: [0, -0.28, 0], pos: [-0.03, -0.02, -0.03] },
				spine: [0.02, -0.28, 0],
				chest: [0.02, -0.6, 0],
				head: [0.05, -0.3, 0],
				armR: [0.45, 0.2, -0.55],
				forearmR: [-1.75, 0, 0],
				armL: [-0.1, 0, 0.5],
				forearmL: [-1.6, 0, 0],
				hipL: [-0.16, 0.18, 0.08],
				hipR: [-0.05, 0.18, -0.08],
			},
		},
		{ t: 0.44, e: 'flat', p: { chest: [0.02, -0.66, 0], armR: [0.52, 0.22, -0.58], forearmR: [-1.82, 0, 0] } },
		{
			t: 0.66,
			p: {
				root: { rot: [0, 0.3, 0], pos: [0.03, -0.03, -0.02] },
				spine: [0.08, 0.28, 0],
				chest: [0.1, 0.55, 0],
				head: [0.06, 0.18, 0],
				armR: [-0.95, 0, 0.25],
				forearmR: [-0.2, 0, 0],
				armL: [-0.45, 0, 0.2],
				forearmL: [-1.15, 0, 0],
				hipL: [-0.05, -0.14, 0.08],
				hipR: [-0.16, -0.14, -0.08],
			},
		},
		{
			t: 0.8,
			p: {
				root: { rot: [0, 0.34, 0] },
				chest: [0.14, 0.72, 0],
				armR: [-1.05, 0, 0.5],
				forearmR: [-0.55, 0, 0],
				armL: [-0.5, 0, 0.15],
			},
		},
		{
			t: 1.12,
			p: {
				root: { rot: [0, 0.08, 0], pos: [0, -0.01, -0.02] },
				spine: [0.06, 0.06, 0],
				chest: [0.08, 0.18, 0],
				head: [0.04, 0.04, 0],
				armR: [-0.5, 0, -0.1],
				forearmR: [-1, 0, 0],
				armL: [-0.35, 0, 0.26],
				forearmL: [-1.25, 0, 0],
				hipL: [-0.12, 0, 0.08],
				hipR: [-0.08, 0, -0.08],
			},
		},
	],
	[{ t: 0.66, name: 'whoosh' }],
);

/* ------------------------------------------------------------------ jump -- */
// Anticipate, launch, tuck, reach, absorb, recover. The root's pos.y track is
// the character's actual flight arc — nothing else lifts him off the ground.

const JUMP = poseClip(
	'jump',
	1.45,
	'hold',
	[
		{
			t: 0,
			p: {
				root: { rot: [0, 0, 0], pos: [0, 0, 0] },
				spine: [0.03, 0, 0],
				chest: [0.02, 0, 0],
				head: [0, 0, 0],
				armL: [0, 0, 0.06],
				armR: [0, 0, -0.06],
				forearmL: [ELBOW, 0, 0],
				forearmR: [ELBOW, 0, 0],
				hipL: [-0.04, 0, 0.06],
				hipR: [-0.04, 0, -0.06],
				shinL: [0.07, 0, 0],
				shinR: [0.07, 0, 0],
				footL: [-0.03, 0, 0],
				footR: [-0.03, 0, 0],
			},
		},
		{
			t: 0.28,
			p: {
				root: { pos: [0, -0.17, -0.08] },
				spine: [0.22, 0, 0],
				chest: [0.16, 0, 0],
				head: [0.1, 0, 0],
				armL: [0.55, 0, 0.1],
				armR: [0.55, 0, -0.1],
				forearmL: [-0.35, 0, 0],
				forearmR: [-0.35, 0, 0],
				hipL: [-0.75, 0, 0.06],
				hipR: [-0.75, 0, -0.06],
				shinL: [1.35, 0, 0],
				shinR: [1.35, 0, 0],
				footL: [-0.6, 0, 0],
				footR: [-0.6, 0, 0],
			},
		},
		{
			t: 0.4,
			p: {
				root: { pos: [0, 0.06, -0.01] },
				spine: [0.02, 0, 0],
				chest: [0, 0, 0],
				armL: [-1.1, 0, 0.15],
				armR: [-1.1, 0, -0.15],
				forearmL: [-0.25, 0, 0],
				forearmR: [-0.25, 0, 0],
				hipL: [-0.05, 0, 0.06],
				hipR: [-0.05, 0, -0.06],
				shinL: [0.05, 0, 0],
				shinR: [0.05, 0, 0],
				footL: [0.35, 0, 0],
				footR: [0.35, 0, 0],
			},
		},
		{
			t: 0.58,
			p: {
				root: { pos: [0, 0.66, 0] },
				chest: [0.1, 0, 0],
				head: [0.06, 0, 0],
				armL: [-1.35, 0, 0.25],
				armR: [-1.35, 0, -0.25],
				hipL: [-0.55, 0, 0.06],
				hipR: [-0.55, 0, -0.06],
				shinL: [0.95, 0, 0],
				shinR: [0.95, 0, 0],
				footL: [0.15, 0, 0],
				footR: [0.15, 0, 0],
			},
		},
		{
			t: 0.78,
			p: {
				root: { pos: [0, 0.28, 0] },
				chest: [0.04, 0, 0],
				armL: [-0.55, 0, 0.2],
				armR: [-0.55, 0, -0.2],
				hipL: [-0.25, 0, 0.06],
				hipR: [-0.25, 0, -0.06],
				shinL: [0.3, 0, 0],
				shinR: [0.3, 0, 0],
				footL: [-0.25, 0, 0],
				footR: [-0.25, 0, 0],
			},
		},
		{
			t: 0.9,
			p: {
				root: { pos: [0, -0.25, -0.11] },
				spine: [0.28, 0, 0],
				chest: [0.18, 0, 0],
				head: [0.12, 0, 0],
				armL: [0.35, 0, 0.2],
				armR: [0.35, 0, -0.2],
				forearmL: [-0.5, 0, 0],
				forearmR: [-0.5, 0, 0],
				hipL: [-0.95, 0, 0.06],
				hipR: [-0.95, 0, -0.06],
				shinL: [1.65, 0, 0],
				shinR: [1.65, 0, 0],
				footL: [-0.7, 0, 0],
				footR: [-0.7, 0, 0],
			},
		},
		{
			t: 1.08,
			p: {
				root: { pos: [0, -0.04, -0.03] },
				spine: [0.1, 0, 0],
				chest: [0.06, 0, 0],
				armL: [0.1, 0, 0.1],
				armR: [0.1, 0, -0.1],
				hipL: [-0.35, 0, 0.06],
				hipR: [-0.35, 0, -0.06],
				shinL: [0.62, 0, 0],
				shinR: [0.62, 0, 0],
				footL: [-0.27, 0, 0],
				footR: [-0.27, 0, 0],
			},
		},
		{
			t: 1.45,
			p: {
				root: { pos: [0, 0, 0] },
				spine: [0.03, 0, 0],
				chest: [0.02, 0, 0],
				head: [0, 0, 0],
				armL: [0, 0, 0.06],
				armR: [0, 0, -0.06],
				forearmL: [ELBOW, 0, 0],
				forearmR: [ELBOW, 0, 0],
				hipL: [-0.04, 0, 0.06],
				hipR: [-0.04, 0, -0.06],
				shinL: [0.07, 0, 0],
				shinR: [0.07, 0, 0],
				footL: [-0.03, 0, 0],
				footR: [-0.03, 0, 0],
			},
		},
	],
	[
		{ t: 0.4, name: 'launch' },
		{ t: 0.9, name: 'land' },
	],
);

/* ------------------------------------------------------------------ duck -- */
// Drop and hold. 'hold' clips clamp on their last key, so he stays down until
// something else is played and the crossfade brings him back up.

const DUCK = poseClip('duck', 0.85, 'hold', [
	{
		t: 0,
		p: {
			root: { pos: [0, 0, 0] },
			spine: [0.03, 0, 0],
			chest: [0.02, 0, 0],
			head: [0, 0, 0],
			armL: [0, 0, 0.06],
			armR: [0, 0, -0.06],
			forearmL: [ELBOW, 0, 0],
			forearmR: [ELBOW, 0, 0],
			hipL: [-0.04, 0, 0.06],
			hipR: [-0.04, 0, -0.06],
			shinL: [0.07, 0, 0],
			shinR: [0.07, 0, 0],
			footL: [-0.03, 0, 0],
			footR: [-0.03, 0, 0],
		},
	},
	{
		t: 0.34,
		p: {
			root: { pos: [0, -0.375, -0.15] },
			spine: [0.3, 0, 0],
			chest: [0.18, 0, 0],
			head: [-0.14, 0, 0],
			armL: [-0.9, 0, 0.35],
			armR: [-0.9, 0, -0.35],
			forearmL: [-1.3, 0, 0],
			forearmR: [-1.3, 0, 0],
			hipL: [-1.25, 0, 0.12],
			hipR: [-1.25, 0, -0.12],
			shinL: [2, 0, 0],
			shinR: [2, 0, 0],
			footL: [-0.75, 0, 0],
			footR: [-0.75, 0, 0],
		},
	},
	{
		t: 0.85,
		e: 'flat',
		p: {
			root: { pos: [0, -0.365, -0.15] },
			chest: [0.2, 0, 0],
			head: [-0.12, 0, 0],
		},
	},
]);

/* ----------------------------------------------------------------- guard -- */
// Sword and board at the ready. Bladed stance: the body turns off square so the
// shield side leads and the sword hand is back, cocked, out of the way. Meant to
// be layered over locomotion through the UPPER_BODY mask, so he can walk while
// holding it.

const GUARD = poseClip('guard', 0.1, 'hold', [
	{
		t: 0,
		p: {
			root: { rot: [0, -0.26, 0], pos: [0, -0.015, 0] },
			spine: [0.06, -0.1, 0.03],
			chest: [0.05, -0.2, 0.05],
			neck: [0.02, 0.14, 0],
			head: [0.02, 0.2, 0],
			// Shield arm: elbow down and in, forearm across the chest, rolled so
			// the face of the shield looks where he does.
			armL: [-0.85, -1.0, 0.32],
			forearmL: [-1.45, -0.3, 0],
			handL: [0, 0, 0],
			/*
			 * Sword arm. The blade rides up beside his head, and it gets there
			 * the way an arm does: the shoulder carries the hand up, the elbow
			 * stays at a hundred-odd degrees, and the WRIST sets the angle of the
			 * blade. Folding the elbow to its stop instead — which is what this
			 * pose used to do at 143°, hand touching shoulder — is why nobody
			 * held a sword like it.
			 */
			armR: [0.25, 0, -0.42],
			forearmR: [-2.0, 0, 0],
			handR: [-1.0, -0.35, 0],
			hipL: [-0.05, -0.1, 0.07],
			hipR: [-0.02, -0.1, -0.07],
			shinL: [0.08, 0, 0],
			shinR: [0.05, 0, 0],
			footL: [-0.04, 0.1, 0],
			footR: [-0.02, 0.1, 0],
		},
	},
]);

/* ----------------------------------------------------------------- slash -- */
/*
 * A cut, not a thrust, and an inside-out one.
 *
 * The difference between a cut and a poke is where the blade travels, and that
 * is decided by the shoulder and the roll of the wrist — not by how fast the arm
 * moves. Poking is what happens when the arm extends along the line the blade
 * already points down, so here the arm never extends that way: the sword is
 * drawn across the body first, inside the shield, and the strike sweeps it back
 * out to the right, edge leading, finishing wide. The point is not aimed at
 * anything at any moment.
 *
 * The rest of the body has to come with it or it reads as a man waving:
 *   hips and spine turn first, and the arm is dragged round by them
 *   the shield arm is thrown BACK through the strike — both the counterweight
 *   and the reason the shoulders can come round that fast
 *   the elbow extends through contact, which is what puts the speed at the tip
 *   rather than at the fist
 */

const SLASH = poseClip(
	'slash',
	1.15,
	'hold',
	[
		// Out of guard.
		{
			t: 0,
			p: {
				root: { rot: [0, -0.26, 0], pos: [0, -0.015, 0] },
				spine: [0.06, -0.1, 0.03],
				chest: [0.05, -0.2, 0.05],
				neck: [0.02, 0.14, 0],
				head: [0.02, 0.2, 0],
				armL: [-0.85, -1.0, 0.32],
				forearmL: [-1.45, -0.3, 0],
				armR: [0.25, 0, -0.42],
				forearmR: [-2.0, 0, 0],
				handR: [-1.0, -0.35, 0],
				hipL: [-0.05, -0.1, 0.07],
				hipR: [-0.02, -0.1, -0.07],
				shinL: [0.08, 0, 0],
				shinR: [0.05, 0, 0],
				footL: [-0.04, 0.1, 0],
				footR: [-0.02, 0.1, 0],
			},
		},
		/*
		 * Cocked, and cocked INSIDE: hips and shoulders wind to his left and the
		 * sword comes across the chest behind the shield, elbow folded, edge
		 * already turned outward. Everything after this is that unwinding.
		 */
		{
			t: 0.3,
			e: 'flat',
			p: {
				root: { rot: [0, 0.42, 0], pos: [-0.03, -0.025, -0.04] },
				spine: [0.02, 0.28, -0.08],
				chest: [-0.04, 0.5, -0.12],
				// The head does not wind up with the body; it stays on the target,
				// which is what makes the shoulders read as loaded rather than as
				// the whole man turning round.
				neck: [0.02, -0.24, 0],
				head: [0.02, -0.34, 0],
				armL: [-0.95, -1.0, 0.4],
				forearmL: [-1.5, -0.3, 0],
				armR: [-0.45, 0, 0.95],
				forearmR: [-1.75, 0, 0],
				// Cocked: the wrist is loaded here and unloads through contact,
				// which is where the last of the tip speed comes from.
				handR: [-0.8, 0.7, 0],
				hipL: [0.02, 0.24, 0.07],
				hipR: [-0.1, 0.24, -0.07],
				shinL: [0.06, 0, 0],
				shinR: [0.14, 0, 0],
				footL: [-0.03, -0.2, 0],
				footR: [-0.06, -0.2, 0],
			},
		},
		/*
		 * Contact. Hips, spine and chest have all whipped the other way — near
		 * ninety degrees of shoulder between this and the key before it, which is
		 * where the force comes from — and the sword sweeps out to his right with
		 * the elbow extending through it. This is the frame the lab measures the
		 * reach and the bearing from: the blade is out to the SIDE here, not out
		 * in front, and the hit test asks the pose rather than assuming.
		 */
		{
			t: 0.44,
			p: {
				root: { rot: [0, -0.32, 0], pos: [0.04, -0.05, 0.06] },
				spine: [0.12, -0.3, 0.06],
				chest: [0.14, -0.58, 0.1],
				neck: [0, 0.24, 0],
				// The head stays level and on the target the whole way through.
				head: [0.02, 0.38, 0],
				/*
				 * Thrown back and open: the counterweight, and the only reason the
				 * shoulders can come round this fast. The elbow has to STRAIGHTEN
				 * for that — swinging the upper arm back with the elbow still bent
				 * just folds the shield across his own face.
				 */
				armL: [0.9, -0.5, 0.3],
				forearmL: [-0.15, 0, 0],
				armR: [-0.6, 0, -0.85],
				forearmR: [-0.28, 0, 0],
				handR: [-0.25, 0.2, 0],
				hipL: [-0.14, -0.26, 0.07],
				hipR: [0.05, -0.26, -0.07],
				shinL: [0.14, 0, 0],
				shinR: [0.06, 0, 0],
				footL: [-0.06, 0.2, 0],
				footR: [-0.03, 0.2, 0],
			},
		},
		// Follow-through: wide and low on his right, which is where an inside-out
		// cut ends up if nothing stopped it.
		{
			t: 0.6,
			p: {
				root: { rot: [0, -0.45, 0], pos: [0.03, -0.06, 0.03] },
				spine: [0.16, -0.38, 0.09],
				chest: [0.18, -0.72, 0.14],
				neck: [0, 0.28, 0],
				head: [0.04, 0.42, 0],
				armL: [0.7, -0.55, 0.28],
				forearmL: [-0.35, 0, 0],
				armR: [-0.35, 0, -1.3],
				forearmR: [-0.55, 0, 0],
				handR: [0.1, -0.05, 0],
				hipL: [-0.16, -0.34, 0.07],
				hipR: [0.06, -0.34, -0.07],
			},
		},
		// And back to guard, slower than he struck.
		{
			t: 1.15,
			p: {
				root: { rot: [0, -0.26, 0], pos: [0, -0.015, 0] },
				spine: [0.06, -0.1, 0.03],
				chest: [0.05, -0.2, 0.05],
				neck: [0.02, 0.14, 0],
				head: [0.02, 0.2, 0],
				armL: [-0.85, -1.0, 0.32],
				forearmL: [-1.45, -0.3, 0],
				armR: [0.25, 0, -0.42],
				forearmR: [-2.0, 0, 0],
				handR: [-1.0, -0.35, 0],
				hipL: [-0.05, -0.1, 0.07],
				hipR: [-0.02, -0.1, -0.07],
				shinL: [0.08, 0, 0],
				shinR: [0.05, 0, 0],
				footL: [-0.04, 0.1, 0],
				footR: [-0.02, 0.1, 0],
			},
		},
	],
	[{ t: 0.44, name: 'cut' }],
);

/* ------------------------------------------------------------------- run -- */
// Half the cycle is authored and mirrored onto the other half. A run differs
// from a walk in kind, not degree: there is a flight phase where neither foot
// is down, the arms are locked near 90°, and the torso leans in.

const RUN_PERIOD = 0.62;
const RUN_HALF = RUN_PERIOD / 2;

const RUN_HALF_POSES = [
	// Left foot strikes, right leg is folded up behind.
	{
		t: 0,
		p: {
			root: { rot: [0, -0.12, 0.04], pos: [0, -0.06, -0.05] },
			spine: [0.16, 0, 0],
			chest: [0.1, 0.2, 0],
			head: [-0.06, -0.06, 0],
			armL: [0.62, 0, 0.12],
			forearmL: [-1.5, 0, 0],
			armR: [-0.62, 0, -0.12],
			forearmR: [-1.6, 0, 0],
			hipL: [-0.55, 0, 0.05],
			shinL: [0.4, 0, 0],
			footL: [0.1, 0, 0],
			hipR: [0.5, 0, -0.05],
			shinR: [1.15, 0, 0],
			footR: [-0.2, 0, 0],
		},
	},
	// Deepest compression over the planted left leg.
	{
		t: 0.1,
		p: {
			root: { rot: [0, -0.06, 0.02], pos: [0, -0.11, -0.1] },
			spine: [0.2, 0, 0],
			chest: [0.12, 0.1, 0],
			armL: [0.3, 0, 0.12],
			armR: [-0.35, 0, -0.12],
			hipL: [-0.62, 0, 0.05],
			shinL: [0.98, 0, 0],
			footL: [-0.36, 0, 0],
			hipR: [0.1, 0, -0.05],
			shinR: [1.3, 0, 0],
			footR: [-0.35, 0, 0],
		},
	},
	// Toe-off into flight: both feet clear of the ground.
	{
		t: 0.22,
		p: {
			root: { rot: [0, 0.06, -0.02], pos: [0, 0.09, -0.02] },
			spine: [0.15, 0, 0],
			chest: [0.1, -0.08, 0],
			armL: [-0.15, 0, 0.12],
			forearmL: [-1.7, 0, 0],
			armR: [0.15, 0, -0.12],
			forearmR: [-1.5, 0, 0],
			hipL: [0.45, 0, 0.05],
			shinL: [0.75, 0, 0],
			footL: [0.3, 0, 0],
			hipR: [-0.5, 0, -0.05],
			shinR: [0.85, 0, 0],
			footR: [-0.05, 0, 0],
		},
	},
];

const RUN = poseClip(
	'run',
	RUN_PERIOD,
	'loop',
	[
		...RUN_HALF_POSES,
		...RUN_HALF_POSES.map((pose) => ({ t: pose.t + RUN_HALF, e: pose.e, p: mirrorPose(pose.p) })),
	],
	[
		{ t: 0, name: 'step' },
		{ t: RUN_HALF, name: 'step' },
	],
);

/* ------------------------------------------------------------ additive -- */
// Single-pose clips meant to be ADDED on top of a locomotion pose rather than
// blended against it. Because every pose in this system is already a delta
// from rest, "additive" needs no reference pose to subtract: adding the delta
// is the whole operation.
//
// Banking into a turn. +X is the character's left, and rot.z > 0 tips the body
// towards its right, so leaning left is negative. The head counter-rotates to
// stay closer to level, which is what a real body does.

const LEAN_POSE = {
	root: [0, 0, -0.1],
	spine: [0.01, 0, -0.07],
	chest: [0.01, -0.05, -0.05],
	head: [0, 0.06, 0.09],
	armL: [0, 0, -0.1],
	armR: [0, 0, -0.06],
	hipL: [0, 0, -0.04],
	hipR: [0, 0, -0.04],
};

const LEAN_LEFT = poseClip('leanLeft', 0.1, 'hold', [{ t: 0, p: LEAN_POSE }]);
const LEAN_RIGHT = poseClip('leanRight', 0.1, 'hold', [{ t: 0, p: mirrorPose(LEAN_POSE) }]);
const UPRIGHT = poseClip('upright', 0.1, 'hold', [{ t: 0, p: { root: [0, 0, 0] } }]);

const AUTHORED = [IDLE, HAMMER, SWING, SLASH, GUARD, JUMP, DUCK, RUN, LEAN_LEFT, LEAN_RIGHT, UPRIGHT];

return { IDLE, HAMMER, SWING, SLASH, GUARD, JUMP, DUCK, RUN, LEAN_LEFT, LEAN_RIGHT, UPRIGHT, AUTHORED };
})();
