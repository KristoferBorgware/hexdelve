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
	calibrateSpeed,
	entityAnimations,
	entityBlendTrees,
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
	SCRAMBLE_PERIOD,
	scramblePose,
	SHAMBLE_CONTACTS,
	SHAMBLE_PERIOD,
	shamblePose,
} from '@hexdelve/client';

import {
	hexSpeed,
	NORMAL_SPEED,
	setWalkSpeed,
	RUN_SPEED,
	STRIDE_CONTACTS,
	stridePeriod,
	stridePose,
	WALK_SPEED,
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

describe('the ghoul, driven from clips', () => {
	it('has no pose function left in its animator', async () => {
		const ghoul = await library.entity('entities/ghoul.entity.yaml');
		for (const [name, animation] of entityAnimations(ghoul)) {
			expect(animation.kind, name).toBe('clip');
		}
	});

	it('walks and runs at the speeds the functions it was baked from did', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const ghoul = await library.entity('entities/ghoul.entity.yaml');
		const options = { feet: skeleton.feet!, contactPhase: SHAMBLE_CONTACTS[0] };

		const walk = entityAnimations(ghoul).get('walk')!;
		const run = entityAnimations(ghoul).get('run')!;

		const shamble = measureGroundSpeed(
			skeleton.skeleton,
			(phase, out) => shamblePose(phase * TAU, 1, 0, out),
			SHAMBLE_PERIOD,
			options,
		).z;
		const scramble = measureGroundSpeed(
			skeleton.skeleton,
			(phase, out) => scramblePose(phase * TAU, 1, 0, out),
			SCRAMBLE_PERIOD,
			options,
		).z;

		expect(walk.speed()!.z).toBeCloseTo(shamble, 3);
		expect(run.speed()!.z).toBeCloseTo(scramble, 3);
	});

	it('carries a tree whose axis still measures its own clips', async () => {
		const ghoul = await library.entity('entities/ghoul.entity.yaml');
		const tree = entityBlendTrees(ghoul).get('locomotion')!;
		const speed = tree.parameters.find((one) => one.name === 'speed')!;
		// `speedOf` reads the animation whatever kind it is, so the threshold is
		// the clip's own feet now rather than the function's.
		expect(speed.max).toBeCloseTo(entityAnimations(ghoul).get('run')!.speed()!.z, 9);
		expect(speed.initial).toBeCloseTo(entityAnimations(ghoul).get('walk')!.speed()!.z, 9);
	});

	it('delivers what the calibrated axis asks for', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const ghoul = await library.entity('entities/ghoul.entity.yaml');
		const tree = entityBlendTrees(ghoul).get('locomotion')!;
		const axis = tree.parameters.find((one) => one.name === 'speed')!;

		/*
		 * No contact phase here, unlike a measurement of one animation: a tree
		 * offsets every synced leaf by its own contact already, so the pose it
		 * hands back is in the tree's phase and its first footfall is at zero.
		 */
		const calibration = calibrateSpeed(tree.tree(), skeleton.skeleton, 'speed', [axis.min, axis.max], {
			feet: skeleton.feet!,
			steps: 16,
		});

		expect(calibration.maxSpeed).toBeCloseTo(axis.max, 3);
		// Monotone, or asking for a speed has more than one honest answer.
		for (let i = 1; i < calibration.samples.length; i++) {
			expect(calibration.samples[i]!.speed).toBeGreaterThanOrEqual(calibration.samples[i - 1]!.speed);
		}
		for (const asked of [axis.max * 0.25, axis.max * 0.5, axis.max * 0.75]) {
			expect(calibration.speedFor(calibration.parameterFor(asked))).toBeCloseTo(asked, 2);
		}
	});
});

