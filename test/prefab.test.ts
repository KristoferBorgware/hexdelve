/*
 * The prefab format, and the boundary it exists to hold.
 *
 * The interesting property is not that a tree of objects comes out. It is that
 * the ENGINE does not know what any of the components are — a prefab record is
 * a `type` and a bag of fields, a registry maps the type to whoever claimed it,
 * and `@hexdelve/engine` never learns what a bat is. Half of what is checked
 * here is that the boundary holds and that crossing it fails by name.
 *
 * The other half is spawn ORDER, which the file order is supposed to mean:
 * components before children, so a factory can reach anything above it and
 * nothing below it.
 */

import { describe, expect, it } from 'vitest';

import {
	Component,
	ComponentRegistry,
	instantiate,
	loadSystem,
	AssetNode,
	readPrefabNode,
	Scene,
	prefabScripts,
	prefabTypes,
	readScene,
	type ComponentContext,
} from '@hexdelve/engine';

import { openLibrary } from './harness/assets.js';

const read = (yaml: string): ReturnType<typeof readPrefabNode> =>
	readPrefabNode(AssetNode.parse(yaml, 'test.yaml'), 'fallback');

/** A component that writes down what it was given and where it landed. */
class Marker extends Component {
	label = '';
	static readonly built: string[] = [];
}

function markerFactory(context: ComponentContext): void {
	const marker = context.object.addComponent(Marker);
	marker.label = context.fields.get('label').textOr(context.object.name);
	Marker.built.push(`${marker.label} under ${context.object.parent?.name ?? 'nothing'}`);
}

function registry(): ComponentRegistry {
	Marker.built.length = 0;
	return new ComponentRegistry().register('marker', markerFactory);
}

describe('reading a prefab', () => {
	it('takes its name from the file, or the fallback', () => {
		expect(read('name: sword').name).toBe('sword');
		expect(read('components: []').name).toBe('fallback');
	});

	it('reads a placement, and defaults it to the origin', () => {
		const placed = read('at: [1, 2, 3]\neuler: [0, pi / 2, 0]');
		expect(placed.at).toEqual([1, 2, 3]);
		expect(placed.euler[1]).toBeCloseTo(Math.PI / 2, 12);
		expect(read('name: x').at).toEqual([0, 0, 0]);
	});

	it('keeps a component’s fields without understanding them', () => {
		const node = read('components:\n  - { type: item, lift: 0.2, label: helm }');
		expect(node.components).toHaveLength(1);
		expect(node.components[0]!.type).toBe('item');
		// The reader never looked inside. The factory will.
		expect(node.components[0]!.fields.need('lift').number()).toBeCloseTo(0.2, 12);
	});

	it('reads a subtree', () => {
		const node = read(
			['name: body', 'children:', '  - name: hand', '    children:', '      - name: sword'].join('\n'),
		);
		expect(node.children[0]!.name).toBe('hand');
		expect(node.children[0]!.children[0]!.name).toBe('sword');
	});

	it('lists every type it names, for a check before anything is spawned', () => {
		const node = read(
			[
				'components:',
				'  - { type: actor }',
				'children:',
				'  - components: [{ type: item }, { type: actor }]',
			].join('\n'),
		);
		expect(prefabTypes(node)).toEqual(['actor', 'item']);
	});

	it('refuses a key nobody defined', () => {
		expect(() => read('name: x\nwibble: 1')).toThrow(/wibble/);
	});
});

describe('instantiating one', () => {
	it('builds components before children, so a factory can see upward', () => {
		const scene = new Scene();
		const node = read(
			[
				'name: body',
				'components: [{ type: marker }]',
				'children:',
				'  - name: hand',
				'    components: [{ type: marker }]',
			].join('\n'),
		);

		instantiate(node, scene, registry());

		expect(Marker.built).toEqual(['body under scene', 'hand under body']);
	});

	it('places each object in its parent’s space', () => {
		const scene = new Scene();
		const node = read(
			[
				'name: body',
				'at: [0, 2, 0]',
				'euler: [0, pi / 2, 0]',
				'children:',
				'  - name: hand',
				'    at: [0, 0, 1]',
			].join('\n'),
		);

		instantiate(node, scene, registry());
		scene.solve();

		// A quarter turn about +Y takes the hand's local +Z onto the world +X,
		// at the body's height — the same composition bones use.
		const hand = scene.find('hand')!;
		expect(hand.world.position[0]).toBeCloseTo(1, 6);
		expect(hand.world.position[1]).toBeCloseTo(2, 6);
	});

	it('makes a separate copy each time', () => {
		const scene = new Scene();
		const node = read('name: tree\ncomponents: [{ type: marker }]');
		const one = instantiate(node, scene, registry());
		const two = instantiate(node, scene, registry());

		expect(one).not.toBe(two);
		expect(one.getComponent(Marker)).not.toBe(two.getComponent(Marker));
		one.transform.setPosition(9, 0, 0);
		scene.solve();
		expect(two.world.position[0]).toBe(0);
	});

	it('renames the root when the caller has a part in mind', () => {
		const scene = new Scene();
		const object = instantiate(read('name: wanderer'), scene, registry(), { name: 'player' });
		expect(object.name).toBe('player');
	});

	it('names what WAS registered when a type is unknown', () => {
		const scene = new Scene();
		expect(() => instantiate(read('components: [{ type: hovercraft }]'), scene, registry())).toThrow(
			/no component type 'hovercraft'; this build has marker/,
		);
	});

	it('blames the file when a factory throws', () => {
		const scene = new Scene();
		const cross = new ComponentRegistry().register('bad', () => {
			throw new Error('nothing to hang it on');
		});
		expect(() =>
			instantiate(read('components: [{ type: bad }]'), scene, cross, { file: 'thing.yaml' }),
		).toThrow(/thing\.yaml: components\.bad: nothing to hang it on/);
	});
});

