/*
 * A system prefab: the things there is exactly one of.
 *
 * A wanderer is spawned when a wanderer is wanted, and there can be two. A
 * character register cannot be either of those things — the whole of what makes
 * it useful is that everything looking for a character looks in the same place.
 * So it is a prefab that is instantiated once, when the client or the editor
 * starts, and never again.
 *
 *     id: game
 *     object:
 *       name: systems
 *       components:
 *         - { type: script, script: scripts/systems/CharacterRegistry.ts }
 *
 * The format is the entity's `object:` section and nothing else, which is the
 * point: a system is not a special kind of thing, it is an ordinary object with
 * ordinary components on it that happens to be spawned once. That means the
 * script attached to one is written the same way as a script attached to a
 * character, and the editor shows it the same way.
 *
 * It differs from an entity in what it does NOT get: no `tags` and no `view`,
 * since a system is not in a catalogue and there is nothing to look at. A file
 * carrying one is refused rather than quietly ignored, since a key on a system
 * is somebody expecting it to do something.
 */

import { Node } from './document.js';
import { readPrefabNode, type PrefabNode } from './prefab.js';

export interface SystemAsset {
	readonly id: string;
	readonly name: string;
	/** What gets spawned, once. */
	readonly prefab: PrefabNode;
}

const SYSTEM_KEYS = ['id', 'name', 'notes', 'object'] as const;

export function loadSystem(source: string, file: string): SystemAsset {
	const root = Node.parse(source, file).only(...SYSTEM_KEYS);
	const id = root.need('id').text();
	return {
		id,
		name: root.get('name').textOr(id),
		prefab: readPrefabNode(root.need('object'), id),
	};
}
