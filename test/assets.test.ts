/*
 * The asset files against the code they replace.
 *
 * Every rig, body, clip and tree in `assets/` was a TypeScript module first,
 * and those modules are still here. That is the whole opportunity of this
 * test: there is a second, independent statement of what a wanderer is, and it
 * can be compared part for part and key for key. A mesh file that drops a
 * prism, mirrors the wrong axis or reads a colour out of the wrong palette
 * entry fails here rather than being noticed later by somebody looking at a
 * character with one ear.
 *
 * Numbers are compared to 1e-9 rather than exactly, and the reason is worth
 * stating so nobody tightens it and wonders why it breaks. `pi / 2 + 0.05` in
 * a file and `PI / 2 + 0.05` in TypeScript are the same double, but
 * `deg(12)` is `(12 * pi) / 180` where the source wrote `12 * (PI / 180)`, and
 * a frame composes a rotation through a quaternion where the sword's own
 * helper multiplied out a sine and a cosine by hand. Those differ in the last
 * bit or two of a double — a millionth of a millimetre — and demanding
 * bit-equality would only mean writing 1.6207963267948965 in the file, which
 * is the thing the expressions exist to avoid.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	AssetLibrary,
	loadRig,
	type AssetSource,
	type EntityAsset,
	type Model,
	type RigAsset,
	type Skeleton,
} from '@hexdelve/engine';
import {
	BAT_SKELETON,
	BAT_TIPS,
	buildBat,
	buildGhoul,
	buildHellhound,
	buildHelmet,
	buildShield,
	buildSword,
	buildWanderer,
	DUCK,
	GUARD,
	HELLHOUND_SKELETON,
	HELLHOUND_TIPS,
	HIPS_Y,
	HOVER_Y,
	LEAN_LEFT,
	LEAN_RIGHT,
	poseFunctions,
	SKELETON,
	SLASH,
	SWORD_TIP,
	TIPS,
	UPPER_BODY,
	UPRIGHT,
} from '@hexdelve/client';

const root = resolvePath(import.meta.dirname, '..', 'assets');

/**
 * The disk as an asset source.
 *
 * Four lines, which is the point of `AssetSource` being one method: nothing in
 * @hexdelve/engine imports `node:fs`, and a test that wants the disk does not
 * need it to.
 */
const disk: AssetSource = {
	read: (path) => readFile(resolvePath(root, path), 'utf8'),
};

const library = new AssetLibrary(disk, { poseFunctions });

const entity = (id: string): Promise<EntityAsset> => library.entity(`entities/${id}.entity.yaml`);

function readRig(name: string): Promise<RigAsset> {
	return library.rig(`rigs/${name}.rig.yaml`);
}

/** Every prism, in order, against the model the code builds. */
function expectSameModel(loaded: Model, built: Model): void {
	expect(loaded.parts).toHaveLength(built.parts.length);

	for (let i = 0; i < built.parts.length; i++) {
		const a = loaded.parts[i]!;
		const b = built.parts[i]!;
		const where = `part ${i} (bone ${b.bone})`;

		expect(a.bone, where).toBe(b.bone);
		expect(a.color, where).toEqual(b.color);
		expect(a.alpha, where).toBe(b.alpha);
		expect(a.flags, where).toBe(b.flags);

		for (let axis = 0; axis < 3; axis++) {
			expect(a.position[axis]!, `${where} position[${axis}]`).toBeCloseTo(b.position[axis]!, 9);
			expect(a.scale[axis]!, `${where} scale[${axis}]`).toBeCloseTo(b.scale[axis]!, 9);
		}
		for (let axis = 0; axis < 4; axis++) {
			expect(a.rotation[axis]!, `${where} rotation[${axis}]`).toBeCloseTo(b.rotation[axis]!, 6);
		}
	}
}

function expectSameSkeleton(loaded: Skeleton, built: Skeleton): void {
	expect(loaded).toEqual(built);
}

describe('rigs', () => {
	it('the humanoid is the one in skeleton.ts', async () => {
		const rig = await readRig('humanoid');
		expectSameSkeleton(rig.skeleton, SKELETON);
		expect(rig.tips).toEqual(TIPS);
		expect(rig.masks.upperBody).toEqual(UPPER_BODY);
		expect(rig.metrics.hipHeight).toBe(HIPS_Y);
		expect(rig.metrics.legLength).toBeCloseTo(0.41 + 0.35, 12);
		expect(rig.feet).toEqual(['footL', 'footR']);
	});

	it('the bat is the one in batrig.ts', async () => {
		const rig = await readRig('bat');
		expectSameSkeleton(rig.skeleton, BAT_SKELETON);
		expect(rig.tips).toEqual(BAT_TIPS);
		expect(rig.metrics.hoverHeight).toBe(HOVER_Y);
		expect(rig.metrics.span).toBeCloseTo(2 * (0.11 + 0.34 + 0.4 + 0.26 + 0.24), 12);
	});

	it('the hellhound is the one in hellhoundrig.ts', async () => {
		const rig = await readRig('hellhound');
		expectSameSkeleton(rig.skeleton, HELLHOUND_SKELETON);
		expect(rig.tips).toEqual(HELLHOUND_TIPS);
	});

	it('refuses a child that comes before its parent', () => {
		const source = ['id: bad', 'bones:', '  - { name: hand, parent: arm, offset: [0, 0, 0] }'].join('\n');
		expect(() => loadRig(source, 'bad.rig.yaml')).toThrow(/must precede/);
	});

	it('refuses a mask naming a bone that does not exist', () => {
		const source = [
			'id: bad',
			'bones:',
			'  - { name: root, offset: [0, 0, 0] }',
			'masks:',
			'  upper: { chest: 1 }',
		].join('\n');
		expect(() => loadRig(source, 'bad.rig.yaml')).toThrow(/no bone called 'chest'/);
	});
});

