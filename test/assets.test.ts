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
 * The files LOAD, and to the shapes the game expects: twelve entities, six
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
	entityAnimations,
	entityAttachment,
	entityBlendTrees,
	entityMesh,
	entityRig,
	loadRig,
	AssetWriteError,
	measureGroundSpeed,
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
	HUMANOID_CHAIN,
	SCRAMBLE_CONTACTS,
	SCRAMBLE_PERIOD,
	scramblePose,
	SHAMBLE_CONTACTS,
	SHAMBLE_PERIOD,
	shamblePose,
	SHUFFLE_CONTACTS,
	SHUFFLE_PERIOD,
	shufflePose,
	SPIDER_CHAIN,
	SPIDER_RUN_CONTACTS,
	SPIDER_RUN_PERIOD,
	SPIDER_TIP,
	SPIDER_TIPS,
	SPIT_AT,
	spiderRunPose,
	spiderSpitPose,
	STOMP_CONTACTS,
	STOMP_PERIOD,
	SMASH_HIT,
	SWIPE_HIT,
	POKE_HIT,
	TROLL_CHAIN,
	TROLL_SOLE,
	trollStompPose,
	trollSmashPose,
	trollSwipePose,
	trollPokePose,
	trollSleepPose,
	HOUND_CHAIN,
	HOUND_RUN_CONTACTS,
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

/**
 * The real tree with one file laid over it.
 *
 * What a test checking a refusal wants: a document written here, and the rigs
 * and meshes it points at read from the tree that already has them.
 */