describe('a baked clip closes on itself', () => {
	/*
	 * A clip loops whether or not what it was baked from did, so a source built
	 * on rhythms that do not divide into its own duration plays a jump once a
	 * cycle. The clips in the tree are checked here rather than only at the
	 * bake, because a hand-edit can open a gap that was closed.
	 */
	const looping = [
		'clips/ghoul-idle.clip.yaml',
		'clips/ghoul-walk.clip.yaml',
		'clips/ghoul-run.clip.yaml',
		'clips/hellhound-idle.clip.yaml',
		'clips/hellhound-run.clip.yaml',
		'clips/hellhound-rest.clip.yaml',
	];

	for (const path of looping) {
		it(`${path} arrives back where it started`, async () => {
			const skeleton = await library.rig(
				path.includes('hellhound') ? 'rigs/hellhound.rig.yaml' : 'rigs/humanoid.rig.yaml',
			);
			const clip = await player(path, skeleton);
			const start = clip.sample(0, {});
			const opening = JSON.parse(JSON.stringify(start));
			const closing = clip.sample(clip.duration, {});
			for (const bone in opening) {
				for (const channel of ['rot', 'pos'] as const) {
					const a = opening[bone][channel] ?? [0, 0, 0];
					const b = closing[bone]?.[channel] ?? [0, 0, 0];
					for (let c = 0; c < 3; c++) {
						expect(Math.abs(a[c] - b[c]), `${bone}.${channel}[${c}]`).toBeLessThan(0.01);
					}
				}
			}
		});
	}
});

describe('the wanderer, driven from clips through his tree', () => {
	it('has no pose function left in his animator', async () => {
		const wanderer = await library.entity('entities/wanderer.entity.yaml');
		for (const [name, animation] of entityAnimations(wanderer)) {
			expect(animation.kind, name).toBe('clip');
		}
	});

	it('walks and runs at the speeds the stride did', async () => {
		const wanderer = await library.entity('entities/wanderer.entity.yaml');
		const animations = entityAnimations(wanderer);
		expect(animations.get('walk')!.speed()!.z).toBeCloseTo(WALK_SPEED, 3);
		expect(animations.get('run')!.speed()!.z).toBeCloseTo(RUN_SPEED, 3);
	});

	/*
	 * The claim the whole turn clock rests on, end to end.
	 *
	 * One game turn is as long as the walk takes to cross a hexagon, so a man
	 * at normal speed is asked for exactly the speed his walk carries him at.
	 * If the tree delivered something else, his feet would make up the
	 * difference by sliding, and the readout would be lying about the fight.
	 */
	it('delivers exactly what the energy table asks a normal man for', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const wanderer = await library.entity('entities/wanderer.entity.yaml');
		// The clock is a tenth of the time his walk takes to cross a hexagon,
		// measured off the clip he is drawn with — so setting it and reading it
		// back is the round trip this whole arrangement rests on.
		setWalkSpeed(entityAnimations(wanderer).get('walk')!.speed()!.z);
		const tree = entityBlendTrees(wanderer).get('locomotion')!;
		const axis = tree.parameters.find((one) => one.name === 'speed')!;

		const calibration = calibrateSpeed(tree.tree(), skeleton.skeleton, 'speed', [axis.min, axis.max], {
			feet: skeleton.feet!,
			params: { turn: 0, lean: 0, guard: 0 },
		});

		const asked = hexSpeed(NORMAL_SPEED);
		expect(calibration.speedFor(calibration.parameterFor(asked))).toBeCloseTo(asked, 3);

		// And everywhere else on the axis, which is what calibrating it is for.
		for (const fraction of [0.25, 0.5, 0.75, 1]) {
			const want = axis.max * fraction;
			expect(calibration.speedFor(calibration.parameterFor(want)), `${fraction} of the axis`).toBeCloseTo(want, 3);
		}
	});
});

