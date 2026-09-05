/*
 * Building the components that are facts about drawing and posing.
 *
 * `rig`, `mesh`, `animator`, `attach`, `footIK` and `particles` are the
 * engine's own vocabulary, in the way `item` is a game's: each is about how a
 * thing is drawn or how it is posed, which is what an engine is for. So the
 * engine registers them itself rather than leaving every game to repeat the
 * same lines and to disagree about one of them.
 *
 * Each factory takes what its record named off `context.assets` rather than
 * reading the path again. The library resolved and fetched every one of them
 * while it loaded the entity — see assets/binding.ts — because a fetch is
 * asynchronous and spawning is not.
 */

import { readAttachment, PARTICLES_COMPONENT_KEYS } from '../../assets/entity.js';
import type { ComponentContext, ComponentRegistry } from '../../assets/instantiate.js';
import { Animator } from './Animator.js';
import { Attach } from './Attach.js';
import { FootIK } from './FootIK.js';
import { MeshRenderer } from './MeshRenderer.js';
import { Particles } from './Particles.js';
import { Rig } from './Rig.js';

/** The bones, and the pose they are in. */
function rigFactory(context: ComponentContext): void {
	const { rig } = context.assets;
	if (!rig) throw new Error('a rig component has no rig loaded for it');
	context.object.addComponent(Rig, rig);
}

/** The prisms, hung on whatever rig is in scope. */
function meshFactory(context: ComponentContext): void {
	// A record with no path is an empty mesh, for an object whose prisms a
	// script works out — see `MeshRenderer.model`.
	context.object.addComponent(MeshRenderer, context.assets.mesh);
}

/** The animations and the trees over them. */
function animatorFactory(context: ComponentContext): void {
	const { animations, blendTrees } = context.assets;
	context.object.addComponent(Animator, animations, blendTrees);
}

/**
 * Feet planted on whatever is underneath them.
 *
 * The record carries the two numbers and nothing else. What the ground IS is
 * wired in by whoever spawned the thing — see `FootIK.groundAt` — because a
 * terrace is not something an entity file knows.
 */
function footIKFactory(context: ComponentContext): void {
	context.fields.only('type', 'sole', 'reach');
	context.object.attachComponent(new FootIK(context.object), {
		sole: context.fields.get('sole').numberOr(0.12),
		reach: context.fields.get('reach').numberOr(0.18),
	});
}

/**
 * The bone it hangs from, and how it lies when it is put down.
 *
 * Through `attachComponent` rather than `addComponent`, because the three
 * fields are declared with `param` — an editor may set them, and a prefab does.
 */
function attachFactory(context: ComponentContext): void {
	const { bone, lift, tilt } = readAttachment(context.fields);
	context.object.attachComponent(new Attach(context.object), { bone, lift, tilt });
}

/**
 * An emitter, on the effect the record names.
 *
 * Through `attachComponent`, because `playing` and `autoDestroy` are declared
 * with `param` and a prefab may set either: a chimney runs from the moment it
 * exists, and a burst spawned where a blow landed sets both.
 */
function particlesFactory(context: ComponentContext): void {
	const { effect } = context.assets;
	if (!effect) throw new Error('a particles component has no effect loaded for it');
	context.fields.only(...PARTICLES_COMPONENT_KEYS);
	context.object.attachComponent(new Particles(context.object, effect), {
		playing: context.fields.get('playing').flag(true),
		autoDestroy: context.fields.get('autoDestroy').flag(false),
	});
}

/** Add all six to a registry, and hand it back. */
export function registerSceneComponents(registry: ComponentRegistry): ComponentRegistry {
	return registry
		.register('rig', rigFactory)
		.register('mesh', meshFactory)
		.register('animator', animatorFactory)
		.register('attach', attachFactory)
		.register('footIK', footIKFactory)
		.register('particles', particlesFactory);
}