function withFile(path: string, text: string): AssetLibrary {
	const disk = diskIO(root);
	return new AssetLibrary(
		readOnly({ ...disk, read: (at) => (at === path ? Promise.resolve(text) : disk.read(at)) }),
		{ poseFunctions },
	);
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

	it('the spider radiates eight legs of three segments and a tip from one body', async () => {
		const rig = await readRig('spider');
		expect(rig.bones).toHaveLength(37);
		const bone = (name: string) => rig.skeleton.find((candidate) => candidate.name === name)!;
		for (const n of [1, 2, 3, 4]) {
			for (const side of ['L', 'R']) {
				expect(bone(`coxa${n}${side}`).parent).toBe('root');
				expect(bone(`tibia${n}${side}`).parent).toBe(`coxa${n}${side}`);
				expect(bone(`tarsus${n}${side}`).parent).toBe(`tibia${n}${side}`);
				expect(bone(`tip${n}${side}`).parent).toBe(`tarsus${n}${side}`);
				// The knee is above the body and the tip below it.
				expect(bone(`tibia${n}${side}`).offset[1]).toBeGreaterThan(0);
				expect(bone(`tip${n}${side}`).offset[1]).toBeLessThan(0);
			}
			// The right side is the left with x negated.
			expect(bone(`tibia${n}R`).offset[0]).toBeCloseTo(-bone(`tibia${n}L`).offset[0], 12);
		}
		expect(rig.feet).toEqual(['tip1L', 'tip1R']);
		expect(rig.anchors.spit!.bone).toBe('head');
		expect(rig.groups.leg3R).toEqual(['coxa3R', 'tibia3R', 'tarsus3R', 'tip3R']);
	});

	it('the troll is a humanoid with clavicles and a jaw, two and a half times the height', async () => {
		const rig = await readRig('troll');
		expect(rig.bones).toHaveLength(20);
		const bone = (name: string) => rig.skeleton.find((candidate) => candidate.name === name)!;
		expect(bone('jaw').parent).toBe('head');
		expect(bone('shoulderL').parent).toBe('chest');
		expect(bone('armL').parent).toBe('shoulderL');
		expect(bone('armR').parent).toBe('shoulderR');
		// The clavicle runs out to the shoulder joint, and the right is the left mirrored.
		expect(bone('armL').offset[0]).toBeGreaterThan(0);
		expect(bone('armR').offset[0]).toBeCloseTo(-bone('armL').offset[0], 12);
		expect(bone('shoulderR').offset[0]).toBeCloseTo(-bone('shoulderL').offset[0], 12);
		expect(rig.metrics.hipHeight).toBeGreaterThan(2.4 * 0.92);
		expect(rig.feet).toEqual(['footL', 'footR']);
		expect(rig.anchors.grip!.bone).toBe('handR');
		expect(rig.groups.armR).toEqual(['shoulderR', 'armR', 'forearmR', 'handR']);
		expect(rig.masks.upperBody!.jaw).toBe(1);
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
			'wanderer2',
			'ghoul',
			'bat',
			'hellhound',
			'direhound',
			'zombie',
			'spider',
			'troll',
			'helmet',
			'sword',
			'shield',
		]);
	});

	it('gives the second wanderer the first one’s rig and every one of his animations', async () => {
		const wanderer = await entity('wanderer');
		const second = await entity('wanderer2');
		expect(entityRig(second)).toBe(entityRig(wanderer));
		expect(entityMesh(second)).not.toBe(entityMesh(wanderer));
		expect([...entityAnimations(second).keys()]).toEqual([...entityAnimations(wanderer).keys()]);
		for (const [name, animation] of entityAnimations(wanderer)) {
			const twin = entityAnimations(second).get(name)!;
			expect(twin.duration, name).toBeCloseTo(animation.duration, 12);
			expect(twin.clip === null, name).toBe(animation.clip === null);
		}
		expect(entityBlendTrees(second).get('locomotion')).toBeDefined();
		// The props attach to the rig's bones, so they fit him as they fit the wanderer.
		for (const prop of ['helmet', 'sword', 'shield']) {
			const worn = await entity(prop);
			expect(entityRig(worn), prop).toBe(entityRig(second));
		}
	});

	it('gives the wanderer and the ghoul the same rig, and nothing else', async () => {
		const wanderer = await entity('wanderer');
		const ghoul = await entity('ghoul');
		expect(entityRig(ghoul)).toBe(entityRig(wanderer));
		expect(entityMesh(ghoul)).not.toBe(entityMesh(wanderer));
		// Its gait and its strike are its own: none of the wanderer's clips,
		// and a tree over its own two states.
		expect([...entityAnimations(ghoul).keys()]).toEqual(['idle', 'walk', 'run', 'leap']);
		const walk = entityAnimations(ghoul).get('walk')!.clip;
		expect(walk).not.toBeNull();
		expect(walk!.name).not.toBe(entityAnimations(wanderer).get('walk')!.clip?.name);
		expect(entityAnimations(ghoul).get('leap')!.clip).not.toBeNull();
		expect([...entityBlendTrees(ghoul).keys()]).toEqual(['locomotion']);
		expect(entityBlendTrees(ghoul).get('locomotion')!.id).toBe('shamble');
	});

	it('gives the zombie the humanoid rig, a shuffle, and an overhead slash', async () => {
		const wanderer = await entity('wanderer');
		const zombie = await entity('zombie');
		expect(entityRig(zombie)).toBe(entityRig(wanderer));
		expect([...entityAnimations(zombie).keys()]).toEqual(['idle', 'walk', 'slash']);
		expect(entityAnimations(zombie).get('walk')!.clip).toBeNull();
		expect(entityBlendTrees(zombie).get('locomotion')!.id).toBe('shuffle');

		const slash = entityAnimations(zombie).get('slash')!;
		const clip = slash.clip!;
		expect(clip.loop).toBe('hold');
		const blow = clip.events.find((event) => event.name === 'slash')!;
		expect(blow).toBeDefined();
		const world = (t: number) => solveWorld(entityRig(zombie)!.skeleton, slash.sample(t, {}));
		// Both arms up over the head at the top of the wind-up, both hands
		// down and out in front at the blow, a lunge forward and back.
		const reared = world(0.45);
		for (const hand of ['handL', 'handR']) expect(reared[hand]!.p[1], hand).toBeGreaterThan(reared.head!.p[1]);
		const struck = world(blow.t);
		for (const hand of ['handL', 'handR']) {
			expect(struck[hand]!.p[1], hand).toBeLessThan(struck.chest!.p[1]);
			expect(struck[hand]!.p[2], hand).toBeGreaterThan(1.0);
		}
		expect(struck.root!.p[2]).toBeGreaterThan(0.4);
		expect(Math.abs(world(0).root!.p[2])).toBeLessThan(0.05);
		expect(Math.abs(world(clip.duration).root!.p[2])).toBeLessThan(0.05);
		// Soles on the ground where it stands, and the leading foot planted
		// through the blow.
		for (const t of [0, 0.45, clip.duration]) {
			for (const foot of ['footL', 'footR']) {
				expect(world(t)[foot]!.p[1], `${foot} at ${t}s`).toBeGreaterThan(0.07);
				expect(world(t)[foot]!.p[1], `${foot} at ${t}s`).toBeLessThan(0.13);
			}
		}
		expect(struck.footL!.p[1]).toBeGreaterThan(0.07);
		expect(struck.footL!.p[1]).toBeLessThan(0.13);
	});

	it('the ghoul’s leap lands in the next hexagon, strikes there, and comes back', async () => {
		const ghoul = await entity('ghoul');
		const leap = entityAnimations(ghoul).get('leap')!;
		const clip = leap.clip!;
		expect(clip.loop).toBe('hold');
		const strike = clip.events.find((event) => event.name === 'strike')!;
		expect(strike).toBeDefined();
		const rootAt = (t: number) => {
			const pose = leap.sample(t, {});
			return pose.root!.pos!;
		};
		// A metre forward at the strike, back in its own cell at the end.
		expect(rootAt(strike.t)[2]).toBeGreaterThan(0.8);
		expect(rootAt(strike.t)[2]).toBeLessThan(1.2);
		expect(Math.abs(rootAt(0)[2])).toBeLessThan(0.05);
		expect(Math.abs(rootAt(clip.duration)[2])).toBeLessThan(0.05);
		// And the soles are on the ground at every key that stands on them.
		for (const t of [0, 0.3, strike.t, 0.72, clip.duration]) {
			const world = solveWorld(entityRig(ghoul)!.skeleton, leap.sample(t, {}));
			for (const foot of ['footL', 'footR']) {
				expect(world[foot]!.p[1], `${foot} at ${t}s`).toBeGreaterThan(0.06);
				expect(world[foot]!.p[1], `${foot} at ${t}s`).toBeLessThan(0.12);
			}
		}
		// It lands on all fours: at the strike and through the rake the palms
		// are on the ground too, a metre forward.
		for (const t of [strike.t, 0.72]) {
			const world = solveWorld(entityRig(ghoul)!.skeleton, leap.sample(t, {}));
			for (const hand of ['handL', 'handR']) {
				expect(world[hand]!.p[1], `${hand} at ${t}s`).toBeGreaterThan(0.03);
				expect(world[hand]!.p[1], `${hand} at ${t}s`).toBeLessThan(0.08);
				expect(world[hand]!.p[2], `${hand} at ${t}s`).toBeGreaterThan(1.1);
			}
		}
	});

	it('gives a prop a bone to hang from, and nothing to pose', async () => {
		const helmet = await entity('helmet');
		// It borrows the humanoid's bones to name one, and has no animator: a
		// helmet is worn rather than posed, and that is the whole difference.
		expect(entityRig(helmet)!.id).toBe('humanoid');
		expect(entityAnimations(helmet).size).toBe(0);
		expect(entityAttachment(helmet)!.bone).toBe('head');
		expect(entityAttachment(helmet)!.lift).toBeCloseTo(0.2, 12);
	});

	it('refuses a bone the rig in scope does not have', async () => {
		const at = 'entities/bad.entity.yaml';
		const source = [
			'id: bad',
			'object:',
			'  components:',
			'    - { type: rig, rig: ../rigs/humanoid.rig.yaml }',
			'    - { type: attach, bone: elbow }',
		].join('\n');
		await expect(withFile(at, source).entity(at)).rejects.toThrow(/no bone called 'elbow'/);
	});

	it('refuses a mesh with no rig in scope to hang it on', async () => {
		const at = 'entities/bad.entity.yaml';
		const source = [
			'id: bad',
			'object:',
			'  components:',
			'    - { type: mesh, mesh: ../meshes/helmet.mesh.yaml }',
		].join('\n');
		await expect(withFile(at, source).entity(at)).rejects.toThrow(/needs a rig/);
	});
});

