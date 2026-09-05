/*
 * A prefab: the object half of an entity file.
 *
 * An entity file already said what a thing is MADE of — a rig, a body, some
 * clips, a tree. That is the asset half, and it says nothing about what the
 * thing is when it is standing in the world. The prefab is the other half: a
 * game object, what is attached to it, and what hangs underneath it.
 *
 *     object:
 *       name: wanderer
 *       components:
 *         - { type: actor }
 *       children:
 *         - name: grip
 *           at: [0, 0, 0]
 *
 * Two files would be worse than one. An entity and its prefab can only ever
 * disagree, and there is no such thing as a wanderer's mesh that belongs to a
 * different wanderer — so the object tree lives in the file that already names
 * the rig and the mesh it is made of.
 *
 * ## What a component record is
 *
 * `{ type: item, label: torch }`, and nothing more. This reader does not know
 * what an `item` is and must not: a game adds components the engine has never
 * heard of, and a format that had to be taught each one would be a format the
 * client could not add to. So a record is a `type` and a bag of fields, and a
 * registry hands the bag to whoever claimed the type. The refusal for an
 * unknown type happens at instantiation, where the registry is, and names what
 * WAS registered — which is the only error message worth having.
 *
 * ## What an object is made of
 *
 * Its components, and nothing beside them. A body is a `rig`, a `mesh` and an
 * `animator`; a sword lying in the grass is a `rig`, a `mesh` and an `attach`
 * naming the bone it hangs from. Neither is a KIND of thing — there is no field
 * here that says which, and the difference between them is which records they
 * carry. That is what stops a character being a shape the format has to know
 * about before a game can add a second one.
 *
 * Hanging off a bone is therefore a component too. A sword in a hand is an
 * object under another object, and what makes it follow the hand is `attach`,
 * not a field on the node — which is what keeps the tree from having to know
 * what a rig is.
 *
 * ## What a prefab is not
 *
 * It is not a scene. There are no world positions here and no cross-references
 * between objects: a prefab describes one thing, relative to itself, and where
 * a copy of it stands is decided by whoever asked for the copy. That is what
 * lets the same file be a wanderer in the yard and a wanderer on a bench.
 */

import { NO_ASSETS, type ComponentAssets } from './binding.js';
import { AssetError, Node, type Vec3 } from './document.js';

/** One thing attached to an object: a type, and whatever that type reads. */
export interface ComponentSpec {
	readonly type: string;
	/** The record, minus `type`. Meaningless to the engine, everything to the factory. */
	readonly fields: Node;
	/**
	 * What the file references in that record loaded to.
	 *
	 * `NO_ASSETS` as read, because reading is synchronous and fetching is not.
	 * The library replaces it while it loads an entity — see binding.ts.
	 */
	readonly assets: ComponentAssets;
}

/** One object in a prefab, and everything under it. */
export interface PrefabNode {
	readonly name: string;
	/** Metres, in the parent's space. */
	readonly at: Vec3;
	/** Euler XYZ, in the parent's space. */
	readonly euler: Vec3;
	readonly components: readonly ComponentSpec[];
	readonly children: readonly PrefabNode[];
}

const NODE_KEYS = ['name', 'at', 'euler', 'components', 'children'] as const;

const ZERO: Vec3 = [0, 0, 0];

/**
 * Read one object and its subtree.
 *
 * `fallbackName` is what the root is called when the file does not say — an
 * entity's own id, which is the name anything looking for it would guess.
 */
export function readPrefabNode(node: Node, fallbackName: string): PrefabNode {
	node.only(...NODE_KEYS);

	const components: ComponentSpec[] = [];
	for (const entry of node.get('components').listOrEmpty()) {
		const type = entry.need('type').text();
		components.push({ type, fields: entry, assets: NO_ASSETS });
	}

	const children: PrefabNode[] = [];
	for (const [index, child] of node.get('children').listOrEmpty().entries()) {
		children.push(readPrefabNode(child, `child ${index}`));
	}

	return {
		name: node.get('name').present ? node.need('name').text() : fallbackName,
		at: node.get('at').present ? node.need('at').vec3() : ZERO,
		euler: node.get('euler').present ? node.need('euler').vec3() : ZERO,
		components,
		children,
	};
}

/**
 * Every component type named anywhere in a prefab, in the order they appear.
 *
 * What a loader uses to fail early: a prefab naming a type nobody registered
 * is a prefab that cannot be instantiated, and finding that out when the file
 * is read beats finding it out when something tries to spawn.
 */
export function prefabTypes(node: PrefabNode, into: string[] = []): string[] {
	for (const component of node.components) {
		if (!into.includes(component.type)) into.push(component.type);
	}
	for (const child of node.children) prefabTypes(child, into);
	return into;
}

/** One script a prefab asks for, and what it tries to set on it. */
export interface PrefabScript {
	/** The class name, as the script file exports it. */
	readonly script: string;
	/** The object it sits on, so an error can say where it is. */
	readonly on: string;
	/**
	 * Every field beyond `type` and `script`.
	 *
	 * Names only. What they are worth is the script's business — the engine has
	 * never heard of a parameter either — but whether a script HAS a field by
	 * that name is checkable, and a prefab setting one that was renamed is
	 * otherwise a warning in a console nobody is reading.
	 */
	readonly parameters: readonly string[];
}

/**
 * Every script a prefab asks for, anywhere underneath it.
 *
 * Naming `script` here is the engine naming its own concept, not the engine
 * learning a game's vocabulary. `actor` and `item` are hexdelve's and the
 * engine has never heard of either; a SCRIPT is the engine's answer to how a
 * game object gets behaviour, and `Script` is a `Component` a few directories
 * away.
 *
 * This comment used to claim the opposite, while the line below it hardcoded
 * the string twice. It was written when scripting was a package beside the
 * engine and the boundary looked worth defending; it was not.
 *
 * One entry per USE rather than one per class. The same script on two objects
 * with different parameters is two things worth checking separately, and the
 * object's name is half of a useful error.
 */
export function prefabScripts(node: PrefabNode, into: PrefabScript[] = []): PrefabScript[] {
	for (const component of node.components) {
		if (component.type !== 'script') continue;
		const named = component.fields.get('script').textOr('');
		if (!named) continue;
		into.push({
			script: named,
			on: node.name,
			parameters: Object.keys(component.fields.rest('type', 'script')),
		});
	}
	for (const child of node.children) prefabScripts(child, into);
	return into;
}

/** A prefab with nothing on it: one object, named, with no components. */
export function emptyPrefab(name: string): PrefabNode {
	return { name, at: ZERO, euler: ZERO, components: [], children: [] };
}

/** Thrown when a prefab names a component type nothing has claimed. */
export function unknownComponent(file: string, type: string, known: readonly string[]): AssetError {
	const list = known.length ? [...known].sort().join(', ') : 'nothing';
	return new AssetError(file, 'components', `no component type '${type}'; this build has ${list}`);
}
