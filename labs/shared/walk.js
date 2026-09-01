/*
 * labs/shared/walk.js — the procedural walk, as a pure function of phase.
 *
 * No renderer types and no state: given a phase angle it returns a pose. That
 * is what makes it both the live animation in lab 02 and the source a clip can
 * be baked from in lab 03.
 *
 * The whole gait is a handful of harmonics of one angle:
 *   1x  legs and arms swing, in antiphase left/right and arm/leg
 *   2x  the hips rise and fall twice per cycle, once per step
 *   gated cos   the knee only bends while the leg is swinging through
 *
 * Sign conventions (character faces +Z, +X is its left):
 *   limb bones hang down -Y, so rot.x < 0 swings a limb FORWARD, > 0 BACK
 *   spine/chest/head point up +Y, so rot.x > 0 tips them FORWARD
 *   feet: rot.x > 0 points the toe DOWN
 *   rot.y > 0 turns towards the character's left
 */

var Hexdelve = Hexdelve || {};

Hexdelve.walk = (function () {
'use strict';

const PI = Math.PI;

function set(out, bone, rot, pos) {
	if (!out[bone]) out[bone] = {};
	const entry = out[bone];
	entry.rot = rot;
	if (pos) entry.pos = pos;
	return entry;
}

/**
 * @param {number} theta  cycle phase in radians (2π = one full stride pair)
 * @param {number} amp    0 = standing, 1 = full stride
 * @param {number} time   seconds, only used for the idle breathing at amp ≈ 0
 */
function walkPose(theta, amp, time = 0, out = {}) {
	const swing = 0.5 * amp;
	const armSwing = 0.38 * amp;
	const sinT = Math.sin(theta);
	const sinO = Math.sin(theta + PI);

	// Legs. Thighs swing in antiphase; the knee bends only on the swing half
	// (max(0, cos) is zero through stance, so the stance leg stays straight);
	// the ankle cancels most of thigh+shin so the foot stays near level, plus a
	// small late flick for toe-off.
	const hipL = -swing * sinT;
	const hipR = -swing * sinO;
	const shinL = amp * 0.85 * Math.max(0, Math.cos(theta)) + 0.06 * amp;
	const shinR = amp * 0.85 * Math.max(0, Math.cos(theta + PI)) + 0.06 * amp;
	set(out, 'hipL', [hipL, 0, 0]);
	set(out, 'hipR', [hipR, 0, 0]);
	set(out, 'shinL', [shinL, 0, 0]);
	set(out, 'shinR', [shinR, 0, 0]);
	set(out, 'footL', [-(hipL + shinL) * 0.65 + 0.12 * amp * Math.sin(theta - 2.2), 0, 0]);
	set(out, 'footR', [-(hipR + shinR) * 0.65 + 0.12 * amp * Math.sin(theta + PI - 2.2), 0, 0]);

	// Pelvis: bob at twice the stride rate, sway and yaw at the stride rate.
	// The yaw is negative so the hip of the leading leg comes forward.
	const rootYaw = -0.07 * amp * sinT;
	set(
		out,
		'root',
		[0, rootYaw, 0.03 * amp * sinT],
		[0.02 * amp * sinT, -0.028 * amp + 0.028 * amp * Math.cos(2 * theta), 0],
	);

	// Torso: a slight forward lean, shoulders counter-rotating the pelvis.
	const chestYaw = 0.14 * amp * sinT;
	set(out, 'spine', [0.05 * amp, 0, 0]);
	set(out, 'chest', [0.03 * amp, chestYaw, 0]);

	// Head: stays level and keeps facing down the path.
	set(out, 'head', [
		-0.04 * amp + 0.03 * amp * Math.sin(2 * theta + 1),
		-0.5 * (rootYaw + chestYaw),
		0,
	]);

	// Arms counter-swing the legs, elbows flexing as the arm comes forward,
	// held a little out from the body to clear the apron.
	set(out, 'armL', [armSwing * sinT, 0, 0.14]);
	set(out, 'armR', [armSwing * sinO, 0, -0.14]);
	set(out, 'forearmL', [-0.28 - 0.3 * amp * Math.max(0, -sinT), 0, 0]);
	set(out, 'forearmR', [-0.28 - 0.3 * amp * Math.max(0, -sinO), 0, 0]);

	// Standing still: breathe, so the rig is never perfectly frozen.
	if (amp < 0.02) {
		set(out, 'chest', [0.02 + 0.012 * Math.sin(time * 1.8), 0, 0]);
		set(out, 'armL', [0.03 * Math.sin(time * 1.8 + 0.4), 0, 0.14]);
		set(out, 'armR', [0.03 * Math.sin(time * 1.8 + 0.7), 0, -0.14]);
	}

	return out;
}

// One stride pair, in seconds, at amp = 1.
const WALK_PERIOD = 0.95;

// Phases at which a foot is furthest forward, i.e. where it lands.
const WALK_CONTACTS = [0.25 * WALK_PERIOD, 0.75 * WALK_PERIOD];

return { walkPose, WALK_PERIOD, WALK_CONTACTS };
})();
