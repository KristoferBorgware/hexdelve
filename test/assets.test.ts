/*
 * The asset files: what they load to, and what still has to agree with them.
 *
 * This test used to compare every file against the TypeScript module it
 * replaced, part for part and key for key. Those modules are gone — that was
 * the point — so the comparison went with them, and it did its job: the yard
 * drawn from these files is pixel-identical to the reference picture taken
 * when it was drawn from code, which `render.test.ts` still checks.
 *
 * What is left here is the three things that outlive the migration.
 *
 * The files LOAD, and to the shapes the game expects: eight entities, four
 * rigs, the trees measuring their own thresholds. A file that stopped parsing
 * would be found by the render test too, but only as a blank picture.
 *
 * The loaders REFUSE what they should. Every one of these has a silent
 * mis-reading available to it, and a silent mis-reading in an asset file is a
 * character drawn slightly wrong with nothing to point at.
 *
 * And the pose functions still AGREE with the rigs. A pose function names its
 * bones outright and was tuned against particular offsets, so it carries a
 * copy of the few numbers it needs — see the note in `game/humanoid.ts`. A
 * copy can drift, so it is pinned here: change a leg bone in the rig file and
 * leave the stride behind, and this fails rather than the man's feet sliding.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	AssetLibrary,
	attachmentPosition,
	loadRig,
	AssetWriteError,
	memoryIO,
	readOnly,
	solveWorld,
	type AssetIO,
	type EntityAsset,
	type RigAsset,
} from '@hexdelve/engine';
import {
	DIRE_BITE_CONTACT,
	DIRE_CHAIN,
	DIRE_RUN_CONTACTS,
	DIRE_STRIDE_PERIOD,
	direBitePose,
	direRestPose,
	direRunPose,
	flyPose,
	HOUND_STRIDE_PERIOD,
	houndRunPose,
	LEG_LENGTH,
	perchPose,
	poseFunctions,
	RUN_PERIOD,
	stridePose,
	WALK_PERIOD,
} from '@hexdelve/client';

const root = resolvePath(import.meta.dirname, '..', 'public', 'assets');

/**
 * The disk as an asset backend, read and write.
 *
 * A dozen lines, which is the point of `AssetIO` being this small: nothing in
 * @hexdelve/engine imports `node:fs`, a test that wants the disk does not need
 * it to, and a tool wanting one writes the same dozen lines.
 */
function diskIO(at: string): AssetIO {
	const full = (path: string): string => resolvePath(at, path);
	return {
		kind: 'memory',
		origin: at,
		read: (path) => readFile(full(path), 'utf8'),
		writer: {
			async write(path, text) {
				await mkdir(dirname(full(path)), { recursive: true });
				await writeFile(full(path), text, 'utf8');
			},
			remove: (path) => rm(full(path), { force: true }),
		},
	};
}

/*
 * The real tree, opened READ-ONLY. A test that can write to public/assets is a
 * test that can quietly rewrite the thing it is checking; the write path is
 * exercised below against a scratch backend instead.
 */
const library = new AssetLibrary(readOnly(diskIO(root)), { poseFunctions });

const entity = (id: string): Promise<EntityAsset> => library.entity(`entities/${id}.entity.yaml`);

function readRig(name: string): Promise<RigAsset> {
	return library.rig(`rigs/${name}.rig.yaml`);
}