describe('animations', () => {
	it("measures the walk and the run off the wanderer's own feet", async () => {
		const wanderer = await entity('wanderer');
		const walk = entityAnimations(wanderer).get('walk')!;
		const run = entityAnimations(wanderer).get('run')!;
		expect(walk.speed()!.z).toBeGreaterThan(0.5);
		expect(run.speed()!.z).toBeGreaterThan(walk.speed()!.z);
	});

	it('carries a blend tree whose thresholds are those measurements', async () => {
		const wanderer = await entity('wanderer');
		const locomotion = entityBlendTrees(wanderer).get('locomotion')!;
		const speed = locomotion.parameters.find((one) => one.name === 'speed')!;
		expect(speed.unit).toBe('m/s');
		expect(speed.calibrated).toBe(true);
		expect(speed.max).toBeCloseTo(entityAnimations(wanderer).get('run')!.speed()!.z, 9);

		// A tree owns a playhead, so two subjects must never share one.
		expect(locomotion.tree()).not.toBe(locomotion.tree());
	});

	it('holds the tree in phase at a blend of walk and run', async () => {
		const wanderer = await entity('wanderer');
		const tree = entityBlendTrees(wanderer).get('locomotion')!.tree();
		const walk = entityAnimations(wanderer).get('walk')!.speed()!.z;
		const run = entityAnimations(wanderer).get('run')!.speed()!.z;

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
		expect(entityAnimations(wanderer).get('walk')!.duration).toBeCloseTo(WALK_PERIOD, 12);
		expect(entityAnimations(wanderer).get('run')!.duration).toBeCloseTo(RUN_PERIOD, 12);
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
		expect(entityAnimations(hound).get('run')!.duration).toBeCloseTo(HOUND_STRIDE_PERIOD, 12);
	});

	it('the trot is solved on the hellhound rig’s own chain', async () => {
		const rig = await readRig('hellhound');
		const offset = (name: string): readonly [number, number] => {
			const bone = rig.skeleton.find((candidate) => candidate.name === name)!;
			return [bone.offset[1], bone.offset[2]];
		};
		expect(HOUND_CHAIN.hipHeight).toBeCloseTo(rig.metrics.hipHeight!, 12);
		const pairs: [readonly [number, number], string][] = [
			[HOUND_CHAIN.spineMid, 'spineMid'],
			[HOUND_CHAIN.chest, 'chest'],
			[HOUND_CHAIN.frontLeg, 'frontLegL'],
			[HOUND_CHAIN.backLeg, 'backLegL'],
			[HOUND_CHAIN.upper, 'frontShinL'],
			[HOUND_CHAIN.lower, 'frontPawL'],
		];
		for (const [copy, bone] of pairs) {
			expect(copy[0], bone).toBeCloseTo(offset(bone)[0], 12);
			expect(copy[1], bone).toBeCloseTo(offset(bone)[1], 12);
		}
		// The hind pair carries the same two lengths as the front pair.
		expect(HOUND_CHAIN.upper[0]).toBeCloseTo(offset('backShinL')[0], 12);
		expect(HOUND_CHAIN.lower[0]).toBeCloseTo(offset('backPawL')[0], 12);
	});

	it('the trot stands the hound on all four paws', async () => {
		const rig = await readRig('hellhound');
		const tips = new Map(rig.tips.map((tip) => [tip.bone, tip.to[1]]));
		const world = solveWorld(rig.skeleton, houndRunPose(0, 0, 0, {}));
		for (const paw of ['frontPawL', 'frontPawR', 'backPawL', 'backPawR']) {
			// The paw's tip is what touches, so the bone sits its own depth above.
			const tip = world[paw]!.p[1] + tips.get(paw)!;
			expect(tip, `${paw} standing`).toBeGreaterThan(-0.005);
			expect(tip, `${paw} standing`).toBeLessThan(0.005);
		}
	});

	it('the trot keeps every planted paw on the ground', async () => {
		const rig = await readRig('hellhound');
		const tips = new Map(rig.tips.map((tip) => [tip.bone, tip.to[1]]));
		// Each paw's own phase: the left hind leads, the left front is the
		// other diagonal and so runs half a cycle behind it.
		for (const { paw, offset } of [
			{ paw: 'backPawL', offset: 0 },
			{ paw: 'frontPawL', offset: Math.PI },
		]) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, houndRunPose(own - offset, 1, 0, {}));
				const tip = world[paw]!.p[1] + tips.get(paw)!;
				expect(tip, `${paw} at ${i}/10 of its stance`).toBeGreaterThan(-0.005);
				expect(tip, `${paw} at ${i}/10 of its stance`).toBeLessThan(0.005);
			}
		}
	});

	it('the trot carries the hellhound forwards, in proportion to its stride', async () => {
		const rig = await readRig('hellhound');
		const speedAt = (amp: number): number =>
			measureGroundSpeed(
				rig.skeleton,
				(phase, out) => houndRunPose(phase * Math.PI * 2, amp, 0, out),
				HOUND_STRIDE_PERIOD,
				{ feet: rig.feet!, contactPhase: HOUND_RUN_CONTACTS[0] },
			).z;

		const full = speedAt(1);
		expect(full).toBeGreaterThan(1);
		// A paw planted on `groundPath` travels its whole stride at a constant
		// rate, so the speed is the stride over the stance and nothing else —
		// which is what makes a throttle mean what it says. It is proportional
		// to within a part in ten thousand rather than exactly, and the
		// remainder is the knees: splayed a twentieth of a radian to stand the
		// paws under the shoulders, which tips each leg out of the plane the
		// solve works in and lands a paw a third of a millimetre off target.
		for (const amp of [0.25, 0.5, 0.75]) {
			expect(Math.abs(speedAt(amp) / (full * amp) - 1), `amp ${amp}`).toBeLessThan(2e-4);
		}
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
		const run = entityAnimations(hound).get('run')!;
		expect(run.duration).toBeCloseTo(DIRE_STRIDE_PERIOD, 12);
		expect(run.contacts).toEqual(DIRE_RUN_CONTACTS);
		const speed = run.speed()!;
		expect(speed.z).toBeGreaterThan(1.5);
		expect(Math.abs(speed.x)).toBeLessThan(0.05);
		// Standing still is still the same function, and goes nowhere — bar the
		// breathing, which shifts its weight a fraction.
		expect(Math.abs(entityAnimations(hound).get('idle')!.speed()!.z)).toBeLessThan(0.01);
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
		// And every paw lies flat, toes forward: the tip of each paw is on the
		// ground and ahead of the paw bone rather than above it.
		const pose = direRestPose(0, {});
		for (const tip of rig.tips) {
			if (!tip.bone.includes('Paw')) continue;
			const toes = attachmentPosition(rig.skeleton, pose, tip.bone, tip.to, world);
			expect(Math.abs(toes[1]), `${tip.bone} toes on the ground`).toBeLessThan(0.03);
			expect(toes[2] - world[tip.bone]!.p[2], `${tip.bone} toes forward`).toBeGreaterThan(0.1);
		}
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

	it('the chain the ghoul and the zombie are solved on is the humanoid rig’s own', async () => {
		const rig = await readRig('humanoid');
		const offset = (name: string): readonly [number, number] => {
			const bone = rig.skeleton.find((candidate) => candidate.name === name)!;
			return [bone.offset[1], bone.offset[2]];
		};
		expect(HUMANOID_CHAIN.hipHeight).toBeCloseTo(rig.metrics.hipHeight!, 12);
		const hipL = rig.skeleton.find((candidate) => candidate.name === 'hipL')!;
		expect(HUMANOID_CHAIN.hipWidth).toBeCloseTo(hipL.offset[0], 12);
		for (const [copy, bone] of [
			[HUMANOID_CHAIN.hip, 'hipL'],
			[HUMANOID_CHAIN.thigh, 'shinL'],
			[HUMANOID_CHAIN.shin, 'footL'],
			[HUMANOID_CHAIN.spine, 'spine'],
			[HUMANOID_CHAIN.chest, 'chest'],
			[HUMANOID_CHAIN.shoulder, 'armL'],
			[HUMANOID_CHAIN.upperArm, 'forearmL'],
			[HUMANOID_CHAIN.forearm, 'handL'],
		] as const) {
			expect(copy[0], bone).toBeCloseTo(offset(bone)[0], 12);
			expect(copy[1], bone).toBeCloseTo(offset(bone)[1], 12);
		}
	});

	it('the shamble keeps every planted foot on the ground, and carries the ghoul forwards', async () => {
		const rig = await readRig('humanoid');
		for (const { foot, offset } of [
			{ foot: 'footL', offset: 0 },
			{ foot: 'footR', offset: Math.PI },
		]) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, shamblePose(own - offset, 1, 0, {}));
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeGreaterThan(0.07);
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeLessThan(0.11);
			}
		}
		const ghoul = await entity('ghoul');
		const walk = entityAnimations(ghoul).get('walk')!;
		expect(walk.duration).toBeCloseTo(SHAMBLE_PERIOD, 12);
		expect(walk.contacts).toEqual(SHAMBLE_CONTACTS);
		expect(walk.speed()!.z).toBeGreaterThan(0.5);
		expect(Math.abs(walk.speed()!.x)).toBeLessThan(0.05);
		// Every bone it writes is one the rig has.
		for (const posed of [shamblePose(0.7, 1, 0.3, {}), shamblePose(0, 0, 2, {})]) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
	});

	it('the scramble keeps every planted foot and hand on the ground, and outruns the shamble', async () => {
		const rig = await readRig('humanoid');
		// Diagonal pairs: the left foot with the right hand, half a cycle from
		// the right foot with the left hand.
		const limbs = [
			{ bone: 'footL', offset: 0, low: 0.07, high: 0.11 },
			{ bone: 'footR', offset: Math.PI, low: 0.07, high: 0.11 },
			{ bone: 'handR', offset: 0, low: 0.03, high: 0.07 },
			{ bone: 'handL', offset: Math.PI, low: 0.03, high: 0.07 },
		];
		for (const { bone, offset, low, high } of limbs) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, scramblePose(own - offset, 1, 0, {}));
				expect(world[bone]!.p[1], `${bone} at ${i}/10 of its stance`).toBeGreaterThan(low);
				expect(world[bone]!.p[1], `${bone} at ${i}/10 of its stance`).toBeLessThan(high);
			}
		}
		const ghoul = await entity('ghoul');
		const run = entityAnimations(ghoul).get('run')!;
		const walk = entityAnimations(ghoul).get('walk')!;
		expect(run.duration).toBeCloseTo(SCRAMBLE_PERIOD, 12);
		expect(run.contacts).toEqual(SCRAMBLE_CONTACTS);
		expect(run.speed()!.z).toBeGreaterThan(walk.speed()!.z);
		expect(Math.abs(run.speed()!.x)).toBeLessThan(0.05);
		for (const posed of [scramblePose(0.7, 1, 0.3, {}), scramblePose(0, 0, 2, {})]) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
	});

	it('the shuffle drags a foot, keeps both on the ground, and is slower than the shamble', async () => {
		const rig = await readRig('humanoid');
		let dragged = 0;
		let stepped = 0;
		for (const { foot, offset } of [
			{ foot: 'footL', offset: 0 },
			{ foot: 'footR', offset: Math.PI },
		]) {
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, shufflePose(own - offset, 1, 0, {}));
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeGreaterThan(0.08);
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeLessThan(0.12);
			}
			// How high each foot is carried mid-swing: the right barely leaves the ground.
			const lifted = solveWorld(rig.skeleton, shufflePose(-offset, 1, 0, {}))[foot]!.p[1];
			if (foot === 'footL') stepped = lifted;
			else dragged = lifted;
		}
		expect(dragged).toBeLessThan(stepped - 0.03);

		const zombie = await entity('zombie');
		const ghoul = await entity('ghoul');
		const walk = entityAnimations(zombie).get('walk')!;
		expect(walk.duration).toBeCloseTo(SHUFFLE_PERIOD, 12);
		expect(walk.contacts).toEqual(SHUFFLE_CONTACTS);
		expect(walk.speed()!.z).toBeGreaterThan(0.3);
		expect(walk.speed()!.z).toBeLessThan(entityAnimations(ghoul).get('walk')!.speed()!.z);
		expect(Math.abs(walk.speed()!.x)).toBeLessThan(0.05);
		for (const posed of [shufflePose(0.7, 1, 0.3, {}), shufflePose(0, 0, 2, {})]) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
	});

	it('the scuttle is solved on the spider rig’s own legs', async () => {
		const rig = await readRig('spider');
		const offset = (name: string) => rig.skeleton.find((candidate) => candidate.name === name)!.offset;
		expect(SPIDER_CHAIN.bodyHeight).toBeCloseTo(rig.metrics.bodyHeight!, 12);
		SPIDER_CHAIN.legs.forEach((leg, i) => {
			const n = i + 1;
			expect([...offset(`coxa${n}L`)]).toEqual([...leg.coxa]);
			const c = Math.cos(leg.azimuth);
			const s = Math.sin(leg.azimuth);
			const femur = offset(`tibia${n}L`);
			expect(femur[0]).toBeCloseTo(SPIDER_CHAIN.femur.out * c, 9);
			expect(femur[1]).toBeCloseTo(SPIDER_CHAIN.femur.rise, 9);
			expect(femur[2]).toBeCloseTo(SPIDER_CHAIN.femur.out * s, 9);
			const tibia = offset(`tarsus${n}L`);
			expect(tibia[0]).toBeCloseTo(SPIDER_CHAIN.tibia.out * c, 9);
			expect(tibia[1]).toBeCloseTo(-SPIDER_CHAIN.tibia.drop, 9);
			const tarsus = offset(`tip${n}L`);
			expect(tarsus[0]).toBeCloseTo(SPIDER_CHAIN.tarsus.out * c, 9);
			expect(tarsus[1]).toBeCloseTo(-SPIDER_CHAIN.tarsus.drop, 9);
		});
		// The tips stand on the ground at rest, which is what the solve
		// reproduces: standing, every joint is within a whisker of rest.
		const stand = spiderRunPose(0, 0, 0, {});
		for (const bone of Object.keys(stand)) {
			if (!bone.startsWith('coxa') && !bone.startsWith('tibia')) continue;
			for (const value of stand[bone]!.rot!) expect(Math.abs(value), bone).toBeLessThan(0.02);
		}
	});

	it('the scuttle keeps every planted tip on the ground and carries the spider forwards, fast', async () => {
		const rig = await readRig('spider');
		for (const tip of SPIDER_TIPS) {
			// The tip's own set: the left first and third with the right second
			// and fourth run at theta, the rest half a cycle on.
			const n = Number(tip[3]);
			const left = tip.endsWith('L');
			const first = (n === 1 || n === 3) === left;
			const offset = first ? 0 : Math.PI;
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, spiderRunPose(own - offset, 1, 0, {}));
				expect(world[tip]!.p[1], `${tip} at ${i}/10 of its stance`).toBeGreaterThan(SPIDER_TIP - 0.015);
				expect(world[tip]!.p[1], `${tip} at ${i}/10 of its stance`).toBeLessThan(SPIDER_TIP + 0.015);
			}
		}
		const spider = await entity('spider');
		const run = entityAnimations(spider).get('run')!;
		expect(run.duration).toBeCloseTo(SPIDER_RUN_PERIOD, 12);
		expect(run.contacts).toEqual(SPIDER_RUN_CONTACTS);
		expect(run.speed()!.z).toBeGreaterThan(1.5);
		expect(Math.abs(run.speed()!.x)).toBeLessThan(0.05);
		for (const posed of [spiderRunPose(0.7, 1, 0.3, {}), spiderRunPose(0, 0, 2, {}), spiderSpitPose(0.4, {})]) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
	});

	it('the spider rears to spit on its back legs, and settles', async () => {
		const rig = await readRig('spider');
		const at = (u: number) => solveWorld(rig.skeleton, spiderSpitPose(u, {}));
		const reared = at(SPIT_AT);
		// The front pair well off the ground, the back pair still on it, the
		// body pitched up at the front.
		for (const tip of ['tip1L', 'tip1R']) expect(reared[tip]!.p[1], tip).toBeGreaterThan(0.3);
		for (const tip of ['tip3L', 'tip3R', 'tip4L', 'tip4R']) {
			expect(reared[tip]!.p[1], tip).toBeGreaterThan(SPIDER_TIP - 0.02);
			expect(reared[tip]!.p[1], tip).toBeLessThan(SPIDER_TIP + 0.02);
		}
		expect(reared.head!.p[1]).toBeGreaterThan(at(0).head!.p[1] + 0.1);
		for (const u of [0, 1]) {
			for (const tip of SPIDER_TIPS) expect(Math.abs(at(u)[tip]!.p[1] - SPIDER_TIP), `${tip} at ${u}`).toBeLessThan(0.02);
		}
	});

	it('the stomp is solved on the troll rig’s own legs', async () => {
		const rig = await readRig('troll');
		const offset = (name: string) => rig.skeleton.find((candidate) => candidate.name === name)!.offset;
		expect(TROLL_CHAIN.hipHeight).toBeCloseTo(rig.metrics.hipHeight!, 12);
		expect([...offset('hipL')]).toEqual([TROLL_CHAIN.hip[0], TROLL_CHAIN.hip[1], 0]);
		expect([...offset('shinL')]).toEqual([0, -TROLL_CHAIN.thigh, 0]);
		expect([...offset('footL')]).toEqual([0, -TROLL_CHAIN.shin, 0]);
		expect(offset('spine')[1]).toBe(TROLL_CHAIN.spine);
		expect(offset('chest')[1]).toBe(TROLL_CHAIN.chest);
		expect([...offset('shoulderL')]).toEqual([TROLL_CHAIN.shoulder[0], TROLL_CHAIN.shoulder[1], 0]);
		expect(offset('armL')[0]).toBe(TROLL_CHAIN.arm);
		expect(offset('forearmL')[1]).toBe(-TROLL_CHAIN.upperArm);
		expect(offset('handL')[1]).toBe(-TROLL_CHAIN.forearm);
	});

	it('the stomp keeps each planted foot on the ground and carries the troll forwards', async () => {
		const rig = await readRig('troll');
		for (const [foot, offset] of [
			['footL', 0],
			['footR', Math.PI],
		] as const) {
			const restX = offset === 0 ? 0.42 : -0.42;
			for (let i = 0; i <= 10; i++) {
				const own = Math.PI / 2 + (Math.PI * i) / 10;
				const world = solveWorld(rig.skeleton, trollStompPose(own - offset, 1, 0, {}));
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeGreaterThan(TROLL_SOLE - 0.02);
				expect(world[foot]!.p[1], `${foot} at ${i}/10 of its stance`).toBeLessThan(TROLL_SOLE + 0.05);
				// Solved in three dimensions, so the pelvis rolling and turning
				// does not drag the foot sideways.
				expect(world[foot]!.p[0], `${foot} at ${i}/10 of its stance`).toBeCloseTo(restX, 2);
			}
		}
		const troll = await entity('troll');
		const walk = entityAnimations(troll).get('walk')!;
		expect(walk.duration).toBeCloseTo(STOMP_PERIOD, 12);
		expect(walk.contacts).toEqual(STOMP_CONTACTS);
		expect(walk.speed()!.z).toBeGreaterThan(1.5);
		expect(Math.abs(walk.speed()!.x)).toBeLessThan(0.05);
		const idle = entityAnimations(troll).get('idle')!;
		expect(Math.abs(idle.speed()?.z ?? 0)).toBeLessThan(0.05);
	});

	it('the troll’s strikes keep both feet planted and swing the club hand where the strike says', async () => {
		const rig = await readRig('troll');
		const at = (pose: typeof trollSmashPose, u: number) => solveWorld(rig.skeleton, pose(u, {}));
		// The feet: at every key, on the ground where they stand, a heel
		// lifted or a foot mid-step aside.
		for (const pose of [trollSmashPose, trollSwipePose, trollPokePose]) {
			for (const u of [0, 0.3, 0.5, 0.62, 1]) {
				const world = at(pose, u);
				for (const foot of ['footL', 'footR']) {
					expect(world[foot]!.p[1], `${foot} at ${u}`).toBeGreaterThan(TROLL_SOLE - 0.02);
					expect(world[foot]!.p[1], `${foot} at ${u}`).toBeLessThan(TROLL_SOLE + 0.4);
				}
			}
			// Back where it started.
			const stand = solveWorld(rig.skeleton, trollStompPose(0, 0, 0, {}));
			const back = at(pose, 1);
			for (const bone of ['handR', 'handL', 'head', 'footL', 'footR']) {
				for (let axis = 0; axis < 3; axis++) expect(back[bone]!.p[axis], `${bone} axis ${axis}`).toBeCloseTo(stand[bone]!.p[axis], 3);
			}
		}
		// The smash: the fist up behind the head at the windup, then low and
		// well ahead at the blow, the head following it down.
		const windup = at(trollSmashPose, 0.32);
		const smash = at(trollSmashPose, SMASH_HIT);
		expect(windup.handR!.p[1]).toBeGreaterThan(3.4);
		expect(windup.handR!.p[2]).toBeLessThan(0);
		expect(smash.handR!.p[2]).toBeGreaterThan(2);
		expect(smash.handR!.p[1]).toBeLessThan(windup.handR!.p[1] - 1.2);
		expect(smash.head!.p[1]).toBeLessThan(windup.head!.p[1] - 0.5);
		// The swipe: the fist out behind on the right, then ahead, then across
		// on the left, at about the same height throughout.
		const wound = at(trollSwipePose, 0.3);
		const through = at(trollSwipePose, SWIPE_HIT);
		const past = at(trollSwipePose, 0.62);
		expect(wound.handR!.p[2]).toBeLessThan(-1);
		expect(through.handR!.p[2]).toBeGreaterThan(2);
		expect(past.handR!.p[0]).toBeGreaterThan(1);
		expect(Math.abs(past.handR!.p[1] - wound.handR!.p[1])).toBeLessThan(0.8);
		// The poke: the fist driven out ahead, the right foot lunging with it.
		const drawn = at(trollPokePose, 0.3);
		const shoved = at(trollPokePose, POKE_HIT);
		expect(shoved.handR!.p[2]).toBeGreaterThan(drawn.handR!.p[2] + 1.5);
		expect(shoved.footR!.p[2]).toBeGreaterThan(drawn.footR!.p[2] + 0.6);
	});

	it('the troll sleeps on its side, everything on or above the ground', async () => {
		const rig = await readRig('troll');
		const world = solveWorld(rig.skeleton, trollSleepPose(0.5, {}));
		expect(world.root!.p[1]).toBeLessThan(0.8);
		expect(world.head!.p[1]).toBeLessThan(1.6);
		// The head is off to the right and the feet to the left: lying along x.
		expect(world.head!.p[0]).toBeLessThan(-0.4);
		expect(world.footL!.p[0]).toBeGreaterThan(0.8);
		for (const bone of rig.bones) expect(world[bone]!.p[1], bone).toBeGreaterThan(0.05);
		for (const posed of [trollStompPose(0.7, 1, 0.3, {}), trollStompPose(0, 0, 2, {}), trollSmashPose(0.4, {}), trollSwipePose(0.4, {}), trollPokePose(0.4, {}), trollSleepPose(1, {})]) {
			for (const bone of Object.keys(posed)) expect(rig.bones, bone).toContain(bone);
		}
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
		const posed = stridePose(0.7, 1, 0, 0, {});
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
