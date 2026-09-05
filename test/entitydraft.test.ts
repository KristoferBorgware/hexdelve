/*
 * The prefab tree while somebody is editing it.
 *
 * These are the operations behind the entity bench's tree view — add, remove,
 * reparent, reorder — and the reason they are tested apart from the view is
 * that their failures are not visible in one. A move that drops a subtree
 * leaves a tree that still renders; a move that puts an object inside itself
 * leaves one that renders until something walks it, and the walk that finds
 * out is the renderer's.
 */

import { describe, expect, it } from 'vitest';

import { emitYaml, readEntity } from '@hexdelve/engine';
import {
	addChild,
	addComponent,
	canMove,
	draftFromPrefab,
	draftToEmittable,
	emptyNode,
	findNode,
	moveNode,
	newComponent,
	parentOf,
	pathTo,
	removeComponent,
	removeNode,
	renameNode,
	reorderNode,
	setField,
	setTransform,
	subtreeIds,
	type DraftNode,
} from '../packages/editor/src/views/entity/entitydraft.js';

/** A root with two children and a grandchild, named so a failure reads. */
function tree(): DraftNode {
	const grandchild = emptyNode('grip');
	const first = { ...emptyNode('torso'), children: [grandchild] };
	const second = emptyNode('tail');
	return { ...emptyNode('body'), children: [first, second] };
}

const namesOf = (node: DraftNode) => node.children.map((child) => child.name);

describe('a prefab being edited', () => {
	it('finds an object and what it hangs from', () => {
		const root = tree();
		const grip = root.children[0]!.children[0]!;
		expect(findNode(root, grip.id)?.name).toBe('grip');
		expect(parentOf(root, grip.id)?.name).toBe('torso');
		expect(parentOf(root, root.id)).toBeNull();
		expect(pathTo(root, grip.id)).toEqual(['body', 'torso', 'grip']);
	});

	it('leaves the tree it was given alone', () => {
		// A view redraws when it is handed a different object, and something
		// always holds the old one: an undo stack, a memoised row.
		const root = tree();
		const renamed = renameNode(root, root.children[1]!.id, 'stump');
		expect(namesOf(root)).toEqual(['torso', 'tail']);
		expect(namesOf(renamed)).toEqual(['torso', 'stump']);
		expect(renamed).not.toBe(root);
	});

	it('keeps the branches it did not touch', () => {
		// Copying the whole tree on every keystroke would throw away every
		// memoised row in it, so an untouched branch stays the same object.
		const root = tree();
		const next = renameNode(root, root.children[1]!.id, 'stump');
		expect(next.children[0]).toBe(root.children[0]);
	});

	it('adds and removes an object', () => {
		let root = tree();
		root = addChild(root, root.id, emptyNode('head'));
		expect(namesOf(root)).toEqual(['torso', 'tail', 'head']);

		root = removeNode(root, root.children[1]!.id);
		expect(namesOf(root)).toEqual(['torso', 'head']);
	});

	it('takes the whole subtree out with the object', () => {
		const root = tree();
		const torso = root.children[0]!;
		const next = removeNode(root, torso.id);
		expect(findNode(next, torso.children[0]!.id)).toBeNull();
	});

	it('will not remove the root, since a prefab is one object', () => {
		const root = tree();
		expect(removeNode(root, root.id)).toBe(root);
	});

	it('reparents an object with everything under it', () => {
		const root = tree();
		const torso = root.children[0]!;
		const tail = root.children[1]!;

		const next = moveNode(root, torso.id, tail.id);
		expect(namesOf(next)).toEqual(['tail']);
		expect(namesOf(next.children[0]!)).toEqual(['torso']);
		// The grandchild came along.
		expect(pathTo(next, torso.children[0]!.id)).toEqual(['body', 'tail', 'torso', 'grip']);
	});

	/*
	 * The move that has to be refused. A tree containing itself walks forever,
	 * and nothing about the drop that caused it looks wrong at the time.
	 */
	it('refuses to put an object inside itself', () => {
		const root = tree();
		const torso = root.children[0]!;
		const grip = torso.children[0]!;

		expect(canMove(root, torso.id, grip.id)).toBe(false);
		expect(canMove(root, torso.id, torso.id)).toBe(false);
		expect(moveNode(root, torso.id, grip.id)).toBe(root);

		// And the root has nowhere to go.
		expect(canMove(root, root.id, torso.id)).toBe(false);
	});

	it('drops an object at an index among its new siblings', () => {
		const root = tree();
		const tail = root.children[1]!;
		const torso = root.children[0]!;
		const next = moveNode(root, tail.id, torso.id, 0);
		expect(namesOf(next.children[0]!)).toEqual(['tail', 'grip']);
	});

	it('moves an object among its siblings', () => {
		const root = tree();
		expect(namesOf(reorderNode(root, root.children[1]!.id, -1))).toEqual(['tail', 'torso']);
		// And stops at the ends rather than wrapping.
		expect(reorderNode(root, root.children[0]!.id, -1)).toBe(root);
		expect(reorderNode(root, root.children[1]!.id, 1)).toBe(root);
	});

	it('subtreeIds covers the object and everything under it', () => {
		const root = tree();
		expect(subtreeIds(root)).toHaveLength(4);
		expect(subtreeIds(root.children[1]!)).toEqual([root.children[1]!.id]);
	});
});

