/*
 * An asset library with this package's pose functions already in it.
 *
 * `new AssetLibrary(source)` is perfectly usable and reads a rig, a mesh or a
 * clip without any help. What it cannot do is resolve `procedural: stride`,
 * because the engine has never heard of a stride — so an embedder who built
 * one by hand would get a clear error naming a function they had no way to
 * know about. This is the two-line version that works.
 */

import { AssetLibrary, fetchSource, type AssetLibraryOptions, type AssetSource } from '@hexdelve/engine';

import { poseFunctions } from './poseFunctions.js';

/** Where the manifest listing every entity lives, relative to the asset root. */
export const ASSET_INDEX = 'index.yaml';

export interface OpenAssetsOptions extends AssetLibraryOptions {
	/**
	 * Where the asset files are. A URL or a path the page can fetch from, and
	 * relative by default for the same reason the client's build is: the same
	 * output has to work from a Pages subdirectory and from a `file://` URL.
	 */
	readonly baseUrl?: string;
	/** Somewhere other than the network to read from — a pack, or a disk. */
	readonly source?: AssetSource;
}

export function openAssets(options: OpenAssetsOptions = {}): AssetLibrary {
	const { baseUrl = 'assets', source, ...rest } = options;
	return new AssetLibrary(source ?? fetchSource(baseUrl), { poseFunctions, ...rest });
}
