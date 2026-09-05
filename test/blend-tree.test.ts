/*
 * Does the blend tree blend what it says it does?
 *
 * A blend tree is the part of an animation system that fails without telling
 * anyone. Nothing throws when two gaits drift out of phase: the weights are
 * still sensible, the tree still produces a pose, the character still walks —
 * he just skates, and whether he is skating is a judgement somebody has to
 * make by eye at the right moment. That is not a check, and the editor's
 * character bench exists partly because there was nowhere to make it. This is
 * the half of it a machine can make.
 *
 * Each block below has a silent failure behind it:
 *
 *   thresholds    at a leaf's own threshold the tree must BE that leaf — the
 *                 same cycle and the same ground speed, or the numbers on the
 *                 slider are decoration
 *   calibration   and BETWEEN thresholds it must deliver what is asked for,
 *                 which it does not do by itself: a blend of two gaits blends
 *                 the stride and the cadence separately, and speed is one
 *                 divided by the other
 *   sync          the synced leaves must stay at zero phase spread across the
 *                 whole axis and the whole cycle
 *   no sync       and must not, with it off — a toggle that changes nothing is
 *                 worse than no toggle, because it argues that sync is free
 *   additive      a zero layer must change nothing and a full one must add
 *                 exactly its own values, not some fraction of them
 *   layer         a mask must move the bones it names and leave the rest alone
 *
 * Everything is imported by package name, so this exercises the code the
 * editor and the game actually run rather than a copy of it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
	BlendTree,
	calibrateSpeed,
	entityAnimations,
	entityBlendTrees,
	entityRig,
	measureGroundSpeed,
	type EntityAsset,
	type Parameters,
	type Skeleton,
	type SpeedCalibration,
	type SparsePose,
} from '@hexdelve/engine';
import { openLibrary } from './harness/assets.js';

/*
 * A microradian. Poses are Float32Array, so a difference of two of them
 * carries about seven digits and no more; anything above this is the blend,
 * not the storage.
 */
const EPSILON = 1e-6;

/* ------------------------------------------------------------------ tree -- */

/*
 * The wanderer's own locomotion tree, out of the asset files.
 *
 * It used to be assembled here — the leaves, the blend1d over them, the
 * additive lean, the layered guard — which made this a test of a replica. It
 * is now `public/assets/trees/locomotion.tree.yaml`, the same file the editor
 * and the game read, so what is checked below is the tree that actually runs.
 * Everything the assertions need comes off the entity: the bones, the
 * measured speeds, the cycle lengths.
 */
let tree: BlendTree;
let wanderer: EntityAsset;
let BONES: readonly string[];
let SKELETON: Skeleton;
let UPPER_BODY: Record<string, number>;
let WALK_SPEED: number;
let RUN_SPEED: number;
let WALK_PERIOD: number;
let RUN_PERIOD: number;

beforeAll(async () => {
	wanderer = await openLibrary().entity('entities/wanderer.entity.yaml');
	const rig = entityRig(wanderer)!;

	BONES = rig.bones;
	SKELETON = rig.skeleton;
	UPPER_BODY = { ...rig.masks.upperBody };

	const walk = entityAnimations(wanderer).get('walk')!;
	const run = entityAnimations(wanderer).get('run')!;
	WALK_PERIOD = walk.duration;
	RUN_PERIOD = run.duration;
	WALK_SPEED = walk.speed()!.z;
	RUN_SPEED = run.speed()!.z;

	tree = entityBlendTrees(wanderer).get('locomotion')!.tree();
});

const BASE: Parameters = { speed: 0, turn: 0, lean: 0, guard: 0 };

/** The tree's pose at a phase, as a fresh sparse pose. */
function poseAt(params: Parameters, phase: number): SparsePose {
	tree.resolve(params);
	tree.phase = phase;
	tree.elapsed = phase * tree.cycle;
	tree.evaluate();
	return tree.toSparse({});
}

