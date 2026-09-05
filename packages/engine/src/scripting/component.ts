/*
 * The `script` component type, and the registry every game starts from.
 *
 * A prefab names a component by a type string, and something has to say what
 * each string builds — see `ComponentRegistry` in `assets/instantiate.ts`. For
 * `actor` and `item` that something is the GAME: those are hexdelve's own
 * vocabulary and the engine has never heard of either. `script` is different.
 * `Script` and `ScriptHost` live in this engine, under `scene/components` and
 * `scripting` respectively, so the engine already knows exactly what building
 * one means — there is nothing for a game to decide, and nothing for it to get
 * wrong by deciding it differently. Registering the type here rather than in
 * every game that uses one is that fact, made into code instead of a
 * convention somebody has to remember to repeat.
 */

import { registerSceneComponents } from '../scene/components/factories.js';
import type { Scene } from '../scene/Scene.js';
import { ComponentRegistry, type ComponentContext } from '../assets/instantiate.js';
import type { ScriptHost } from './ScriptHost.js';

/**
 * What `instantiate` must be given for a `script` component to build.
 *
 * The one field the factory below reads out of `context.extras`. A caller
 * spawning something that runs no scripts — a bench previewing a body, most of
 * this engine's own tests — has no `scripts` to give, and a prefab that names
 * one there fails by saying so rather than by quietly doing nothing.
 */
export interface ScriptSpawnExtras {
	readonly scripts?: {
		readonly host: ScriptHost;
		readonly scene: Scene;
	};
}

/**
 * A behaviour, by the name its file exports it under.
 *
 * Every field beyond `type` and `script` is a parameter, read as raw values
 * rather than through the `Node` helpers a factory would otherwise use: a
 * script's fields are the script's to describe, and the host checks them
 * against what the class declared rather than against anything this reader
 * knows.
 */
export function scriptComponentFactory(context: ComponentContext): void {
	const extras = context.extras as ScriptSpawnExtras | undefined;
	const scripts = extras?.scripts;
	if (!scripts) {
		throw new Error('nothing here runs scripts, and this prefab asks for one');
	}

	const name = context.fields.need('script').text();
	/*
	 * Through the host rather than `object.addComponent`. Every other kind of
	 * component is built from data the caller already holds; a script is built
	 * from a CLASS, found by name in a bundle compiled separately, which the
	 * host can replace while the game runs. What comes out is an ordinary
	 * component on the object either way.
	 */
	scripts.host.attach(context.object, name, {
		scene: scripts.scene,
		parameters: context.fields.rest('type', 'script'),
	});
}

/**
 * A registry with the component types the engine itself understands.
 *
 * `script` here, and the four in `scene/components/factories.ts` that are facts
 * about drawing and posing. A fresh instance every call, never a shared one:
 * `ComponentRegistry.register` throws on a type registered twice, which is
 * exactly what would happen the second time anything imported a shared registry
 * and tried to add its own vocabulary to it. A game calls this once and builds
 * its own registry on top — see `packages/client/src/game/components.ts`.
 */
export function engineComponents(): ComponentRegistry {
	return registerSceneComponents(new ComponentRegistry()).register(
		'script',
		scriptComponentFactory,
	);
}