describe('the man’s gait, solved onto the ground', () => {
	/*
	 * What the ground solve is for, as three properties a gait written in joint
	 * angles cannot promise. None of them throws when it stops holding: the
	 * character still walks, he just skates, and whether he is skating is a
	 * judgement somebody has to make by eye at the right moment.
	 */
	/** Where in the cycle the left foot is, `at` of the way through its stance. */
	const stance = (at: number): number => 0.25 + 0.5 * at;

	it('stands him on the ground rather than above it', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const tip = skeleton.tips.find((one) => one.bone === 'footL')!.to[1];
		const pose = stridePose(0, 0, 0, 0, {});
		const world = solveWorld(skeleton.skeleton, pose);
		for (const foot of ['footL', 'footR']) {
			expect(Math.abs(world[foot]!.p[1] + tip), foot).toBeLessThan(0.005);
		}
	});

	it('keeps the planted foot on the ground through its whole stance', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const tip = skeleton.tips.find((one) => one.bone === 'footL')!.to[1];
		for (const gait of [0, 1]) {
			for (let i = 0; i <= 10; i++) {
				const phase = stance(i / 10);
				const world = solveWorld(skeleton.skeleton, stridePose(phase * TAU, 1, gait, 0, {}));
				expect(
					Math.abs(world['footL']!.p[1] + tip),
					`gait ${gait} at ${i}/10 of the stance`,
				).toBeLessThan(0.005);
			}
		}
	});

	it('travels that foot back at a steady rate rather than swinging it', async () => {
		/*
		 * The one a gait in joint angles gets wrong and nothing catches. A foot
		 * planted on `groundPath` covers equal ground in equal time; a foot
		 * whose path is whatever the angles work out to covers most of its
		 * ground in the middle of the stance and stalls at both ends, which is
		 * the foot sliding — and the foot IK cannot correct it, because it only
		 * moves a foot vertically.
		 */
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		for (const gait of [0, 1]) {
			const steps: number[] = [];
			let previous = 0;
			for (let i = 0; i <= 10; i++) {
				const phase = stance(i / 10);
				const z = solveWorld(skeleton.skeleton, stridePose(phase * TAU, 1, gait, 0, {}))['footL']!.p[2];
				if (i > 0) steps.push(z - previous);
				previous = z;
			}
			const low = Math.min(...steps);
			const high = Math.max(...steps);
			const spread = Math.abs((high - low) / ((high + low) / 2));
			expect(spread, `gait ${gait}`).toBeLessThan(0.1);
		}
	});

	it('carries him at a speed exactly proportional to the stride', async () => {
		const skeleton = await library.rig('rigs/humanoid.rig.yaml');
		const speedAt = (amp: number): number =>
			measureGroundSpeed(
				skeleton.skeleton,
				(phase, out) => stridePose(phase * TAU, amp, 0, 0, out),
				stridePeriod(0),
				{ feet: skeleton.feet!, contactPhase: STRIDE_CONTACTS[0] },
			).z;

		const full = speedAt(1);
		expect(full).toBeCloseTo(WALK_SPEED, 6);
		for (const amp of [0.25, 0.5, 0.75]) {
			expect(Math.abs(speedAt(amp) / (full * amp) - 1), `amp ${amp}`).toBeLessThan(0.01);
		}
	});

	it('keeps a run about twice a walk, so the energy table still reads as a gait', () => {
		// A creature hasted by +10 crosses a hexagon in half the time, and the
		// only thing that can be is a run.
		expect(RUN_SPEED / WALK_SPEED).toBeGreaterThan(1.7);
	});
});

describe('the bat, driven from clips through its tree', () => {
	it('has no pose function left in its animator', async () => {
		const bat = await library.entity('entities/bat.entity.yaml');
		for (const [name, animation] of entityAnimations(bat)) {
			expect(animation.kind, name).toBe('clip');
		}
	});

	it('covers the whole beat it uses, not just the cruise', async () => {
		/*
		 * The bat settles at well under a hover and thrashes at half again a
		 * cruise. An axis that stopped at the cruise would clamp the top of
		 * that, so the tree has a fourth leaf and the beats it was baked at are
		 * what `BatAnimator` maps onto it.
		 */
		const bat = await library.entity('entities/bat.entity.yaml');
		const names = [...entityAnimations(bat).keys()];
		for (const leaf of ['perch', 'hover', 'fly', 'thrash']) {
			expect(names, leaf).toContain(leaf);
		}
		const tree = entityBlendTrees(bat).get('flight')!;
		expect(tree.parameters.map((one) => one.name)).toEqual(['effort']);
	});

	it('measures its reach off the strike it actually plays', async () => {
		const bat = await library.entity('entities/bat.entity.yaml');
		const lunge = entityAnimations(bat).get('lunge')!;
		expect(lunge.clip).not.toBeNull();
		// A clip rather than the function it was baked from: re-baking the
		// strike has to move the reach with it, or the rules would go on
		// claiming a reach the animation no longer has.
		expect(lunge.clip!.name).toBe('bat-lunge');
	});
});