describe('bodies', () => {
	const cases: readonly [string, () => Model][] = [
		['wanderer', buildWanderer],
		['ghoul', buildGhoul],
		['bat', buildBat],
		['hellhound', buildHellhound],
		['helmet', buildHelmet],
		['sword', buildSword],
		['shield', buildShield],
	];

	for (const [id, build] of cases) {
		it(`${id} is the model its module builds`, async () => {
			const loaded = await entity(id);
			expectSameModel(loaded.mesh.model(), build());
		});
	}

	it("the sword's tip is still measured off the blade", async () => {
		const sword = await entity('sword');
		const tip = sword.mesh.anchors.tip!;
		expect(tip.bone).toBe('handR');
		for (let axis = 0; axis < 3; axis++) {
			expect(tip.at[axis]!).toBeCloseTo(SWORD_TIP[axis]!, 9);
		}
	});
});

describe('clips', () => {
	const cases: readonly [string, string, typeof GUARD][] = [
		['guard', 'guard', GUARD],
		['slash', 'slash', SLASH],
		['duck', 'duck', DUCK],
		['upright', 'upright', UPRIGHT],
		['leanLeft', 'lean-left', LEAN_LEFT],
		['leanRight', 'lean-right', LEAN_RIGHT],
	];

	for (const [name, file, built] of cases) {
		it(`${name} is the clip clips.ts authors`, async () => {
			const rig = await readRig('humanoid');
			const loaded = await library.clip(`clips/${file}.clip.yaml`, rig);
			expect(loaded.clip.duration).toBe(built.duration);
			expect(loaded.clip.loop).toBe(built.loop);
			expect(loaded.clip.events).toEqual(built.events);
			expect(Object.keys(loaded.clip.tracks).sort()).toEqual(Object.keys(built.tracks).sort());
			for (const bone of Object.keys(built.tracks)) {
				expect(loaded.clip.tracks[bone], bone).toEqual(built.tracks[bone]);
			}
		});
	}
});

describe('entities', () => {
	it('lists every one of them in the manifest', async () => {
		const all = await library.index();
		expect(all.map((one) => one.id)).toEqual([
			'wanderer',
			'ghoul',
			'bat',
			'hellhound',
			'helmet',
			'sword',
			'shield',
		]);
	});

	it('gives the wanderer and the ghoul the same rig', async () => {
		const wanderer = await entity('wanderer');
		const ghoul = await entity('ghoul');
		expect(ghoul.rig).toBe(wanderer.rig);
		expect(ghoul.mesh).not.toBe(wanderer.mesh);
	});

	it('gives a prop no rig, and a bone to hang from', async () => {
		const helmet = await entity('helmet');
		expect(helmet.kind).toBe('prop');
		expect(helmet.rig).toBeNull();
		expect(helmet.animations.size).toBe(0);
		expect(helmet.attach?.bone).toBe('head');
		expect(helmet.ground?.lift).toBeCloseTo(0.2, 12);
	});

	it('refuses a prop that claims a rig', async () => {
		const source = ['id: bad', 'kind: prop', 'rig: ../rigs/humanoid.rig.yaml', 'mesh: x.mesh.yaml'].join('\n');
		const one = new AssetLibrary({ read: async () => source });
		await expect(one.entity('bad.entity.yaml')).rejects.toThrow(/a prop has no rig/);
	});
});

describe('animations', () => {
	it("measures the walk and the run off the wanderer's own feet", async () => {
		const wanderer = await entity('wanderer');
		const walk = wanderer.animations.get('walk')!;
		const run = wanderer.animations.get('run')!;
		expect(walk.speed()!.z).toBeGreaterThan(0.5);
		expect(run.speed()!.z).toBeGreaterThan(walk.speed()!.z);
	});

	it('carries a blend tree whose thresholds are those measurements', async () => {
		const wanderer = await entity('wanderer');
		const locomotion = wanderer.blendTrees.get('locomotion')!;
		const speed = locomotion.parameters.find((one) => one.name === 'speed')!;
		expect(speed.unit).toBe('m/s');
		expect(speed.calibrated).toBe(true);
		expect(speed.max).toBeCloseTo(wanderer.animations.get('run')!.speed()!.z, 9);

		// A tree owns a playhead, so two subjects must never share one.
		expect(locomotion.tree()).not.toBe(locomotion.tree());
	});

	it('holds the tree in phase at a blend of walk and run', async () => {
		const wanderer = await entity('wanderer');
		const tree = wanderer.blendTrees.get('locomotion')!.tree();
		const walk = wanderer.animations.get('walk')!.speed()!.z;
		const run = wanderer.animations.get('run')!.speed()!.z;

		tree.resolve({ speed: (walk + run) / 2, turn: 0, lean: 0, guard: 0 });
		for (let i = 0; i < 30; i++) tree.advance({ speed: (walk + run) / 2, turn: 0, lean: 0, guard: 0 }, 1 / 60);
		expect(tree.phaseSpread()).toBeLessThan(1e-6);
	});
});