/** What the tree really carries him at, forwards, in metres per second. */
function speedOf(params: Parameters): number {
	tree.resolve(params);
	const cycle = tree.cycle;
	return measureGroundSpeed(
		SKELETON,
		(phase, out) => {
			tree.phase = phase;
			tree.elapsed = phase * cycle;
			tree.evaluate();
			return tree.toSparse(out);
		},
		cycle,
	).z;
}

/** One gait's measured speed and its own cycle, off the loaded entity. */
function gait(name: 'walk' | 'run'): { speed: number; period: number } {
	const animation = entityAnimations(wanderer).get(name)!;
	return { speed: animation.speed()!.z, period: animation.duration };
}

/** The worst per-channel difference between two poses. */
function worstDifference(a: SparsePose, b: SparsePose, bones: readonly string[] = BONES): number {
	let worst = 0;
	for (const bone of bones) {
		for (let c = 0; c < 3; c++) {
			worst = Math.max(worst, Math.abs(a[bone]!.rot![c]! - b[bone]!.rot![c]!));
		}
	}
	return worst;
}

/* ------------------------------------------------------------------ tests -- */

describe('at a leaf’s own threshold the tree is that leaf', () => {
	/*
	 * Resolved inside each test rather than beside them: both numbers are now
	 * measured off files, so neither exists until the manifest has been read.
	 */
	const cases = ['walk', 'run'] as const;

	for (const name of cases) {
		it(`${name}: the cycle is the clip's own`, () => {
			const { speed, period } = gait(name);
			tree.sync = true;
			tree.resolve({ ...BASE, speed });
			expect(tree.cycle).toBeCloseTo(period, 6);
		});

		it(`${name}: it carries him at the threshold`, () => {
			const { speed } = gait(name);
			tree.sync = true;
			expect(speedOf({ ...BASE, speed })).toBeCloseTo(speed, 3);
		});
	}

	it('winds the cadence up smoothly in between', () => {
		tree.sync = true;
		tree.resolve({ ...BASE, speed: (WALK_SPEED + RUN_SPEED) / 2 });
		expect(tree.cycle).toBeLessThan(WALK_PERIOD);
		expect(tree.cycle).toBeGreaterThan(RUN_PERIOD);
	});
});

describe('calibration makes the axis mean metres per second', () => {
	let calibration: SpeedCalibration;

	beforeAll(() => {
		calibration = calibrateSpeed(tree, SKELETON, 'speed', [0, RUN_SPEED], {
			steps: 40,
			params: { turn: 0, lean: 0, guard: 0 },
		});
	});

	/*
	 * The uncalibrated error first, because a calibration that fixes nothing
	 * would pass every assertion below it. If this ever stops holding, the
	 * blend has changed and the rest of this block is measuring the wrong
	 * thing.
	 */
	it('there is an error to remove', () => {
		tree.sync = true;
		let worst = 0;
		for (let i = 0; i <= 20; i++) {
			const asked = (RUN_SPEED * i) / 20;
			worst = Math.max(worst, Math.abs(speedOf({ ...BASE, speed: asked }) - asked));
		}
		expect(worst).toBeGreaterThan(0.05);
	});

	it('and calibrating removes it', () => {
		tree.sync = true;
		let worst = 0;
		let worstAt = 0;
		for (let i = 0; i <= 40; i++) {
			const asked = (calibration.maxSpeed * i) / 40;
			const delivered = speedOf({ ...BASE, speed: calibration.parameterFor(asked) });
			if (Math.abs(delivered - asked) > worst) {
				worst = Math.abs(delivered - asked);
				worstAt = asked;
			}
		}
		// A centimetre a second, against gaits that run at one and three metres.
		expect(worst, `worst at ${worstAt.toFixed(2)} m/s`).toBeLessThan(0.01);
	});

	it('leaves the thresholds where they were', () => {
		expect(calibration.parameterFor(WALK_SPEED)).toBeCloseTo(WALK_SPEED, 2);
		expect(calibration.parameterFor(RUN_SPEED)).toBeCloseTo(RUN_SPEED, 2);
	});

	it('is monotonic, or the inverse would not be a function', () => {
		for (let i = 1; i < calibration.samples.length; i++) {
			expect(calibration.samples[i]!.speed).toBeGreaterThanOrEqual(
				calibration.samples[i - 1]!.speed,
			);
		}
	});

	it('round-trips a value through both directions', () => {
		for (const value of [0.4, 1.2, 2.0, 2.6]) {
			expect(calibration.parameterFor(calibration.speedFor(value))).toBeCloseTo(value, 2);
		}
	});
});

