/*
 * Spawning an entity: its prefab, built with this package's components.
 *
 * Three things have to meet for an object to appear — the prefab that says what
 * it is made of, the registry that knows how to build each of those, and the
 * entity itself, which is where a component reads its defaults. Two lines in
 * every caller, or one here.
 *
 * The entity travels as `extras`, which the engine passes through untouched.
 * That is how `{ type: actor }` can be a bare record and still know which rig
 * to hang: the answer is not in the record, it is the entity the record is
 * inside — and the engine never has to learn what either of those words means.
 */

import { instantiate, type EntityAsset, type GameObject, type Scene } from '@hexdelve/engine';

import { components, type SpawnExtras } from './components.js';

/**
 * Spawn one copy of an entity into a scene.
 *
 * `name` overrides what the prefab calls its root — the yard wants `player`
 * rather than `wanderer`, because what a thing is and what part it is playing
 * are different questions.
 */
export function spawnEntity(
	entity: EntityAsset,
	scene: Scene,
	name?: string,
	parent?: GameObject,
): GameObject {
	const extras: SpawnExtras = { entity };
	return instantiate(entity.prefab, scene, components, {
		extras,
		file: `${entity.id}.entity.yaml`,
		...(name !== undefined ? { name } : {}),
		...(parent !== undefined ? { parent } : {}),
	});
}
