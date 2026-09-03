/*
 * What the bench can put on the stand.
 *
 * A rig here is the three things that have to agree before a character can be
 * looked at — a skeleton, a body hung on it, and something that poses it — and
 * they all come out of `@hexdelve/client`, because that is the package that
 * owns them. The bench builds no character of its own; if the wanderer grows a
 * bone, he grows it in one place and the bench shows it.
 *
 * The one abstraction the bench adds is `BenchAnimation`: a duration and a
 * function from a time to a pose. That is deliberately the smallest thing both
 * kinds of animation in this project can be. A keyframed clip is one, and so is
 * the procedural stride, which is a function of an angle and has no keys at
 * all — and so, later, is a blend tree, which is a function of its parameters.
 * The transport does not need to know which it is driving.
 */

import {
	bindClip,
	boneIndex,
	boneNames,
	createPose,
	denseToSparse,
	sampleBound,
	type BoneTip,
	type Clip,
	type Model,
	type Skeleton,
	type SparsePose,
} from '@hexdelve/engine';
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
	SKELETON,
	SLASH,
	stridePose,
	RUN_PERIOD,
	TIPS,
	WALK_PERIOD,
} from '@hexdelve/client';

export interface BenchAnimation {
	readonly id: string;
	readonly label: string;
	/** One cycle, in seconds. Scrubbing runs 0..duration and no further. */
	readonly duration: number;
	/** Whether the end of that cycle is the start of it again. */
	readonly loop: boolean;
	/** Where it came from, for the readout: keys on disk, or code. */
	readonly kind: 'clip' | 'procedural';
	/** The pose at `t` seconds, written into `out` and returned. */
	sample(t: number, out: SparsePose): SparsePose;
}

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

/**
 * A clip, bound to its skeleton once.
 *
 * Binding resolves the clip's bone names to indices, so sampling a frame is a
 * walk down a short array rather than a string lookup per bone. That matters
 * less on a bench than in the game — but the bench is meant to show what the
 * game will do with a clip, and sampling it through a different path would be
 * a poor way to check one.
 */
function clipAnimation(clip: Clip, skeleton: Skeleton, label: string): BenchAnimation {
	const names = boneNames(skeleton);
	const bound = bindClip(clip, boneIndex(skeleton));
	const dense = createPose(names.length);

	return {
		id: clip.name,
		label,
		duration: clip.duration,
		loop: clip.loop === 'loop',
		kind: 'clip',
		sample(t, out) {
			sampleBound(bound, t, dense);
			return denseToSparse(names, dense, out);
		},
	};
}

/** A pose function, wrapped as an animation over one cycle of it. */
function procedural(
	id: string,
	label: string,
	duration: number,
	loop: boolean,
	sample: (t: number, out: SparsePose) => SparsePose,
): BenchAnimation {
	return { id, label, duration, loop, kind: 'procedural', sample };
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