describe('the components on an object', () => {
	it('adds, sets a field, and removes', () => {
		let root = tree();
		const script = newComponent('script', { script: 'Character' });
		root = addComponent(root, root.id, script);
		expect(root.components).toHaveLength(1);

		root = setField(root, root.id, script.id, 'hp', 20);
		expect(root.components[0]!.fields).toEqual({ script: 'Character', hp: 20 });

		root = removeComponent(root, root.id, script.id);
		expect(root.components).toEqual([]);
	});

	/*
	 * A field set to its own default and a field left out load the same, and
	 * only the second stays right when the default changes. So a control that
	 * clears itself takes the key out rather than writing a value.
	 */
	it('takes a field out when it is set to nothing', () => {
		let root = tree();
		const script = newComponent('script', { script: 'Character', hp: 20 });
		root = addComponent(root, root.id, script);
		root = setField(root, root.id, script.id, 'hp', undefined);
		expect(root.components[0]!.fields).toEqual({ script: 'Character' });
	});
});

describe('what a draft writes', () => {
	it('leaves out the transform the reader would supply anyway', () => {
		expect(draftToEmittable(emptyNode('thing'))).toEqual({ name: 'thing', components: [] });
	});

	it('puts type first on a component, whatever order the fields came in', () => {
		let root = emptyNode('thing');
		root = addComponent(root, root.id, newComponent('script', { hp: 20, script: 'Character' }));
		const written = draftToEmittable(root) as { components: Record<string, unknown>[] };
		expect(Object.keys(written.components[0]!)).toEqual(['type', 'hp', 'script']);
	});

	/*
	 * The round trip that matters: a prefab read off a real file, turned into a
	 * draft, written back and read again is the same prefab. Anything the draft
	 * cannot carry shows up here as a difference.
	 */
	it('round-trips a real prefab through a draft', async () => {
		const { readFile } = await import('node:fs/promises');
		const { resolve } = await import('node:path');
		const path = resolve(import.meta.dirname, '..', 'public', 'assets', 'systems', 'game.system.yaml');

		// A system file is a prefab with children and script components on them,
		// which is the shape the bench exists to edit.
		const source = await readFile(path, 'utf8');
		const before = readEntity(
			source.replace(/^object:/m, 'mesh: ../meshes/wanderer.mesh.yaml\nrig: ../rigs/humanoid.rig.yaml\nobject:'),
			'game.system.yaml',
		);

		const draft = draftFromPrefab(before.prefab);
		const written = emitYaml({ object: draftToEmittable(draft) });
		const after = readEntity(
			`id: game\nmesh: ../meshes/wanderer.mesh.yaml\nrig: ../rigs/humanoid.rig.yaml\n${written}`,
			'again.yaml',
		);

		expect(draftToEmittable(draftFromPrefab(after.prefab))).toEqual(
			draftToEmittable(draftFromPrefab(before.prefab)),
		);
		expect(after.prefab.children.map((one) => one.name)).toEqual(['characters', 'combat']);
	});

	it('sets a transform on one axis and leaves the others', () => {
		const root = setTransform(emptyNode('thing'), '', 'at', 1, 2);
		// An id that names nothing changes nothing.
		expect(root.at).toEqual([0, 0, 0]);

		const thing = emptyNode('thing');
		const moved = setTransform(thing, thing.id, 'at', 1, 2);
		expect(moved.at).toEqual([0, 2, 0]);
		expect(draftToEmittable(moved)).toEqual({ name: 'thing', at: [0, 2, 0], components: [] });
	});
});