describe('a system prefab', () => {
	it('is an object and nothing else', () => {
		const system = loadSystem('id: game\nobject:\n  name: systems\n  components: []', 'game.yaml');
		expect(system.id).toBe('game');
		expect(system.prefab.name).toBe('systems');
	});

	it('refuses the keys a system cannot have', () => {
		// A system is not in a catalogue and there is nothing to look at, so the
		// two an entity carries beside its object tree are refused here.
		expect(() => loadSystem('id: game\ntags: [a]\nobject: {}', 'game.yaml')).toThrow(/tags/);
	});

	it('is the one the game ships', async () => {
		const system = await openLibrary().system('systems/game.system.yaml');
		expect(system.id).toBe('game');
		expect(system.prefab.name).toBe('systems');
	});
});

describe('the entities that ship', () => {
	it('gives every one of them a body to draw, and bones where it is posed', async () => {
		const library = openLibrary();
		for (const entity of await library.index()) {
			const types = prefabTypes(entity.prefab);
			expect(types, entity.id).toContain('mesh');
			// Bones only where something poses or hangs off them. The ground has
			// a mesh and no rig, which is what an entity that is not a creature
			// looks like — and the reason this is two rules rather than one.
			const posed = types.includes('animator') || types.includes('attach');
			if (posed) expect(types, entity.id).toContain('rig');
		}
	});

	it('gives a thing that can be worn an item, and a thing that is posed neither', async () => {
		const library = openLibrary();
		for (const entity of await library.index()) {
			const types = prefabTypes(entity.prefab);
			// The two shapes, stated as what they carry rather than as a label
			// on the file: one is worn and picked up, the other is animated.
			expect(types.includes('item'), entity.id).toBe(types.includes('attach'));
			expect(types.includes('attach') && types.includes('animator'), entity.id).toBe(false);
		}
	});

	it('makes every animated thing something that can be hit, and nothing else', async () => {
		const library = openLibrary();
		for (const entity of await library.index()) {
			const named = prefabScripts(entity.prefab).map((use) => use.script);
			// A prop is a thing lying in the grass and the ground is the grass.
			// Giving either hit points would put it in the register of
			// characters, where everything looking for something to hit would
			// find it — so it is `Character` that is asked about rather than any
			// script at all, since the ground carries one and is not a creature.
			const animated = prefabTypes(entity.prefab).includes('animator');
			expect(named.includes('Character'), entity.id).toBe(animated);
		}
	});

	it('names an entity’s object after the entity when the file does not', async () => {
		const wanderer = await openLibrary().entity('entities/wanderer.entity.yaml');
		expect(wanderer.prefab.name).toBe('wanderer');
	});

	it('gives a file with no object section one anyway, so everything can spawn', async () => {
		const library = openLibrary();
		for (const entity of await library.index()) {
			expect(entity.prefab, entity.id).not.toBeNull();
		}
	});
});

describe('scenes', () => {
	it('reads a scene as roots that are entities or objects written out', async () => {
		const town = await openLibrary().scene('scenes/town.scene.yaml');
		expect(town.id).toBe('town');
		// The ground first, because everything else stands on it.
		expect(town.objects[0]!.entity?.id).toBe('terrain');
		// And two of them are named for the part they play rather than for what
		// they are: a `wanderer2` is the `player` in this world.
		expect(town.objects.map((one) => one.name)).toContain('player');
		expect(town.objects.map((one) => one.name)).toContain('bat');
	});

	it('places an entity where the scene says, not where the entity does', async () => {
		const town = await openLibrary().scene('scenes/town.scene.yaml');
		const player = town.objects.find((one) => one.name === 'player')!;
		expect(player.entity!.id).toBe('wanderer2');
		expect(player.at).toEqual([0, 0, -5.4]);
		// The entity's own tree is untouched: where a copy stands belongs to
		// whoever asked for the copy.
		expect(player.prefab).toBe(player.entity!.prefab);
	});

	it('reads an object written out in place, exactly as an entity file writes one', () => {
		const source = [
			'id: bare',
			'objects:',
			'  - name: campfire',
			'    at: [2, 0, 1]',
			'    components:',
			'      - { type: script, script: Spin, speed: 2 }',
		].join('\n');
		const scene = readScene(source, 'bare.scene.yaml');
		const only = scene.objects[0]!;
		expect(only.entity).toBeNull();
		expect(only.at).toEqual([2, 0, 1]);
		expect(only.prefab!.components.map((one) => one.type)).toEqual(['script']);
	});

	it('refuses an object that is both an entity and a body of its own', () => {
		const source = [
			'id: bad',
			'objects:',
			'  - entity: ../entities/bat.entity.yaml',
			'    components: []',
		].join('\n');
		expect(() => readScene(source, 'bad.scene.yaml')).toThrow(/either names an entity or/);
	});
});
