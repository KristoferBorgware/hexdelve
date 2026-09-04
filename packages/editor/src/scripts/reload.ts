/*
 * Watching the script files, and swapping what runs when one changes.
 *
 * Three things have to line up for a save to reach a running game, and only
 * the middle one is interesting.
 *
 *   read      `store.ts`, which knows which host this is and how to reach the
 *             files on it. The reading is the same fetch everywhere.
 *   compile   `compiler.ts`, in the browser.
 *   swap      `host.reload(provider)`, which rebuilds every instance behind
 *             its id — so nothing that points at a script has to be rebuilt,
 *             and nothing in the scene is disturbed.
 *
 * The watching is Vite's. Its dev server already tells the page when a file
 * under the project changes, and the client's scripts are under the project,
 * so there is nothing to poll: `import.meta.hot` fires, the sources are read
 * again, and the swap happens. On a built page there is no `import.meta.hot`
 * and no dev server, so this reads once and never again — which is correct,
 * since a built page has no files to save.
 */

import type { ScriptHost, ScriptProvider } from '@hexdelve/scripting';

import { compileScripts } from './compiler.js';
import { scriptStore } from './store.js';

export interface ScriptWatchState {
	/** What is running now. */
	readonly names: readonly string[];
	/** The last compile error, or null. The previous scripts keep running. */
	readonly error: string | null;
	/** How many times a swap has happened, so a panel can show it moved. */
	readonly generation: number;
	readonly compiling: boolean;
}

export type ScriptWatchListener = (state: ScriptWatchState) => void;

/**
 * Keep a host's scripts in step with the files on disk.
 *
 * Returns a function that stops watching. Safe to call where there is no dev
 * server: the first read fails, the error is reported, and the host goes on
 * running whatever it was given to begin with — which on a built page is the
 * table compiled into the client.
 */
export function watchScripts(host: ScriptHost, notify: ScriptWatchListener): () => void {
	let provider: ScriptProvider | null = null;
	let generation = 0;
	let live = true;
	let running = false;
	let again = false;

	const state = (patch: Partial<ScriptWatchState>): void => {
		notify({
			names: provider?.names ?? [],
			error: null,
			generation,
			compiling: false,
			...patch,
		});
	};

	const cycle = async (): Promise<void> => {
		if (running) {
			// A second save while the first is still compiling. Remember it and
			// run once more at the end rather than starting a race.
			again = true;
			return;
		}
		running = true;
		state({ compiling: true });

		try {
			const sources = await scriptStore.readAll();
			const result = await compileScripts(sources, provider ?? undefined);
			if (!live) return;

			if (result.error) {
				// The previous module keeps running. That is the difference
				// between an editor somebody can work in and one that goes
				// blank every time a file is half-typed.
				state({ error: result.error });
			} else {
				provider = result.provider;
				generation++;
				host.reload(result.provider);
				state({});
			}
		} catch (error) {
			if (live) state({ error: error instanceof Error ? error.message : String(error) });
		} finally {
			running = false;
			if (again && live) {
				again = false;
				void cycle();
			}
		}
	};

	void cycle();

	/*
	 * Vite's own file watcher. The scripts are under the project, so a save
	 * already reaches this page as a hot update — there is nothing to poll and
	 * no second watcher to keep in step with the first.
	 */
	const hot = (import.meta as { hot?: { on(event: string, handler: () => void): void } }).hot;
	hot?.on('vite:afterUpdate', () => void cycle());

	return () => {
		live = false;
	};
}