describe('rigs', () => {
	it('the humanoid loads to the shape everything downstream expects', async () => {
		const rig = await readRig('humanoid');
		expect(rig.bones).toHaveLength(17);
		expect(rig.bones[0]).toBe('root');
		expect(rig.tips.map((tip) => tip.bone)).toEqual(['head', 'handL', 'handR', 'footL', 'footR']);
		expect(rig.masks.upperBody!.chest).toBe(1);
		expect(rig.masks.upperBody!.spine).toBeCloseTo(0.45, 12);
		expect(rig.feet).toEqual(['footL', 'footR']);
		// Parents always precede their children, which is what lets one forward
		// pass resolve the hierarchy.
		const seen = new Set<string>();
		for (const bone of rig.skeleton) {
			if (bone.parent) expect(seen.has(bone.parent), bone.name).toBe(true);
			seen.add(bone.name);
		}
	});

	it('the bat measures its own span rather than stating one', async () => {
		const rig = await readRig('bat');
		expect(rig.bones).toHaveLength(20);
		expect(rig.anchors.jawTip).toEqual({ bone: 'jaw', at: [0, -0.02, 0.16] });
		expect(rig.groups.wingL).toEqual(['armL', 'foreL', 'handL', 'digitL']);
		// No feet declared, because nothing it does with them is walking.
		expect(rig.feet).toBeNull();
	});

	it('the hellhound hangs its front legs off the chest and its back off the hips', async () => {
		const rig = await readRig('hellhound');
		const parent = (name: string): string | null =>
			rig.skeleton.find((bone) => bone.name === name)!.parent;
		expect(parent('frontLegL')).toBe('chest');
		expect(parent('backLegL')).toBe('root');
	});

	it('the dire hellhound hangs its front legs off a scapula, and its hind legs bend at rest', async () => {
		const rig = await readRig('direhound');
		const bone = (name: string) => rig.skeleton.find((candidate) => candidate.name === name)!;
		expect(rig.bones).toHaveLength(30);
		expect(bone('shoulderL').parent).toBe('chest');
		expect(bone('frontLegL').parent).toBe('shoulderL');
		expect(bone('backLegL').parent).toBe('root');
		// The femur runs forward and the tibia back: the Z a dog stands on.
		expect(bone('backShinL').offset[2]).toBeGreaterThan(0);
		expect(bone('backHockL').offset[2]).toBeLessThan(0);
		// A gallop's pairs alternate hind against front, so the measured pair
		// is one of each rather than a left and a right.
		expect(rig.feet).toEqual(['backPawL', 'frontPawL']);
		expect(rig.anchors.jawTip!.bone).toBe('jaw');
		expect(rig.groups.frontL).toEqual(['shoulderL', 'frontLegL', 'frontShinL', 'frontWristL', 'frontPawL']);
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



describe('entities', () => {
	it('lists every one of them in the manifest', async () => {
		const all = await library.index();
		expect(all.map((one) => one.id)).toEqual([
			'wanderer',
			'ghoul',
			'bat',
			'hellhound',
			'direhound',
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
		const one = new AssetLibrary(memoryIO({ 'bad.entity.yaml': source }));
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

describe('the pose functions still agree with the rigs', () => {
	/*
	 * A pose function is written against one rig. `stridePose` names `hipL`
	 * and `shinR` outright and its arcs were solved against a leg of a
	 * particular length; `flyPose` walks a wing outboard bone by bone. So each
	 * carries a copy of the handful of facts it needs, which keeps it a pure
	 * function of an angle — and a copy can drift from the file it was copied
	 * from. These are the pins.
	 */

	it('the stride is solved against the humanoid rig’s own leg', async () => {
		const rig = await readRig('humanoid');
		expect(LEG_LENGTH).toBeCloseTo(rig.metrics.legLength!, 12);
	});

	it('the stride’s cycles are the ones the wanderer’s entity asks for', async () => {
		const wanderer = await entity('wanderer');
		expect(wanderer.animations.get('walk')!.duration).toBeCloseTo(WALK_PERIOD, 12);
		expect(wanderer.animations.get('run')!.duration).toBeCloseTo(RUN_PERIOD, 12);
	});

	it('the wing beat walks the bones the bat rig groups', async () => {
		const rig = await readRig('bat');
		const posed = flyPose(1.2, 1, 0, {});
		for (const side of ['wingL', 'wingR'] as const) {
			for (const bone of rig.groups[side]!) expect(posed[bone], bone).toBeDefined();
		}
	});

	it('the perch settles onto the height the bat rig hovers at', async () => {
		const rig = await readRig('bat');
		// perchPose drops the root by (perch - hover); the rig states the hover.
		const drop = perchPose(0, {}).root!.pos![1]!;
		expect(rig.metrics.hoverHeight! + drop).toBeGreaterThan(0);
		expect(rig.metrics.hoverHeight! + drop).toBeLessThan(rig.metrics.hoverHeight!);
	});

	it('the trot walks the legs the hellhound rig groups', async () => {
		const rig = await readRig('hellhound');
		const posed = houndRunPose(1.1, 1, 0, {});
		for (const side of ['frontL', 'frontR', 'backL', 'backR'] as const) {
			for (const bone of rig.groups[side]!) expect(posed[bone], bone).toBeDefined();
		}
	});

	it('the hound’s cycle is the one its entity asks for', async () => {
		const hound = await entity('hellhound');
		expect(hound.animations.get('run')!.duration).toBeCloseTo(HOUND_STRIDE_PERIOD, 12);
	});

	it('the gallop is solved on the dire hellhound rig’s own chain', async () => {
		const rig = await readRig('direhound');
		const offset = (name: string): readonly [number, number] => {
			const bone = rig.skeleton.find((candidate) => candidate.name === name)!;
			return [bone.offset[1], bone.offset[2]];
		};
		expect(DIRE_CHAIN.hipHeight).toBeCloseTo(rig.metrics.hipHeight!, 12);
		const pairs: [readonly [number, number], string][] = [
			[DIRE_CHAIN.spineMid, 'spineMid'],
			[DIRE_CHAIN.chest, 'chest'],
			[DIRE_CHAIN.shoulder, 'shoulderL'],
			[DIRE_CHAIN.frontLeg, 'frontLegL'],
			[DIRE_CHAIN.humerus, 'frontShinL'],
			[DIRE_CHAIN.forearm, 'frontWristL'],
			[DIRE_CHAIN.pastern, 'frontPawL'],
			[DIRE_CHAIN.backLeg, 'backLegL'],
			[DIRE_CHAIN.femur, 'backShinL'],
			[DIRE_CHAIN.tibia, 'backHockL'],
			[DIRE_CHAIN.metatarsus, 'backPawL'],
		];
		for (const [copy, bone] of pairs) {
			expect(copy[0], bone).toBeCloseTo(offset(bone)[0], 12);
			expect(copy[1], bone).toBeCloseTo(offset(bone)[1], 12);
		}
	});

	it('the gallop keeps every planted paw on the ground', async () => {
		const rig = await readRig('direhound');
		// Each paw's own phase: hind left at theta, front left half a cycle on.
		const legs = [
			{ paw: 'backPawL', offset: 0 },
			{ paw: 'frontPawL', offset: Math.PI },
		];
		for (const { paw, offset } of legs) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, direRunPose(own - offset, 1, 0, {}));
				// Planted paws sit at the paw's own depth; the front pair may
				// lift a hair early as the leg straightens at push-off.
				expect(world[paw]!.p[1], `${paw} at ${i}/10 of its stance`).toBeGreaterThan(0.06);
				expect(world[paw]!.p[1], `${paw} at ${i}/10 of its stance`).toBeLessThan(0.1);
			}
		}
	});

	it('the gallop carries the dire hellhound forwards, and its entity measures it', async () => {
		const hound = await entity('direhound');
		const run = hound.animations.get('run')!;
		expect(run.duration).toBeCloseTo(DIRE_STRIDE_PERIOD, 12);
		expect(run.contacts).toEqual(DIRE_RUN_CONTACTS);
		const speed = run.speed()!;
		expect(speed.z).toBeGreaterThan(1.5);
		expect(Math.abs(speed.x)).toBeLessThan(0.05);
		// Standing still is still the same function, and goes nowhere — bar the
		// breathing, which shifts its weight a fraction.
		expect(Math.abs(hound.animations.get('idle')!.speed()!.z)).toBeLessThan(0.01);
	});

	it('the dire hellhound rests with its chest and all four paws on the ground', async () => {
		const rig = await readRig('direhound');
		const world = solveWorld(rig.skeleton, direRestPose(0, {}));
		for (const paw of ['frontPawL', 'frontPawR', 'backPawL', 'backPawR']) {
			expect(world[paw]!.p[1], paw).toBeGreaterThan(0.04);
			expect(world[paw]!.p[1], paw).toBeLessThan(0.1);
		}
		// The elbows and hocks lie down too, and the hips have dropped most of
		// the standing height.
		expect(world.frontShinL!.p[1]).toBeLessThan(0.12);
		expect(world.backHockL!.p[1]).toBeLessThan(0.1);
		expect(world.root!.p[1]).toBeLessThan(rig.metrics.hipHeight! * 0.4);
	});

	it('the dire hellhound’s bite reaches into the next hexagon and comes back', async () => {
		const rig = await readRig('direhound');
		const jaws = (u: number) =>
			attachmentPosition(rig.skeleton, direBitePose(u, {}), 'jaw', rig.anchors.jawTip!.at);
		// Neighbouring hexagon centres are 1.73 m apart; the teeth close well
		// past the edge of its own cell and short of the far side of the next.
		expect(jaws(DIRE_BITE_CONTACT)[2]).toBeGreaterThan(1.7);
		expect(jaws(DIRE_BITE_CONTACT)[2]).toBeLessThan(2.4);
		expect(jaws(1)[2]).toBeLessThan(jaws(DIRE_BITE_CONTACT)[2] - 0.5);
		// It lunges from its own cell and lands back in it.
		const start = solveWorld(rig.skeleton, direBitePose(0, {}));
		const end = solveWorld(rig.skeleton, direBitePose(1, {}));
		expect(Math.abs(start.root!.p[2])).toBeLessThan(0.2);
		expect(Math.abs(end.root!.p[2])).toBeLessThan(0.1);
	});

	it('every bone the dire hellhound’s poses write exists on its rig', async () => {
		const rig = await readRig('direhound');
		const poses = [
			direRunPose(0.7, 1, 0.3, {}),
			direRunPose(0, 0, 2, {}),
			direBitePose(0.5, {}),
			direRestPose(1, {}),
		];
		for (const posed of poses) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
		// And the gallop moves every bone of every leg the rig groups.
		const posed = direRunPose(1.1, 1, 0, {});
		for (const side of ['frontL', 'frontR', 'backL', 'backR'] as const) {
			for (const bone of rig.groups[side]!) expect(posed[bone], bone).toBeDefined();
		}
	});

	it('every bone a pose function writes exists on the rig it is for', async () => {
		const rig = await readRig('humanoid');
		const posed = stridePose(0.7, 1, { x: 0, z: 1 }, 0, 0, {});
		for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
	});
});

describe('io', () => {
	it('reports what the backend can do, and refuses what it cannot', async () => {
		const reader = new AssetLibrary(readOnly(memoryIO({ 'a.rig.yaml': 'id: a' })));
		expect(reader.writable).toBe(false);
		await expect(reader.save('a.rig.yaml', 'id: a')).rejects.toThrow(AssetWriteError);
		await expect(reader.save('a.rig.yaml', 'id: a')).rejects.toThrow(/read-only/);

		const writer = new AssetLibrary(memoryIO());
		expect(writer.writable).toBe(true);
	});

	it('will not write a file it could not read back', async () => {
		const library = new AssetLibrary(memoryIO());
		await expect(library.save('bad.rig.yaml', 'a: 1\n\tb: 2')).rejects.toThrow(/tabs may not indent/);
		// And having refused, it wrote nothing.
		await expect(library.rig('bad.rig.yaml')).rejects.toThrow(/no asset at/);
	});

	it('forgets what a save invalidated, all the way down', async () => {
		const scratch = resolvePath(import.meta.dirname, '..', 'dist', 'asset-io-test');
		await rm(scratch, { recursive: true, force: true });

		// A copy of the real tree, so the round trip is over real documents.
		const files = [
			'index.yaml',
			'entities/wanderer.entity.yaml',
			'rigs/humanoid.rig.yaml',
			'meshes/wanderer.mesh.yaml',
		];
		const io = diskIO(scratch);
		for (const file of files) await io.writer!.write(file, await readFile(resolvePath(root, file), 'utf8'));

		const library = new AssetLibrary(io, { poseFunctions });
		const before = await library.rig('rigs/humanoid.rig.yaml');
		expect(before.metrics.hipHeight).toBeCloseTo(0.92, 12);

		// Change the hip height in the rig, and the MESH hung on it must be
		// rebuilt too — which is why a save drops the whole derived side.
		const text = await io.read('rigs/humanoid.rig.yaml');
		await library.save('rigs/humanoid.rig.yaml', text.replace('hipHeight: 0.92', 'hipHeight: 1.05'));

		const after = await library.rig('rigs/humanoid.rig.yaml');
		expect(after).not.toBe(before);
		expect(after.metrics.hipHeight).toBeCloseTo(1.05, 12);
		expect(after.skeleton[0]!.offset[1]).toBeCloseTo(1.05, 12);

		// And it really reached the disk, not just the cache.
		expect(await readFile(resolvePath(scratch, 'rigs/humanoid.rig.yaml'), 'utf8')).toContain(
			'hipHeight: 1.05',
		);

		await library.remove('rigs/humanoid.rig.yaml');
		await expect(library.rig('rigs/humanoid.rig.yaml')).rejects.toThrow();

		await rm(scratch, { recursive: true, force: true });
	});
});
