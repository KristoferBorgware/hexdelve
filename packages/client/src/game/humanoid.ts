/*
 * The humanoid rig, as the pose functions in this directory know it.
 *
 * The rig itself is `public/assets/rigs/humanoid.rig.yaml` and everything that
 * draws or poses a body reads it from there. This file is the small residue
 * that cannot: `stridePose` is a function of one phase angle that names
 * `hipL`, `shinR` and `armL` outright, and its arcs were solved against a leg
 * of a particular length. It is not rig-agnostic and never pretended to be —
 * which is exactly what makes it worth having, since a function of a heading
 * covers the whole circle of directions where a blend space over clips covers
 * four of them.
 *
 * Keeping these here rather than fetching them is what keeps `stridePose` a
 * pure function: the turn system solves a stride for a place in the energy
 * table at module load, the player samples it every frame, and neither wants
 * to be handed a rig to do it.
 *
 * The cost of a copy is that it can drift from the file, so it is not left to
 * chance: `test/assets.test.ts` pins every number below against
 * `humanoid.rig.yaml` and fails if the two stop agreeing. A stale leg length
 * would show up as a man whose feet slide, which is precisely the sort of bug
 * that gets blamed on the animation for a week.
 */

import type { Skeleton } from '@hexdelve/engine';

/** Hip to ankle. The stride's arcs are solved against this. */
export const LEG_LENGTH = 0.41 + 0.35;

/**
 * Enough of the rig to measure a ground speed off.
 *
 * `measureGroundSpeed` resolves the pose and reads where the planted foot got
 * to, so it needs the chain from the root down to each foot and nothing else.
 * The arms and the head are left out because no measurement here asks about
 * them — this is the skeleton the stride is measured on, not the skeleton the
 * wanderer is drawn on.
 */
export const HUMANOID_SKELETON: Skeleton = [
	{ name: 'root', parent: null, offset: [0, 0.92, 0] },
	{ name: 'hipL', parent: 'root', offset: [0.16, -0.04, 0] },
	{ name: 'shinL', parent: 'hipL', offset: [0, -0.41, 0] },
	{ name: 'footL', parent: 'shinL', offset: [0, -0.35, 0] },
	{ name: 'hipR', parent: 'root', offset: [-0.16, -0.04, 0] },
	{ name: 'shinR', parent: 'hipR', offset: [0, -0.41, 0] },
	{ name: 'footR', parent: 'shinR', offset: [0, -0.35, 0] },
];
