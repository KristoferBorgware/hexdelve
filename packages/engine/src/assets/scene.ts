/*
 * A scene: everything that is in a world when it starts.
 *
 * An entity file describes one thing. A scene file describes a set of them,
 * and it is the same file with two differences — it has several roots instead
 * of one, and a root may name an ENTITY instead of listing components:
 *
 *   id: town
 *   objects:
 *     - entity: ../entities/terrain.entity.yaml
 *     - entity: ../entities/wanderer2.entity.yaml
 *       name: player
 *       at: [0, 0, -5.4]
 *     - name: campfire
 *       at: [2, 0, 1]
 *       components:
 *         - { type: particles, effect: ../particles/smoke.particles.yaml }
 *
 * So an entity is a partial scene: one object, written out in place. Both
 * kinds of node are read by `readPrefabNode`, which is the point of the format
 * being a superset rather than a second format that resembles the first — a
 * component record means the same thing in both, and there is one reader for
 * it.
 *
 * ## Naming and placing an instance
 *
 * `name`, `at` and `euler` on an entity reference override what the entity
 * file says. That is the whole of what a scene does to an instance: where it
 * stands and what it is called here. Anything else it needs is in the entity,
 * because two files able to say the same thing is two files able to disagree.
 *
 * The yard wants a `wanderer2` called `player`, and what the thing IS and what
 * PART it is playing are different questions — which is why the override
 * exists at all.
 *
 * ## What is not here
 *
 * No systems. The one-of-a-kind objects — whose turn it is, what a blow does,
 * where the characters are — are present in every scene rather than listed by
 * each, so they are the client's to spawn and not a line every scene file has
 * to remember to carry.
 *
 * No cross-references between objects either. A scene says what is in a world
 * and where; what any of them does about each other is a script's business.
 */

import type { EntityAsset } from './entity.js';
import { Node, type Vec3 } from './document.js';
import { readPrefabNode, type PrefabNode } from './prefab.js';

export const SCENE_KEYS = ['id', 'name', 'notes', 'objects', 'spawnable'] as const;

const OBJECT_KEYS = ['entity', 'name', 'at', 'euler', 'components', 'children'] as const;

const ZERO: Vec3 = [0, 0, 0];

/** One root of a scene, as the file says it, before anything is fetched. */
export interface SceneNodeDocument {
	/** The entity to instance, relative to the scene file. Null when written out. */
	readonly entity: string | null;
	/** What to call it here, or null to take the name the object already has. */
	readonly name: string | null;
	readonly at: Vec3;
	readonly euler: Vec3;
	/** The object itself, for a root the scene wrote out. Null for a reference. */
	readonly prefab: PrefabNode | null;
}

export interface SceneDocument {
	readonly id: string;
	readonly name: string;
	readonly objects: readonly SceneNodeDocument[];
	/** Entities loaded and not placed, for a script that spawns one. */
	readonly spawnable: readonly string[];
}

/** One root of a scene, with whatever it referred to loaded. */
export interface SceneObject {
	/** The entity it was instanced from, or null where the scene wrote it out. */
	readonly entity: EntityAsset | null;
	/** What to instantiate. An entity's own tree, or the one written in place. */
	readonly prefab: PrefabNode;
	/** What it is called here. Null takes whatever the object is already named. */
	readonly name: string | null;
	readonly at: Vec3;
	readonly euler: Vec3;
}

export interface SceneAsset {
	readonly id: string;
	readonly name: string;
	readonly objects: readonly SceneObject[];
	/** Loaded for a script to spawn, and not placed. */
	readonly spawnable: readonly EntityAsset[];
}

export function readScene(source: string, file: string): SceneDocument {
	const root = Node.parse(source, file).only(...SCENE_KEYS);
	const id = root.need('id').text();

	const objects = root
		.get('objects')
		.listOrEmpty()
		.map((node, index) => readSceneNode(node, index));

	return {
		id,
		name: root.get('name').textOr(id),
		objects,
		spawnable: root
			.get('spawnable')
			.listOrEmpty()
			.map((entry) => entry.text()),
	};
}

function readSceneNode(node: Node, index: number): SceneNodeDocument {
	node.only(...OBJECT_KEYS);
	const named = node.get('entity');
	const name = node.get('name');

	/*
	 * One or the other, never both. A node that named an entity AND listed
	 * components would be asking for the entity's object and a different one at
	 * the same time, and there is no answer to that worth guessing at.
	 */
	if (named.present && (node.get('components').present || node.get('children').present)) {
		node.fail('an object either names an entity or writes itself out, not both');
	}

	return {
		entity: named.present ? named.text() : null,
		name: name.present ? name.text() : null,
		at: node.get('at').present ? node.need('at').vec3() : ZERO,
		euler: node.get('euler').present ? node.need('euler').vec3() : ZERO,
		prefab: named.present ? null : readPrefabNode(node, name.textOr(`object ${index}`)),
	};
}
