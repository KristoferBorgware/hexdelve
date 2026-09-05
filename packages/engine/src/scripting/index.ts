/*
 * Scripting — what game behaviour is written as, and what runs it.
 *
 * A script is a component, in the plainest sense: derive from `Script` — which
 * lives with the other components, in `scene/components` — put the file in the
 * client's `scripts/` directory, name it from a prefab, and it sits in its
 * object's component list. `object.getComponent(Wander)` finds it, and nothing
 * outside `ScriptHost` has to know it arrived by a different road.
 *
 * What the host keeps is the road: which class a NAME means, and how to build a
 * new instance in the old one's place when that class is replaced by a hot
 * reload. See `ScriptHost`.
 *
 * The engine carries no compiler. The client's provider is a table built at
 * build time; the editor's compiles in the browser and is the editor's, because
 * the client's whole promise is one ES module with nothing to install.
 */

export {
	ScriptHost,
	type ScriptHostOptions,
	type ScriptProvider,
	type ScriptSpawner,
	type SpawnPlacement,
} from './ScriptHost.js';
export {
	engineComponents,
	scriptComponentFactory,
	type ScriptSpawnExtras,
} from './component.js';
export { noScripts, staticScripts } from './providers.js';
export {
	scriptSdkShim,
	scriptsFromBundle,
	SCRIPT_SDK_GLOBAL,
	SCRIPT_SDK_MODULE,
} from './bundle.js';
export {
	defineEvent,
	handlersOf,
	on,
	type EventHandler,
	type GameEvent,
	type Payload,
} from './events.js';
