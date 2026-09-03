/*
 * The trees the bench can put on the stand.
 *
 * Both are built out of the client's own rigs, clips and pose functions — the
 * bench authors no animation, same as it models no character. What it adds is
 * the arrangement, and the arrangement is the thing worth looking at.
 *
 * The wanderer's tree uses all three operations at once, because all three are
 * things this game actually does:
 *
 *   layer  "guard"          the shield arm holds a stance through the upper-body
 *   └ additive "lean"       mask while the hips go on with the stride — which is
 *     ├ blend1d "speed"     exactly what the game's own blend mask does
 *     └ blend1d "turn"
 *
 * The bank goes on ADDITIVELY rather than being blended in, so the same lean
 * composes with every speed instead of being authored once per gait; the guard
 * goes on through a MASK, because a man carrying a shield is still walking with
 * his legs and a scalar blend would have to take the walk away to make room.
 *
 * Thresholds on the speed axis are metres per second, and they are measured off
 * the poses rather than typed: `strideVelocity` asks the stride where its
 * planted foot is at the two contact keys. So idle, walk and run sit at their
 * own true speeds.
 *
 * Between them they did not, until the axis was calibrated. A blend halfway
 * between a walk and a run blends the stride and the cadence separately, and
 * speed is one divided by the other — so the tree delivered about five per cent
 * less than the slider claimed, and the feet made up the difference by sliding.
 * `calibrateSpeed` sweeps the axis once at startup, measures what each value
 * really produces, and hands back the inverse; the slider is then in true
 * metres per second all the way across, and the bench's "asks / carries"
 * readout is the proof rather than the confession.
 */

import {
	additive,
	blend1d,
	BlendTree,
	boneIndex,
	calibrateSpeed,
	clipSource,
	layer,
	leaf,
	poseSource,
} from '@hexdelve/engine';
import {
	BAT_BONES,
	BONES,
	FLAP_PERIOD,
	flyPose,
	GUARD,
	LEAN_LEFT,
	LEAN_RIGHT,
	perchPose,
	RUN_PERIOD,
	SKELETON,
	STRIDE_CONTACTS,
	stridePose,
	strideVelocity,
	UPPER_BODY,
	UPRIGHT,
	WALK_PERIOD,
} from '@hexdelve/client';

import { treeAnimation, type BenchTreeAnimation } from './animation.js';

const TAU = Math.PI * 2;
const FORWARD = { x: 0, z: 1 };

/** The idle breathes at 1.8 rad/s, so this is exactly one breath. */
const BREATH_PERIOD = TAU / 1.8;
const PERCH_BREATH = TAU / 1.5;

/** Each gait's own speed, read off its feet. These become the thresholds. */
export const WALK_SPEED = strideVelocity(FORWARD, 1, 0).z;
export const RUN_SPEED = strideVelocity(FORWARD, 1, 1).z;

