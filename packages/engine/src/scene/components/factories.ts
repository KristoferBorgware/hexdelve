/*
 * Building the four components that are facts about drawing and posing.
 *
 * `rig`, `mesh`, `animator` and `attach` are the engine's own vocabulary, in
 * the way `actor` and `item` are a game's: each is about how a thing is drawn
 * or how it is posed, which is what an engine is for. So the engine registers
 * them itself rather than leaving every game to repeat the same four lines and
 * to disagree about one of them.
 *
 * Each factory takes what its record named off `context.assets` rather than
 * reading the path again. The library resolved and fetched every one of them
 * while it loaded the entity — see assets/binding.ts — because a fetch is
 * asynchronous and spawning is not.
 */

import { readAttachment } from '../../assets/entity.js';
import type { ComponentContext, ComponentRegistry } from '../../assets/instantiate.js';
import { Animator } from './Animator.js';
import { Attach } from './Attach.js';
import { MeshRenderer } from './MeshRenderer.js';
import { Rig } from './Rig.js';

/** The bones, and the pose they are in. */
function rigFactory(context: ComponentContext): void {
	const { rig } = context.assets;
	if (!rig) throw new Error('a rig component has no rig loaded for it');
	context.object.addComponent(Rig, rig);
}

/** The prisms, hung on whatever rig is in scope. */
function meshFactory(context: ComponentContext): void {
	const { mesh } = context.assets;
	if (!mesh) throw new Error('a mesh component has no mesh loaded for it');
	context.object.addComponent(MeshRenderer, mesh);
}

/** The animations and the trees over them. */
function animatorFactory(context: ComponentContext): void {
	const { animations, blendTrees } = context.assets;
	context.object.addComponent(Animator, animations, blendTrees);
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

/** Add all four to a registry, and hand it back. */
export function registerSceneComponents(registry: ComponentRegistry): ComponentRegistry {
	return registry
		.register('rig', rigFactory)
		.register('mesh', meshFactory)
		.register('animator', animatorFactory)
		.register('attach', attachFactory);
}
