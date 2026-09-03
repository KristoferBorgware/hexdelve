/*
 * What the bench can put on the stand.
 *
 * A rig here is the things that have to agree before a character can be looked
 * at — a skeleton, a body hung on it, and the animations that pose it — and
 * they all come out of `@hexdelve/client`, because that is the package that
 * owns them. The bench builds no character of its own; if the wanderer grows a
 * bone, he grows it in one place and the bench shows it.
 *
 * The animations are three kinds under one interface (see `animation.ts`):
 * keyframed clips, pose functions, and blend trees. The list below deliberately
 * carries all three for each subject, because the point of having the tree next
 * to its own leaves is being able to look at one and then the other.
 */

import type { BoneTip, Model, Skeleton } from '@hexdelve/engine';
import {
	BAT_SKELETON,
	BAT_TIPS,
	buildBat,
	buildWanderer,
	DUCK,
	FLAP_PERIOD,
	flyPose,
	GUARD,
	HIPS_Y,
	HOVER_Y,
	lungePose,
	perchPose,
	RUN_PERIOD,
	SKELETON,
	SLASH,
	stridePose,
	TIPS,
	WALK_PERIOD,
} from '@hexdelve/client';

import { clipAnimation, procedural, type BenchAnimation } from './animation.js';
import { batTree, wandererTree } from './trees.js';

export type { BenchAnimation, BenchParameter, BenchTreeAnimation } from './animation.js';
export { initialParameters, isTree } from './animation.js';

export interface BenchRig {
	readonly id: string;
	readonly label: string;
	readonly skeleton: Skeleton;
	readonly tips: readonly BoneTip[];
	readonly animations: readonly BenchAnimation[];
	/** The body. Built once, on first use — the prisms never change. */
	model(): Model;
	/** Roughly where the middle of the creature is, for the camera to look at. */
	readonly focusY: number;
	/** And how far out to stand to see all of it. */
	readonly frameDistance: number;
}

const TAU = Math.PI * 2;
const FORWARD = { x: 0, z: 1 };

/*
 * Durations, for the pose functions that have no clip to read one off.
 *
 * Each is the period of the cycle the function is actually driven by — the
 * stride pair, the wing beat, the breath. Several of these functions also lay
 * a much slower drift on top ("never perfectly still"), which by definition
 * does not close inside one cycle; the loop is therefore seamless in the thing
 * being previewed and a fraction of a degree out in the wander, which is the
 * right way round for a bench.
 */
const BREATH_PERIOD = TAU / 1.8;
const PERCH_BREATH = TAU / 1.5;

function wandererRig(): BenchRig {
	let built: Model | null = null;

	return {
		id: 'wanderer',
		label: 'Wanderer',
		skeleton: SKELETON,
		tips: TIPS,
		focusY: HIPS_Y,
		frameDistance: 4.2,
		model: () => (built ??= buildWanderer()),
		animations: [
			wandererTree(),
			procedural('idle', 'Idle', BREATH_PERIOD, true, (t, out) =>
				stridePose(0, 0, FORWARD, 0, t, out),
			),
			procedural('walk', 'Walk', WALK_PERIOD, true, (t, out) =>
				stridePose((t / WALK_PERIOD) * TAU, 1, FORWARD, 0, t, out),
			),
			procedural('run', 'Run', RUN_PERIOD, true, (t, out) =>
				stridePose((t / RUN_PERIOD) * TAU, 1, FORWARD, 1, t, out),
			),
			clipAnimation(GUARD, SKELETON, 'Guard'),
			clipAnimation(SLASH, SKELETON, 'Slash'),
			clipAnimation(DUCK, SKELETON, 'Duck'),
		],
	};
}

function batRig(): BenchRig {
	let built: Model | null = null;
	const LUNGE_PERIOD = 0.9;

	return {
		id: 'bat',
		label: 'Bat',
		skeleton: BAT_SKELETON,
		tips: BAT_TIPS,
		focusY: HOVER_Y,
		frameDistance: 5.4,
		model: () => (built ??= buildBat()),
		animations: [
			batTree(),
			procedural('fly', 'Fly', FLAP_PERIOD, true, (t, out) =>
				flyPose((t / FLAP_PERIOD) * TAU, 1, t, out),
			),
			procedural('hover', 'Hover', FLAP_PERIOD, true, (t, out) =>
				flyPose((t / FLAP_PERIOD) * TAU, 0.45, t, out),
			),
			procedural('perch', 'Perch', PERCH_BREATH, true, (t, out) => perchPose(t, out)),
			procedural('lunge', 'Lunge', LUNGE_PERIOD, false, (t, out) =>
				lungePose(t / LUNGE_PERIOD, out),
			),
		],
	};
}

/** Everything the bench knows how to show, in the order the outline lists it. */
export const BENCH_RIGS: readonly BenchRig[] = [wandererRig(), batRig()];

export function findRig(id: string): BenchRig {
	return BENCH_RIGS.find((rig) => rig.id === id) ?? BENCH_RIGS[0]!;
}
