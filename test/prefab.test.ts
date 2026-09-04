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
	prefabTypes,
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

	it('refuses the asset sections a system cannot have', () => {
		expect(() => loadSystem('id: game\nmesh: x.yaml\nobject: {}', 'game.yaml')).toThrow(/mesh/);
	});

	it('is the one the game ships', async () => {
		const system = await openLibrary().system('systems/game.system.yaml');
		expect(system.id).toBe('game');
		expect(system.prefab.name).toBe('systems');
	});
});

describe('the entities that ship', () => {
	it('gives every prop an item and every character a body', async () => {
		const library = openLibrary();
		for (const entity of await library.index()) {
			const wanted = entity.kind === 'prop' ? 'item' : 'actor';
			expect(prefabTypes(entity.prefab), entity.id).toEqual([wanted]);
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