describe('phase sync', () => {
	it('holds the synced leaves together everywhere on the axis', () => {
		tree.sync = true;
		let worst = 0;
		for (let i = 0; i <= 20; i++) {
			for (let p = 0; p < 1; p += 1 / 16) {
				tree.resolve({ ...BASE, speed: (RUN_SPEED * i) / 20 });
				tree.phase = p;
				worst = Math.max(worst, tree.phaseSpread());
			}
		}
		expect(worst).toBeLessThan(1e-9);
	});

	it('so he never travels backwards', () => {
		tree.sync = true;
		let slowest = Infinity;
		for (let i = 0; i <= 20; i++) {
			slowest = Math.min(slowest, speedOf({ ...BASE, speed: (RUN_SPEED * i) / 20 }));
		}
		expect(slowest).toBeGreaterThanOrEqual(-1e-6);
	});

	it('and without it they drift, which is what the toggle is for', () => {
		tree.sync = false;
		let worst = 0;
		const params = { ...BASE, speed: (WALK_SPEED + RUN_SPEED) / 2 };
		for (let i = 0; i <= 200; i++) {
			tree.resolve(params);
			tree.elapsed = i * 0.05;
			tree.phase = 0;
			worst = Math.max(worst, tree.phaseSpread());
		}
		tree.sync = true;
		expect(worst, 'sync is not doing anything').toBeGreaterThan(0.2);
	});
});

describe('an additive layer', () => {
	it('changes nothing at zero gain', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const zeroGain = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 0 }, 0.3);
		expect(worstDifference(plain, zeroGain)).toBeLessThan(EPSILON);
	});

	// LEAN_LEFT rolls the root by -0.1 about Z. At full gain that is exactly
	// what should appear on top of whatever the stride had there.
	it('adds itself whole at full gain', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const leaned = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 1 }, 0.3);
		expect(leaned['root']!.rot![2]! - plain['root']!.rot![2]!).toBeCloseTo(-0.1, 5);
	});

	it('and half of itself at half gain', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const half = poseAt({ ...BASE, speed: WALK_SPEED, turn: 1, lean: 0.5 }, 0.3);
		expect(half['root']!.rot![2]! - plain['root']!.rot![2]!).toBeCloseTo(-0.05, 5);
	});
});

describe('a masked layer', () => {
	// Split inside the tests: the mask comes off the rig file, which is read
	// in beforeAll, so neither list exists while the describes are being built.
	const masked = (): readonly string[] => BONES.filter((bone) => (UPPER_BODY[bone] ?? 0) > 0);
	const free = (): readonly string[] => BONES.filter((bone) => (UPPER_BODY[bone] ?? 0) === 0);

	it('moves the bones the mask names', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const guarded = poseAt({ ...BASE, speed: WALK_SPEED, guard: 1 }, 0.3);
		expect(worstDifference(plain, guarded, masked())).toBeGreaterThan(0.05);
	});

	it('and leaves the legs striding', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const guarded = poseAt({ ...BASE, speed: WALK_SPEED, guard: 1 }, 0.3);
		expect(worstDifference(plain, guarded, free()), 'the mask is leaking').toBeLessThan(EPSILON);
	});

	it('is the base exactly at weight zero', () => {
		tree.sync = true;
		const plain = poseAt({ ...BASE, speed: WALK_SPEED }, 0.3);
		const none = poseAt({ ...BASE, speed: WALK_SPEED, guard: 0 }, 0.3);
		expect(worstDifference(plain, none)).toBe(0);
	});
});
