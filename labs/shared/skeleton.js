/*
 * labs/shared/skeleton.js — the humanoid rig, as plain data.
 *
 * No renderer types: a bone is a name, a parent and an offset from that
 * parent. Everything else (the visual skeleton, the character, the animation)
 * is built from this list. Parents always precede their children.
 *
 * Low-poly humanoid: no fingers, no toes, no twist bones.
 */

var Hexdelve = Hexdelve || {};

Hexdelve.skeleton = (function () {
'use strict';

const HIPS_Y = 0.92;

const SKELETON = [
	{ name: 'root', parent: null, offset: [0, HIPS_Y, 0] },
	{ name: 'spine', parent: 'root', offset: [0, 0.14, 0] },
	{ name: 'chest', parent: 'spine', offset: [0, 0.22, 0] },
	{ name: 'neck', parent: 'chest', offset: [0, 0.18, 0] },
	{ name: 'head', parent: 'neck', offset: [0, 0.14, 0] },
	{ name: 'armL', parent: 'chest', offset: [0.28, 0.12, 0] },
	{ name: 'forearmL', parent: 'armL', offset: [0, -0.34, 0] },
	{ name: 'handL', parent: 'forearmL', offset: [0, -0.3, 0] },
	{ name: 'armR', parent: 'chest', offset: [-0.28, 0.12, 0] },
	{ name: 'forearmR', parent: 'armR', offset: [0, -0.34, 0] },
	{ name: 'handR', parent: 'forearmR', offset: [0, -0.3, 0] },
	{ name: 'hipL', parent: 'root', offset: [0.16, -0.04, 0] },
	{ name: 'shinL', parent: 'hipL', offset: [0, -0.41, 0] },
	{ name: 'footL', parent: 'shinL', offset: [0, -0.35, 0] },
	{ name: 'hipR', parent: 'root', offset: [-0.16, -0.04, 0] },
	{ name: 'shinR', parent: 'hipR', offset: [0, -0.41, 0] },
	{ name: 'footR', parent: 'shinR', offset: [0, -0.35, 0] },
];

const BONES = SKELETON.map((b) => b.name);

// Where the chain ends and there is no child bone to draw towards.
const TIPS = [
	{ bone: 'head', to: [0, 0.17, 0] },
	{ bone: 'handL', to: [0, -0.11, 0] },
	{ bone: 'handR', to: [0, -0.11, 0] },
	{ bone: 'footL', to: [0, -0.08, 0.15] },
	{ bone: 'footR', to: [0, -0.08, 0.15] },
];

// Blend mask for playing an upper-body clip over a locomotion clip. The spine
// is deliberately partial so the two halves meet in the middle instead of
// hinging at one joint.
const UPPER_BODY = {
	spine: 0.45,
	chest: 1,
	neck: 1,
	head: 1,
	armL: 1,
	forearmL: 1,
	handL: 1,
	armR: 1,
	forearmR: 1,
	handR: 1,
};

return { HIPS_Y, SKELETON, BONES, TIPS, UPPER_BODY };
})();