/*
 * A save, end to end, without a host to write to.
 *
 * The bench edits one part of a file that says a great deal else — a rig, a
 * mesh, the animations and the blend trees over them. The failure worth
 * pinning is a save that keeps the tree and loses the rest of it, which would
 * leave an entity that still parses and no longer has a body.
 */
describe('saving an edited tree back into its entity file', () => {
	async function wanderer(): Promise<{ source: string; file: string }> {
		const { readFile } = await import('node:fs/promises');
		const { resolve } = await import('node:path');
		const file = 'wanderer.entity.yaml';
		const path = resolve(import.meta.dirname, '..', 'public', 'assets', 'entities', file);
		return { source: await readFile(path, 'utf8'), file };
	}

	it('keeps everything the tree is not', async () => {
		const { writeEntity } = await import('@hexdelve/engine');
		const { source, file } = await wanderer();
		const before = readEntity(source, file);

		// Hang a grip off the wanderer with a script on it, the way somebody
		// building a hierarchy would.
		let draft = draftFromPrefab(before.prefab);
		const grip = emptyNode('grip');
		draft = addChild(draft, draft.id, grip);
		draft = addComponent(draft, grip.id, newComponent('script', { script: 'Spin', speed: 2 }));
		draft = setTransform(draft, grip.id, 'at', 1, 1.2);

		const after = readEntity(writeEntity(before, draftToEmittable(draft)), file);

		// The half of the file the bench never touched.
		expect(after.rig).toBe(before.rig);
		expect(after.mesh).toBe(before.mesh);
		expect(after.blurb).toBe(before.blurb);
		expect(after.animations.map((one) => one.name)).toEqual(
			before.animations.map((one) => one.name),
		);
		expect(after.blendTrees).toEqual(before.blendTrees);

		// And the half it did.
		expect(after.prefab.components.map((one) => one.type)).toEqual(['actor', 'script']);
		expect(after.prefab.children).toHaveLength(1);
		const written = after.prefab.children[0]!;
		expect(written.name).toBe('grip');
		expect(written.at).toEqual([0, 1.2, 0]);
		expect(written.components[0]!.fields.get('script').text()).toBe('Spin');
		expect(written.components[0]!.fields.get('speed').number()).toBe(2);
	});

	it('survives a save that changes nothing', async () => {
		const { writeEntity } = await import('@hexdelve/engine');
		const { source, file } = await wanderer();
		const before = readEntity(source, file);
		const draft = draftFromPrefab(before.prefab);

		const once = writeEntity(before, draftToEmittable(draft));
		const twice = writeEntity(readEntity(once, file), draftToEmittable(draftFromPrefab(readEntity(once, file).prefab)));
		expect(twice).toBe(once);
	});
});
