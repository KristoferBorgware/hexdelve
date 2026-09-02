/*
 * Hand-authored clips, as plain data.
 *
 * Each clip is a list of poses at times; the player interpolates between them.
 * A bone omitted from a pose gets no key there and simply interpolates
 * through, which is why these tables only ever mention the bones that are
 * actually doing something.
 *
 * Sign conventions (the character faces +Z, +X is its left):
 *   limb bones hang down -Y  ->  rot.x < 0 swings FORWARD, rot.x > 0 swings BACK
 *   spine/chest/head point up ->  rot.x > 0 tips FORWARD (the head looks down)
 *   feet                      ->  rot.x > 0 points the toe DOWN
 *   rot.y > 0                 ->  turns towards the character's left
 *
 * Two rules keep the poses grounded, and the numbers below follow them:
 *   a foot stays flat when      foot.x ~ -(hip.x + shin.x)
 *   bending the knees lowers the hips AND pushes them forward, so a crouch
 *   carries a matching negative root pos.y and pos.z.
 */

import { poseClip, type Clip } from '@hexdelve/engine';

const ELBOW = -0.3; // a relaxed arm still has a little bend in it

/* ------------------------------------------------------------------- duck -- */
/*
 * The stoop, used here for picking something up off the grass. It holds at the
 * bottom rather than springing back, so he rises by blending out of it into
 * the stride instead of playing it backwards.
 */

export const DUCK: Clip = poseClip('duck', 0.85, 'hold', [
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

/* ------------------------------------------------------------------ guard -- */
/*
 * Sword and board at the ready. A bladed stance: the body turns off square so
 * the shield side leads and the sword hand is back, cocked, out of the way.
 * Meant to be layered over locomotion through a mask, so he can walk while
 * holding it.
 */

export const GUARD: Clip = poseClip('guard', 0.1, 'hold', [
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
			 * stays at a hundred-odd degrees, and the WRIST sets the angle of
			 * the blade. Folding the elbow to its stop instead — hand touching
			 * shoulder — is why nobody holds a sword like it.
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

/* ------------------------------------------------------------------ slash -- */
/*
 * A cut, not a thrust, and an inside-out one.
 *
 * The difference between a cut and a poke is where the blade travels, and that
 * is decided by the shoulder and the roll of the wrist — not by how fast the
 * arm moves. Poking is what happens when the arm extends along the line the
 * blade already points down, so here the arm never extends that way: the sword
 * is drawn across the body first, inside the shield, and the strike sweeps it
 * back out to the right, edge leading, finishing wide. The point is not aimed
 * at anything at any moment.
 *
 * The rest of the body has to come with it or it reads as a man waving:
 *   hips and spine turn first, and the arm is dragged round by them
 *   the shield arm is thrown BACK through the strike — both the counterweight
 *   and the reason the shoulders can come round that fast
 *   the elbow extends through contact, which puts the speed at the tip rather
 *   than at the fist
 */

export const SLASH: Clip = poseClip(
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
		 * Cocked, and cocked INSIDE: hips and shoulders wind to his left and
		 * the sword comes across the chest behind the shield, elbow folded,
		 * edge already turned outward. Everything after this is that unwinding.
		 */
		{
			t: 0.3,
			e: 'flat',
			p: {
				root: { rot: [0, 0.42, 0], pos: [-0.03, -0.025, -0.04] },
				spine: [0.02, 0.28, -0.08],
				chest: [-0.04, 0.5, -0.12],
				// The head does not wind up with the body; it stays on the
				// target, which is what makes the shoulders read as loaded
				// rather than as the whole man turning round.
				neck: [0.02, -0.24, 0],
				head: [0.02, -0.34, 0],
				armL: [-0.95, -1.0, 0.4],
				forearmL: [-1.5, -0.3, 0],
				armR: [-0.45, 0, 0.95],
				forearmR: [-1.75, 0, 0],
				// The wrist is loaded here and unloads through contact, which is
				// where the last of the tip speed comes from.
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
		 * ninety degrees of shoulder between this and the key before it, which
		 * is where the force comes from — and the sword sweeps out to his right
		 * with the elbow extending through it. This is the frame the reach and
		 * the bearing are measured from: the blade is out to the SIDE here, not
		 * out in front, and the hit test asks the pose rather than assuming.
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
				 * Thrown back and open: the counterweight, and the only reason
				 * the shoulders can come round this fast. The elbow has to
				 * STRAIGHTEN for that — swinging the upper arm back with the
				 * elbow still bent just folds the shield across his own face.
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
		// Follow-through: wide and low on his right, which is where an
		// inside-out cut ends up if nothing stopped it.
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

/** The fraction of a second into SLASH at which the blade arrives. */
export const SWING_CONTACT = 0.44;
