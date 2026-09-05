/*
 * Does a baked clip still do what the function it came from did?
 *
 * A pose function is a good way to work out a cycle and a poor way to ship
 * one, so `bakeClip` writes down what it derived and `tools/bake-clips.mjs`
 * puts the result in the asset tree. Both halves can fail quietly.
 *
 * The bake can place too few keys, and the clip then rounds off the moment the
 * curve was about — a paw that met the ground now hovers over it, and nothing
 * throws. So the first block bakes a gait and asks how far the result sits
 * from its source, measured through the same Hermite the runtime plays it
 * through.
 *
 * And the clips in the tree are meant to be EDITED once they are there, which
 * is the whole reason for baking rather than keeping the function. So the rest
 * checks the properties a hand-edit could break rather than the bytes a
 * hand-edit is supposed to change: every paw on the ground at the stand, every
 * planted paw on the ground through its stance, and the gait still carrying
 * the animal forwards. A clip that fails those is wrong however it got there.
 */

import { describe, expect, it } from 'vitest';

import {
	bakeClip,
	bindClip,
	boneIndex,
	createPose,
	denseToSparse,
	measureGroundSpeed,
	poseClip,
	sampleBound,
	samplePose,
	solveWorld,
	type RigAsset,
	type SparsePose,
} from '@hexdelve/engine';
import {
	HOUND_RUN_CONTACTS,
	HOUND_STRIDE_PERIOD,
	houndRunPose,
} from '@hexdelve/client';

import { openLibrary } from './harness/assets.js';

const TAU = Math.PI * 2;
const library = openLibrary();

/** The tolerance `tools/bake-clips.mjs` bakes at, and its reasoning. */
const TOLERANCE = 0.002;

const rig = (): Promise<RigAsset> => library.rig('rigs/hellhound.rig.yaml');

/** A clip from the tree, as a function from a time to a pose. */
async function player(path: string, skeleton: RigAsset) {
	const asset = await library.clip(path, skeleton);
	const bound = bindClip(asset.clip, boneIndex(skeleton.skeleton));
	const dense = createPose(skeleton.bones.length);
	return {
		duration: asset.clip.duration,
		sample: (t: number, out: SparsePose): SparsePose => {
			sampleBound(bound, t, dense);
			return denseToSparse(skeleton.bones, dense, out);
		},
	};
}

/** Where a paw's own tip is, which is what touches the ground. */
function tipHeight(skeleton: RigAsset, pose: SparsePose, paw: string): number {
	const tip = skeleton.tips.find((one) => one.bone === paw)!;
	return solveWorld(skeleton.skeleton, pose)[paw]!.p[1] + tip.to[1];
}

describe('baking a cycle into keys', () => {
	it('reproduces the function it was baked from', () => {
		const baked = bakeClip(
			'trot',
			HOUND_STRIDE_PERIOD,
			'loop',
			(t, out) => houndRunPose((t / HOUND_STRIDE_PERIOD) * TAU, 1, 0, out),
			{ anchors: HOUND_RUN_CONTACTS, tolerance: TOLERANCE },
		);

		expect(baked.report.exhausted, 'refinement ran out of keys').toBe(false);
		expect(baked.report.worst.error).toBeLessThanOrEqual(TOLERANCE);
		// A cycle this size needs keys, and a bake that produced two of them
		// would be reporting a tolerance it met by accident.
		expect(baked.report.keys).toBeGreaterThan(8);
	});

	it('keeps the moments a gait is edited at', () => {
		const baked = bakeClip(
			'trot',
			HOUND_STRIDE_PERIOD,
			'loop',
			(t, out) => houndRunPose((t / HOUND_STRIDE_PERIOD) * TAU, 1, 0, out),
			{ anchors: HOUND_RUN_CONTACTS, tolerance: TOLERANCE },
		);
		// The contacts are what a gait is reasoned about at, so they get a key
		// whatever the error says — otherwise moving a footfall means moving
		// whichever keys happen to straddle it.
		for (const contact of HOUND_RUN_CONTACTS) {
			const t = contact * HOUND_STRIDE_PERIOD;
			expect(
				baked.poses.some((pose) => Math.abs(pose.t - t) < 1e-6),
				`no key at the contact at ${contact}`,
			).toBe(true);
		}
	});

	it('leaves out a bone that never moves', () => {
		// One bone doing something, on a rig whose other bones are at rest.
		const baked = bakeClip('nod', 1, 'loop', (t, out) => {
			out['head'] = { rot: [Math.sin(t * TAU) * 0.3, 0, 0], pos: [0, 0, 0] };
			out['jaw'] = { rot: [0, 0, 0], pos: [0, 0, 0] };
			return out;
		});
		expect(baked.report.bones).toBe(1);
		for (const pose of baked.poses) expect(Object.keys(pose.p)).toEqual(['head']);
	});

	it('closes a looping clip onto its own first key', () => {
		const baked = bakeClip('nod', 1, 'loop', (t, out) => {
			out['head'] = { rot: [Math.sin(t * TAU) * 0.3, 0, 0] };
			return out;
		});
		// The wrap segment interpolates back to the first key, so authoring one
		// at the end would be authoring the same pose twice.
		for (const pose of baked.poses) expect(pose.t).toBeLessThan(1);

		const clip = poseClip('nod', 1, 'loop', [...baked.poses]);
		const start = samplePose(clip, 0)['head']!.rot!;
		const end = samplePose(clip, 1)['head']!.rot!;
		for (let c = 0; c < 3; c++) expect(end[c]!).toBeCloseTo(start[c]!, 9);
	});
});

describe('the hellhound’s baked clips', () => {
	it('stand it on all four paws', async () => {
		const skeleton = await rig();
		const idle = await player('clips/hellhound-idle.clip.yaml', skeleton);
		const pose = idle.sample(0, {});
		for (const paw of ['frontPawL', 'frontPawR', 'backPawL', 'backPawR']) {
			expect(Math.abs(tipHeight(skeleton, pose, paw)), `${paw} at the stand`).toBeLessThan(0.005);
		}
	});

	it('keep every planted paw on the ground through its stance', async () => {
		const skeleton = await rig();
		const run = await player('clips/hellhound-run.clip.yaml', skeleton);
		// Each paw's own phase: the left hind leads, the left front is the other
		// diagonal and so runs half a cycle behind it.
		for (const { paw, offset } of [
			{ paw: 'backPawL', offset: 0 },
			{ paw: 'frontPawL', offset: Math.PI },
		]) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const phase = (((own - offset) / TAU) % 1 + 1) % 1;
				const pose = run.sample(phase * run.duration, {});
				expect(
					Math.abs(tipHeight(skeleton, pose, paw)),
					`${paw} at ${i}/10 of its stance`,
				).toBeLessThan(0.005);
			}
		}
	});

	it('carry it forwards, at the speed the gait was baked from', async () => {
		const skeleton = await rig();
		const run = await player('clips/hellhound-run.clip.yaml', skeleton);
		const options = { feet: skeleton.feet!, contactPhase: HOUND_RUN_CONTACTS[0] };

		const played = measureGroundSpeed(
			skeleton.skeleton,
			(phase, out) => run.sample(phase * run.duration, out),
			run.duration,
			options,
		).z;
		const source = measureGroundSpeed(
			skeleton.skeleton,
			(phase, out) => houndRunPose(phase * TAU, 1, 0, out),
			HOUND_STRIDE_PERIOD,
			options,
		).z;

		expect(played).toBeGreaterThan(1);
		expect(played).toBeCloseTo(source, 4);
	});
});
