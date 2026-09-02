/*
 * labs/shared/batrig.js — the bat's skeleton, as plain data.
 *
 * The humanoid rig in ../shared/skeleton.js is a spine with four limbs hanging
 * off it, and every bone in it points down -Y. Nothing about this creature fits
 * that: its arms *are* its wings, they run out along ±X rather than down, and
 * the interesting joints are the three folds along each wing that let a two
 * and a half metre span collapse into something that fits on a hexagon.
 *
 * So it gets its own rig, in the same shape of data — a name, a parent, an
 * offset — because that is all `buildRig` and `buildSkeletonView` in
 * ../shared/rigview.js ever needed. Neither of them knows what a humanoid is,
 * which is the whole point: turn the skeleton on in lab 08 and this one draws
 * itself from the list below, with no new code anywhere.
 *
 * Conventions match the humanoid where they can: the bat faces +Z, +X is its
 * left, +Y is up. Where they cannot, the wing rules are:
 *
 *   the left wing runs out along +X, the right along -X
 *   rot.z  raises the LEFT wing (the right mirrors it, negated)
 *   rot.y  sweeps the left wing BACK (the right mirrors it, negated)
 *
 * which is why ../shared/batpose.js writes one wing and mirrors it.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.batrig = (function () {
'use strict';

// How high the body rides above the ground when the wings are working. Perched,
// it settles to PERCH_Y; ../shared/batpose.js does the settling.
const HOVER_Y = 0.72;
const PERCH_Y = 0.46;

const SKELETON = [
	{ name: 'root', parent: null, offset: [0, HOVER_Y, 0] },
	{ name: 'chest', parent: 'root', offset: [0, 0.05, 0.17] },
	{ name: 'neck', parent: 'chest', offset: [0, 0.05, 0.13] },
	{ name: 'head', parent: 'neck', offset: [0, 0.03, 0.1] },
	{ name: 'jaw', parent: 'head', offset: [0, -0.04, 0.08] },
	{ name: 'earL', parent: 'head', offset: [0.06, 0.1, -0.02] },
	{ name: 'earR', parent: 'head', offset: [-0.06, 0.1, -0.02] },

	// Wings. Four bones a side: humerus, forearm, hand, and the long finger the
	// outer membrane hangs from — the three folds are what let it wrap up.
	{ name: 'armL', parent: 'chest', offset: [0.11, 0.01, -0.03] },
	{ name: 'foreL', parent: 'armL', offset: [0.34, 0, 0] },
	{ name: 'handL', parent: 'foreL', offset: [0.4, 0, 0] },
	{ name: 'digitL', parent: 'handL', offset: [0.26, 0, 0] },
	{ name: 'armR', parent: 'chest', offset: [-0.11, 0.01, -0.03] },
	{ name: 'foreR', parent: 'armR', offset: [-0.34, 0, 0] },
	{ name: 'handR', parent: 'foreR', offset: [-0.4, 0, 0] },
	{ name: 'digitR', parent: 'handR', offset: [-0.26, 0, 0] },

	// Hind legs, which only matter when it lands: perched, they carry it.
	{ name: 'legL', parent: 'root', offset: [0.1, -0.09, -0.09] },
	{ name: 'footL', parent: 'legL', offset: [0, -0.21, 0] },
	{ name: 'legR', parent: 'root', offset: [-0.1, -0.09, -0.09] },
	{ name: 'footR', parent: 'legR', offset: [0, -0.21, 0] },

	{ name: 'tail', parent: 'root', offset: [0, -0.03, -0.2] },
];

const BONES = SKELETON.map(function (b) { return b.name; });

// Where a chain ends and there is no child bone to draw towards.
const TIPS = [
	{ bone: 'jaw', to: [0, -0.01, 0.1] },
	{ bone: 'earL', to: [0.02, 0.16, -0.05] },
	{ bone: 'earR', to: [-0.02, 0.16, -0.05] },
	{ bone: 'digitL', to: [0.24, 0, -0.05] },
	{ bone: 'digitR', to: [-0.24, 0, -0.05] },
	{ bone: 'footL', to: [0, -0.05, 0.06] },
	{ bone: 'footR', to: [0, -0.05, 0.06] },
	{ bone: 'tail', to: [0, -0.03, -0.18] },
];

// The bones of one wing, outboard in order — the pose code walks these so the
// flap can lag each joint behind the one before it.
const WING = {
	L: ['armL', 'foreL', 'handL', 'digitL'],
	R: ['armR', 'foreR', 'handR', 'digitR'],
};

// Tip of the outer finger in rest space, which is what makes the span
// measurable rather than guessed.
const SPAN = 2 * (0.11 + 0.34 + 0.4 + 0.26 + 0.24);

return { HOVER_Y, PERCH_Y, SKELETON, BONES, TIPS, WING, SPAN };
})();
