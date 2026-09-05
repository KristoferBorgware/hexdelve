/*
 * The editor's asset library, and the one question it has to answer honestly.
 *
 * One library for the whole editor rather than one per view: they all read the
 * same files, the library caches what it has read, and — the part that
 * actually matters — a save has to invalidate everything derived from the file
 * that changed. Two libraries would mean one of them quietly serving the old
 * rig after the other had written a new one.
 *
 * `openAssets` decides whether this host can write, and the answer is worth
 * surfacing rather than discovering: on `npm run dev:editor` it is yes, and
 * the plugin in vite.assets.mts puts the bytes in public/assets. On the built
 * editor published to Pages it is no, because a static page has nowhere to put
 * a file and no business pretending otherwise. The status line says which, so
 * nobody types into a document that cannot be saved.
 */

import { openAssets, type EntityAsset } from '@hexdelve/client';
import type { AssetLibrary, ParticleEffect } from '@hexdelve/engine';
import { useCallback, useEffect, useState } from 'react';

/** The editor's one library. Opened once, at module load — it does no I/O yet. */
export const library: AssetLibrary = openAssets();

export interface AssetState {
	/** Every entity the manifest lists, in its order. Empty until loaded. */
	readonly entities: readonly EntityAsset[];
	/** Every particle effect it lists, in its order. Empty until loaded. */
	readonly effects: readonly ParticleEffect[];
	/** Every file reaching those entities touched, sorted. */
	readonly paths: readonly string[];
	readonly loading: boolean;
	/** What went wrong, said the way the reader said it — file, line and all. */
	readonly error: string | null;
}

const EMPTY: AssetState = { entities: [], effects: [], paths: [], loading: true, error: null };

/**
 * Load the manifest, and reload it on demand.
 *
 * Reloading is not a refresh button for its own sake: saving a file is the
 * point of this editor being writable, and what a save leaves behind is a
 * library that has forgotten everything and a view still holding the old
 * objects. `reload` is how the two come back together.
 */
export function useAssets(): AssetState & { reload: () => void } {
	const [state, setState] = useState<AssetState>(EMPTY);
	const [generation, setGeneration] = useState(0);

	const reload = useCallback(() => setGeneration((n) => n + 1), []);

	useEffect(() => {
		let live = true;
		setState((previous) => ({ ...previous, loading: true, error: null }));

		/*
		 * Both lists off the one manifest, together. Neither needs the other and
		 * the manifest's text is read once and remembered, so the second call
		 * costs a parse rather than a fetch.
		 */
		Promise.all([library.index(), library.effectIndex()])
			.then(([entities, effects]) => {
				if (!live) return;
				setState({ entities, effects, paths: library.paths, loading: false, error: null });
			})
			.catch((error: unknown) => {
				if (!live) return;
				setState({
					entities: [],
					effects: [],
					paths: library.paths,
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			});

		// A reload that lands after the view has moved on must not write to it.
		return () => {
			live = false;
		};
	}, [generation]);

	return { ...state, reload };
}

/** Where this library is reading from, and whether it may write there. */
export function backendLabel(): string {
	const io = library.source;
	const how = library.writable ? 'read and write' : 'read-only';
	return `${io.kind} · ${io.origin} · ${how}`;
}
