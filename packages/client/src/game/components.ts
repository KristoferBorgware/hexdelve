/*
 * The component types a prefab file may name that are not the engine's own.
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
 * ## Only two of them are here
 *
 * `actor` and `item` are pure description — a body, and a thing lying in the
 * grass — and hexdelve's own vocabulary; the engine has never heard of either.
 * `script` is not: `Script` and `ScriptHost` live IN the engine, so the engine
 * already knows what building one means and registers the type itself — see
 * `engineComponents` in `@hexdelve/engine`. This registry starts from that one
 * rather than repeating it.
 */

import {
	buildSkeletonView,
	engineComponents,
	type ComponentContext,
	type EntityAsset,
	type ScriptSpawnExtras,
} from '@hexdelve/engine';

import { Actor } from './actor.js';
import { BoneFollow } from './bonefollow.js';
import { Item } from './items.js';

/**
 * What a factory is handed beyond the record itself.
 *
 * `scripts` is the engine's own contract for a `script` component — see
 * `ScriptSpawnExtras` — inherited rather than restated, so the two cannot drift
 * apart. `entity` is this package's own addition: where an `actor` or an `item`
 * takes its defaults from, and something only an entity has.
 */
export interface SpawnExtras extends ScriptSpawnExtras {
	/**
	 * What is being spawned, where a component's defaults come from.
	 *
	 * Absent for a system prefab, which is not an entity — it has no rig, no
	 * mesh and nothing to draw, so a factory that needs one says so by name.
	 */
	readonly entity?: EntityAsset;
}

function extrasOf(context: ComponentContext): SpawnExtras {
	return (context.extras as SpawnExtras | undefined) ?? {};
}

/** The entity being spawned, for a component that is a fact about one. */
function entityOf(context: ComponentContext): EntityAsset {
	const { entity } = extrasOf(context);
	if (!entity) {
		throw new Error('this is not an entity, and only an entity has a rig or a mesh to read');
	}
	return entity;
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
	const entity = entityOf(context);
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
	const entity = entityOf(context);
	context.fields.only('type', 'label');

	const bone = entity.attach?.bone ?? 'root';
	context.object.addComponent(Item, {
		label: context.fields.get('label').textOr(entity.id),
		bone,
		model: entity.mesh.model(),
		lift: entity.ground?.lift ?? 0,
		tilt: entity.ground?.tilt ?? 0,
	});

	/*
	 * And what it does when somebody is carrying it: sit on that bone. Added
	 * here rather than named in the prefab because it is not a choice — a prop
	 * declares the bone it belongs to in its own entity file, and a prop that
	 * could be picked up and then not follow the hand would be a prop with a
	 * missing line in it.
	 */
	context.object.attachComponent(new BoneFollow(context.object), { bone });
}

/**
 * Everything this package can build from a prefab.
 *
 * Starts from `engineComponents()`, which already knows what `script` means,
 * and adds the two types that are this game's own vocabulary. One registry,
 * exported rather than constructed per caller, for the reason the pose
 * functions are: two libraries disagreeing about what `item` means is not a
 * state worth being able to reach.
 */
export const components = engineComponents()
	.register('actor', actorFactory)
	.register('item', itemFactory);
