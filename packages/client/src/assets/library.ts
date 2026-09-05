/*
 * Opening the asset library, wherever this is running.
 *
 * One call, whichever host it is. What differs between them is not how the
 * files are read — that is `fetch` everywhere, including in Electron, which
 * registers a privileged `app://` scheme precisely so it can be — but whether
 * anything is allowed to write, and that is decided here rather than guessed
 * at each call site.
 *
 *   dev server   `import.meta.env.DEV`, or `writable: true` said outright.
 *                Writes are a PUT back to the same URL, handled by the plugin
 *                in vite.assets.mts.
 *   browser      a built page, on Pages or anywhere else. Read-only, and the
 *                editor says so rather than offering a save that cannot work.
 *   Electron     whichever the shell says. The shell around the CLIENT exposes
 *                no writer and is read-only, indistinguishable from a browser
 *                tab, which is the point of it; the shell around the EDITOR
 *                exposes one, and writes land on the project directory that
 *                window was opened on. Either way the reading is the same
 *                `fetch` over `app://` — see `desktop.ts`.
 *
 * `new AssetLibrary(io)` reads every kind of file the game has; what this adds
 * is knowing WHERE they are — which base URL, which backend, and that a build
 * may have folded the whole tree into one pack.
 */

import { AssetLibrary, fetchIO, memoryIO, type AssetIO } from '@hexdelve/engine';

import { desktopBridge, desktopIO } from './desktop.js';

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

export interface OpenAssetsOptions {
	/** Where the asset files are. Defaults to `assets`, relative to the page. */
	readonly baseUrl?: string;
	/**
	 * Allow writing. Defaults to true on a Vite dev server and in a desktop
	 * shell that exposes a writer, and false everywhere else, which is the
	 * honest answer in each case — see above.
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
	const { baseUrl = ASSET_BASE, writable, io } = options;
	return new AssetLibrary(io ?? openAssetIO(baseUrl, writable));
}

/**
 * Which backend this host gets.
 *
 * The order matters: a caller that said `writable: false` gets a read-only
 * backend even in the editor's desktop shell, because a view that must not
 * write should not be handed a writer it can be talked into using.
 */
function openAssetIO(baseUrl: string, writable: boolean | undefined): AssetIO {
	const files = desktopBridge()?.files ?? null;
	const allowed = writable ?? (files !== null || onDevServer());
	if (files && allowed) return desktopIO(baseUrl, files);
	return fetchIO(baseUrl, { writable: allowed });
}

/**
 * A packed tree, fetched once.
 *
 * `tools/build-assets.mjs` folds `public/assets` into one JSON object of path
 * to text, which is exactly the shape `memoryIO` reads. So this is one request
 * instead of thirty — the client otherwise fetches the manifest, then an
 * entity, then its rig, its mesh, its clips and its trees, and each is a round
 * trip.
 *
 * Nothing downstream can tell the difference: a pack is a backend like any
 * other, and the readers never learn where their text came from.
 */
export async function openPackedAssets(url: string): Promise<AssetLibrary> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${url}: ${response.status} ${response.statusText}`);
	}
	const pack = (await response.json()) as Record<string, string>;
	return new AssetLibrary(memoryIO(pack));
}
