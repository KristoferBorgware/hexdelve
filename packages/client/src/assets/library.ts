/*
 * Opening the asset library, wherever this is running.
 *
 * Three hosts, one call. What differs between them is not how the files are
 * read — that is `fetch` everywhere, including in Electron, which registers a
 * privileged `app://` scheme precisely so it can be — but whether anything is
 * allowed to write, and that is decided here rather than guessed at each call
 * site.
 *
 *   dev server   `import.meta.env.DEV`, or `writable: true` said outright.
 *                Writes are a PUT back to the same URL, handled by the plugin
 *                in vite.assets.mts. This is the one host that authors.
 *   browser      a built page, on Pages or anywhere else. Read-only, and the
 *                editor says so rather than offering a save that cannot work.
 *   Electron     also read-only: the desktop shell wraps the client, not the
 *                editor, so nothing in it authors anything. It is otherwise
 *                indistinguishable from the browser, which is the point.
 *
 * `new AssetLibrary(io)` is still perfectly usable and reads a rig, a mesh or
 * a clip without any help. What it cannot do is resolve `procedural: stride`,
 * because the engine has never heard of a stride — so an embedder who built
 * one by hand would get a clear error naming a function they had no way to
 * know about. This is the version that works.
 */

import { AssetLibrary, fetchIO, type AssetIO, type AssetLibraryOptions } from '@hexdelve/engine';

import { poseFunctions } from './poseFunctions.js';

/** Where the manifest listing every entity lives, relative to the asset root. */
export const ASSET_INDEX = 'index.yaml';

/**
 * Where the files are, relative to the page.
 *
 * Relative rather than absolute for the same reason the client's build sets
 * `base: './'`: the same output has to work from a Pages subdirectory, from a
 * dev server at the root, and from the desktop shell's `app://` origin.
 */
export const ASSET_BASE = 'assets';

export interface OpenAssetsOptions extends AssetLibraryOptions {
	/** Where the asset files are. Defaults to `assets`, relative to the page. */
	readonly baseUrl?: string;
	/**
	 * Allow writing. Defaults to true on a Vite dev server and false
	 * everywhere else, which is the honest answer in both cases — see above.
	 */
	readonly writable?: boolean;
	/** Somewhere other than HTTP to read from — a pack, a disk, a test. */
	readonly io?: AssetIO;
}

/**
 * Is this a dev server?
 *
 * `import.meta.env.DEV` is Vite's, replaced at build time, and absent when
 * this module is loaded any other way — by Node in a test, or from the
 * library bundle by an embedder with their own bundler. The optional chain is
 * what keeps those cases from throwing rather than answering "no".
 */
function onDevServer(): boolean {
	return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

export function openAssets(options: OpenAssetsOptions = {}): AssetLibrary {
	const { baseUrl = ASSET_BASE, writable, io, ...rest } = options;
	const backend = io ?? fetchIO(baseUrl, { writable: writable ?? onDevServer() });
	return new AssetLibrary(backend, { poseFunctions, ...rest });
}
