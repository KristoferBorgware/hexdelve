/*
 * Keeping a running host in step with the compiled scripts.
 *
 * All the reading and compiling now lives in `compiled.ts`, shared by every
 * view that only needs to know what a script IS. This is the one thing that
 * module cannot do for itself: hand what it compiled to a `ScriptHost` so a
 * saved file reaches a running game. `host.reload(provider)` rebuilds every
 * instance behind its id, so nothing that points at a script has to be
 * rebuilt and nothing in the scene is disturbed.
 */

import type { ScriptHost } from '@hexdelve/engine';

import { compiledScriptsSnapshot, ensureCompiled, subscribeCompiledScripts } from './compiled.js';

export interface ScriptWatchState {
	/** What is running now. */
	readonly names: readonly string[];
	/** The last compile error, or null. The previous scripts keep running. */
	readonly error: string | null;
	/** How many times this host has been reloaded, so a panel can show it moved. */
	readonly generation: number;
	readonly compiling: boolean;
}

export type ScriptWatchListener = (state: ScriptWatchState) => void;

/**
 * Keep a host's scripts in step with the shared compile.
 *
 * Returns a function that stops watching. Safe to call where there is no dev
 * server: the shared compile's first read fails, the error is reported, and
 * the host goes on running whatever it was given to begin with — which on a
 * built page is the table compiled into the client.
 */
export function watchScripts(host: ScriptHost, notify: ScriptWatchListener): () => void {
	let generation = 0;
	let live = true;

	/**
	 * Reload the host from whatever the shared cache currently holds, and
	 * report the result.
	 *
	 * Called once straight away, so a host that starts while the cache is
	 * already warm — a backend switch, mounting the yard a second time — gets
	 * the current answer without waiting for the next change to arrive. Called
	 * again every time the shared cache changes.
	 */
	const apply = (): void => {
		if (!live) return;
		const current = compiledScriptsSnapshot();

		if (current.compiling) {
			notify({ names: current.names, error: null, generation, compiling: true });
			return;
		}
		if (current.error) {
			notify({ names: current.names, error: current.error, generation, compiling: false });
			return;
		}

		host.reload(current.provider);
		generation++;
		notify({ names: current.names, error: null, generation, compiling: false });
	};

	const unsubscribe = subscribeCompiledScripts(apply);
	ensureCompiled();
	apply();

	return () => {
		live = false;
		unsubscribe();
	};
}
