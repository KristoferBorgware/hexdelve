/*
 * The component types a prefab file may name.
 *
 * The engine can read a prefab and walk it; it cannot build an `item`, because
 * it has never heard of one. This is where the game says what its own
 * components are, and it is the only file that has to change when there is a
 * new kind of thing to attach.
 *
 *     components:
 *       - { type: item }
 *
 * A factory reads the record with the same `Node` API every asset file is read
 * with, so a missing field fails by name and line like anything else. What it
 * cannot read from the record it takes off the entity being spawned — a mesh is
 * a mesh, and an `item` on a helmet is the helmet's mesh by definition rather
 * than by a path repeated inside its own file.
 *
 * ## What is not here yet
 *
 * `script`. That is phase three, and it is the one that matters: a script
 * component points at a TypeScript file and everything the game actually
 * DECIDES moves into those. `actor` and `item` below are the two that are
 * pure description — a body, and a thing lying in the grass — and they are here
 * first because they need nothing that does not exist.
 */

import {
	buildSkeletonView,
	ComponentRegistry,
	type ComponentContext,
	type EntityAsset,
} from '@hexdelve/engine';

import { Actor } from './actor.js';
import { Item } from './items.js';

/**
 * What a factory is handed beyond the record itself.
 *
 * The entity is what a component's defaults come from. Everything else a
 * behaviour needs — the world it stands on, who to tell when it hits something
 * — is not here, because none of it belongs to a prefab: those arrive with the
 * scripts, through the systems the scripts talk to.
 */
export interface SpawnExtras {
	readonly entity: EntityAsset;
}

function extrasOf(context: ComponentContext): SpawnExtras {
	const extras = context.extras as SpawnExtras | undefined;
	if (!extras?.entity) throw new Error('spawned without an entity to read defaults from');
	return extras;
}

/**
 * A body: a rig, the prisms hung on it, and the pose it is in this frame.
 *
 * Takes everything off the entity, so the record is bare. That is not a gap in
 * the format — an actor on a wanderer is the wanderer's rig and the wanderer's
 * mesh, and a file that let those be given separately would be a file that
 * could put a bat's body on a man's bones.
 */
function actorFactory(context: ComponentContext): void {
	const { entity } = extrasOf(context);
	const rig = entity.rig;
	if (!rig) throw new Error(`'${entity.id}' is a ${entity.kind} and has no rig to be an actor on`);

	context.object.addComponent(Actor, {
		skeleton: rig.skeleton,
		model: entity.mesh.model(),
		skeletonView: buildSkeletonView(rig.skeleton, rig.tips),
		x: 0,
		y: 0,
		z: 0,
	});
}

/**
 * A thing that can be picked up.
 *
 * The bone it hangs from and the two numbers that put it down in the grass come
 * off the entity's own `attach` and `ground`, which is where a prop already
 * declared them. The record may override the label, and nothing else — there is
 * no second place to say how a helmet lies.
 */
function itemFactory(context: ComponentContext): void {
	const { entity } = extrasOf(context);
	context.fields.only('type', 'label');

	context.object.addComponent(Item, {
		label: context.fields.get('label').textOr(entity.id),
		bone: entity.attach?.bone ?? 'root',
		model: entity.mesh.model(),
		lift: entity.ground?.lift ?? 0,
		tilt: entity.ground?.tilt ?? 0,
	});
}

/**
 * Everything this package can build from a prefab.
 *
 * One registry, exported rather than constructed per caller, for the reason the
 * pose functions are: two libraries disagreeing about what `item` means is not
 * a state worth being able to reach.
 */
export const components = new ComponentRegistry()
	.register('actor', actorFactory)
	.register('item', itemFactory);
