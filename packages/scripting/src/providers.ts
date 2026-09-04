/*
 * Where a host gets its classes, and the two answers this project has.
 *
 * The interface is one method because that is all the host needs, and because
 * the two implementations have almost nothing else in common.
 *
 *   staticScripts   a table built at compile time. The client's. It costs
 *                   nothing, ships nothing extra, and cannot reload — which is
 *                   correct for a game somebody is playing.
 *
 *   the editor's    compiles TypeScript in the browser and reloads on a save.
 *                   It carries a multi-megabyte WebAssembly compiler, which is
 *                   exactly why it is not in this package: the client's whole
 *                   promise is one ES module with nothing to install, and a
 *                   compiler nobody playing the game will ever run has no
 *                   business being inside it.
 *
 * Same scripts, same base class, same host. Only the editor pays.
 */

import type { Script } from './Script.js';
import type { ScriptClass } from './parameters.js';
import type { ScriptProvider } from './ScriptHost.js';

/**
 * A fixed table of classes, keyed by the name a prefab uses.
 *
 * The client's provider. A copy is taken, so the table cannot change behind
 * the host's back — a provider that could would be a reload nobody asked for.
 */
export function staticScripts(
	classes: Readonly<Record<string, ScriptClass<Script>>>,
): ScriptProvider {
	const table = new Map(Object.entries(classes));
	return {
		resolve: (typeName) => table.get(typeName) ?? null,
		get names() {
			return [...table.keys()];
		},
	};
}

/** A provider with nothing in it, for a host that has not been given one yet. */
export const noScripts: ScriptProvider = {
	resolve: () => null,
	names: [],
};