export function wandererTree(): BenchTreeAnimation {
	const index = boneIndex(SKELETON);

	/*
	 * The gait leaves. Walk and run are the same function at two settings, so
	 * their contact schedules are identical — but their cycles are not (0.95s
	 * against 0.66s), which is the whole reason the sync has work to do.
	 */
	const idle = leaf(
		poseSource('idle', BREATH_PERIOD, BONES, (t, out) => stridePose(0, 0, FORWARD, 0, t, out)),
		{ label: 'idle' },
	);
	const walk = leaf(
		poseSource('walk', WALK_PERIOD, BONES, (t, out) =>
			stridePose((t / WALK_PERIOD) * TAU, 1, FORWARD, 0, t, out),
		),
		{ label: 'walk', sync: true, contactPhase: STRIDE_CONTACTS[0] },
	);
	const run = leaf(
		poseSource('run', RUN_PERIOD, BONES, (t, out) =>
			stridePose((t / RUN_PERIOD) * TAU, 1, FORWARD, 1, t, out),
		),
		{ label: 'run', sync: true, contactPhase: STRIDE_CONTACTS[0] },
	);

	const gait = blend1d(
		'speed',
		[
			{ node: idle, at: 0 },
			{ node: walk, at: WALK_SPEED },
			{ node: run, at: RUN_SPEED },
		],
		{ label: 'speed, m/s' },
	);

	const bank = blend1d(
		'turn',
		[
			{ node: leaf(clipSource(LEAN_RIGHT, index), { label: 'lean right' }), at: -1 },
			{ node: leaf(clipSource(UPRIGHT, index), { label: 'upright' }), at: 0 },
			{ node: leaf(clipSource(LEAN_LEFT, index), { label: 'lean left' }), at: 1 },
		],
		{ label: 'turn, −1 to 1' },
	);

	const root = layer(
		additive(gait, bank, { label: 'lean, added on top', gainParam: 'lean' }),
		leaf(clipSource(GUARD, index), { label: 'guard' }),
		UPPER_BODY,
		{ label: 'guard, through the upper body', weightParam: 'guard' },
	);

	const tree = new BlendTree(root, BONES, { fallbackDuration: WALK_PERIOD });

	/*
	 * Swept with the other axes at rest, because they barely touch the legs —
	 * the guard is masked to the upper body and the lean is a roll — and a
	 * curve per combination would be a table nobody could check.
	 */
	const speed = calibrateSpeed(tree, SKELETON, 'speed', [0, RUN_SPEED], {
		steps: 40,
		params: { turn: 0, lean: 0, guard: 0 },
		contactPhase: 0,
	});

	return treeAnimation({
		id: 'locomotion',
		label: 'Locomotion tree',
		tree,
		skeleton: SKELETON,
		parameters: [
			{
				name: 'speed',
				label: 'Speed',
				min: 0,
				max: speed.maxSpeed,
				step: 0.01,
				initial: WALK_SPEED,
				unit: 'm/s',
				hint: 'Calibrated: the number on the slider is the speed it delivers',
				toTree: speed.parameterFor,
			},
			{
				name: 'turn',
				label: 'Turn',
				min: -1,
				max: 1,
				step: 0.01,
				initial: 0,
				hint: 'Which way he is banking; negative is his right',
			},
			{
				name: 'lean',
				label: 'Lean gain',
				min: 0,
				max: 1,
				step: 0.01,
				initial: 1,
				hint: 'How much of the bank is laid over the gait',
			},
			{
				name: 'guard',
				label: 'Guard',
				min: 0,
				max: 1,
				step: 0.01,
				initial: 0,
				hint: 'Sword and board, through the upper-body mask',
			},
		],
	});
}

/**
 * The bat: one axis, from asleep to working.
 *
 * Deliberately the plain case next to the wanderer's. A single Blend1D over
 * three leaves is what most of a real tree is made of, and it is worth being
 * able to look at one without four parameters on top of it.
 */
export function batTree(): BenchTreeAnimation {
	const perch = leaf(
		poseSource('perch', PERCH_BREATH, BAT_BONES, (t, out) => perchPose(t, out)),
		{ label: 'perch' },
	);
	const hover = leaf(
		poseSource('hover', FLAP_PERIOD, BAT_BONES, (t, out) =>
			flyPose((t / FLAP_PERIOD) * TAU, 0.45, t, out),
		),
		{ label: 'hover', sync: true },
	);
	const fly = leaf(
		poseSource('fly', FLAP_PERIOD, BAT_BONES, (t, out) =>
			flyPose((t / FLAP_PERIOD) * TAU, 1, t, out),
		),
		{ label: 'fly', sync: true },
	);

	const root = blend1d(
		'effort',
		[
			{ node: perch, at: 0 },
			{ node: hover, at: 0.5 },
			{ node: fly, at: 1 },
		],
		{ label: 'effort, 0 to 1' },
	);

	return treeAnimation({
		id: 'flight',
		label: 'Flight tree',
		// No skeleton: it has feet, but nothing it does with them is walking, so
		// a ground speed measured off them would be a number about nothing.
		tree: new BlendTree(root, BAT_BONES, { fallbackDuration: FLAP_PERIOD }),
		parameters: [
			{
				name: 'effort',
				label: 'Effort',
				min: 0,
				max: 1,
				step: 0.01,
				initial: 1,
				hint: 'Asleep on its feet, hovering, or working the wings',
			},
		],
	});
}
