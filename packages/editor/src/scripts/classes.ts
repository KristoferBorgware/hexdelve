/*
 * The compiled script classes, for anything that needs to ask one what it
 * declares.
 *
 * The scripts view compiles to run behaviour; this compiles to READ it. What
 * the entity bench wants from a script is its parameter list — the fields it
 * exposed with `param()`, with their types, bounds and defaults — and that is
 * a property of the class rather than of any instance, so nothing has to be
 * running for the question to have an answer.
 *
 * Compiled once when a view that needs it mounts, and again on demand. Not
 * watched: a script edited in the scripts view while the bench is up is a
 * moment away from a recompile there, and a bench that rebuilt its controls
 * under somebody's cursor would be worse than one showing a name it cannot
 * resolve — which it says, rather than hiding.
 */

import { noScripts, type ScriptProvider } from '@hexdelve/engine';
import { useCallback, useEffect, useState } from 'react';

import { compileScripts } from './compiler.js';
import { scriptStore } from './store.js';

export interface ScriptClasses {
	readonly provider: ScriptProvider;
	/** The class names the bundle produced, sorted. */
	readonly names: readonly string[];
	readonly loading: boolean;
	/** What went wrong, or null. The previous classes stand when this is set. */
	readonly error: string | null;
	reload(): void;
}

export function useScriptClasses(): ScriptClasses {
	const [provider, setProvider] = useState<ScriptProvider>(noScripts);
	const [names, setNames] = useState<readonly string[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [generation, setGeneration] = useState(0);

	const reload = useCallback(() => setGeneration((n) => n + 1), []);

	useEffect(() => {
		let live = true;
		setLoading(true);

		void (async () => {
			try {
				const sources = await scriptStore.readAll();
				const result = await compileScripts(sources);
				if (!live) return;
				setProvider(result.provider);
				setNames([...result.names].sort());
				setError(result.error);
			} catch (cause) {
				if (!live) return;
				setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (live) setLoading(false);
			}
		})();

		return () => {
			live = false;
		};
	}, [generation]);

	return { provider, names, loading, error, reload };
}
