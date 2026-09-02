/*
 * The humanoid rig, as plain data.
 *
 * A bone is a name, a parent and an offset. Everything else — the wanderer's
 * prisms, the visible skeleton, the clips, the IK — is built from this list,
 * and parents always precede their children so one forward pass resolves it.
 *
 * Low-poly humanoid: no fingers, no toes, no twist bones. Seventeen bones is
 * enough to walk, carry a shield and swing a sword, and every one of them is
 * doing work.
 */

import { boneIndex, boneNames, type BoneTip, type Skeleton } from '@hexdelve/engine';

/** Hip height at rest, which is also where the camera looks when it follows. */
export const HIPS_Y = 0.92;

export const SKELETON: Skeleton = [
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

export const BONES = boneNames(SKELETON);
export const BONE_INDEX = boneIndex(SKELETON);

/** Where a chain ends and there is no child bone to draw towards. */
export const TIPS: readonly BoneTip[] = [
	{ bone: 'head', to: [0, 0.17, 0] },
	{ bone: 'handL', to: [0, -0.11, 0] },
	{ bone: 'handR', to: [0, -0.11, 0] },
	{ bone: 'footL', to: [0, -0.08, 0.15] },
	{ bone: 'footR', to: [0, -0.08, 0.15] },
];

/**
 * Blend mask for playing an upper-body clip over locomotion.
 *
 * The spine is deliberately partial so the two halves meet in the middle
 * instead of hinging at one joint — a man whose chest is doing one thing and
 * whose hips are doing another bends through the spine, not at it.
 */
export const UPPER_BODY: Record<string, number> = {
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

/** Hip to ankle, read off the offsets above rather than typed twice. */
export const LEG_LENGTH = 0.41 + 0.35;
