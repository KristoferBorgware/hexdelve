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
 * ## The three of them
 *
 * `actor` and `item` are pure description — a body, and a thing lying in the
 * grass. `script` is the one that matters: it names a class in the client's
 * `scripts/` directory and hands it the record's other fields as parameters, so
 * everything the game DECIDES can move into a file that can be edited without
 * rebuilding anything.
 *
 *     - { type: script, script: Spin, speed: 2 }
 *
 * Every field beyond `type` and `script` is a parameter, which is why this one
 * does not call `only`: the record's shape belongs to the script it names, and
 * a script that does not declare `speed` says so through the host rather than
 * through the reader.
 */

import {
	buildSkeletonView,
	ComponentRegistry,
	type ComponentContext,
	type EntityAsset,
	type Scene,
} from '@hexdelve/engine';

import type { ScriptHost } from '@hexdelve/engine';

import { Actor } from './actor.js';
import { BoneFollow } from './bonefollow.js';
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
	/**
	 * What is being spawned, where a component's defaults come from.
	 *
	 * Absent for a system prefab, which is not an entity — it has no rig, no
	 * mesh and nothing to draw, so a factory that needs one says so by name.
	 */
	readonly entity?: EntityAsset;
	/**
	 * What runs the scripts, and the scene they reach things through.
	 *
	 * Absent when nothing is spawning scripts — a bench previewing a body has
	 * no use for a script host, and a prefab that names one there should say so
	 * rather than quietly do nothing.
	 */
	readonly scripts?: { readonly host: ScriptHost; readonly scene: Scene };
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
 * A behaviour, by the name its file exports it under.
 *
 * The parameters are every other field in the record. They are read as raw
 * values rather than through the `Node` helpers, because a script's fields are
 * the script's to describe — the host checks them against what the class
 * declared and names the ones it does not know.
 */
function scriptFactory(context: ComponentContext): void {
	const { scripts } = extrasOf(context);
	if (!scripts) {
		throw new Error('nothing here runs scripts, and this prefab asks for one');
	}

	const name = context.fields.need('script').text();
	/*
	 * Through the host rather than `addComponent`. Every other component here
	 * is built from data the reader has already loaded; a script is built from
	 * a CLASS, found by name in a bundle compiled separately, which the host
	 * can replace while the game runs. What comes out is an ordinary component
	 * on the object.
	 */
	scripts.host.attach(context.object, name, {
		scene: scripts.scene,
		parameters: context.fields.rest('type', 'script'),
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
	.register('item', itemFactory)
	.register('script', scriptFactory);
