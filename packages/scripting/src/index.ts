/*
 * @hexdelve/scripting — what game behaviour is written as, and what runs it.
 *
 * A script is a component: derive from `Script`, put the file in the client's
 * `scripts/` directory, and name it from a prefab. The engine drives it through
 * `ScriptComponent`, which holds only an id — so the host can replace every
 * running instance on a hot reload and no component notices.
 *
 * This package carries no compiler. The client's provider is a table built at
 * build time; the editor's compiles in the browser and is the editor's, because
 * the client's whole promise is one ES module with nothing to install.
 */

export { Script, type ScriptBinding } from './Script.js';
export { ScriptComponent, type ScriptComponentOptions } from './ScriptComponent.js';
export {
	ScriptHost,
	type LiveParameter,
	type ScriptHostOptions,
	type ScriptProvider,
} from './ScriptHost.js';
export { noScripts, staticScripts } from './providers.js';
export { ScriptObject, ScriptScene, ScriptTransform } from './handles.js';
export {
	applyParameters,
	parameterKeys,
	parametersOf,
	param,
	readParameters,
	resolveParameters,
	type ParameterMeta,
	type ParameterOptions,
	type ParameterType,
	type ScriptClass,
} from './parameters.js';
