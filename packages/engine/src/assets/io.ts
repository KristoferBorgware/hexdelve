/*
 * Where asset files come from, and where they go back to.
 *
 * There are three hosts that have to read these files and they have almost
 * nothing in common: a browser tab, a Vite dev server, and an Electron window
 * whose page is not served over http at all. The whole of what they share is
 * this — a path in, a string out — so that is the whole of the interface, and
 * every host difference lives in one small object below rather than being
 * spread through the loaders.
 *
 * Reading is the same everywhere. `fetch` is the one API all three have, and
 * Electron is made to have it properly rather than worked around: the desktop
 * shell registers a privileged `app://` scheme and serves the client's build
 * through it, so a relative `fetch('assets/…')` behaves exactly as it does on
 * the web. That matters more than it sounds — the desktop shell's whole claim
 * is that whatever ships on the web ships there too, and a bespoke read path
 * for Electron would quietly make that false.
 *
 * WRITING is where they genuinely differ, so it is a capability rather than a
 * method. `io.writer` is null on a backend that cannot write, which makes
 * "this editor cannot save here" a thing the type system knows and the UI can
 * show, instead of an error somebody discovers by pressing a button:
 *
 *   dev server   writable. A PUT to the same URL the GET came from, handled by
 *                the plugin in vite.assets.mts, lands in public/assets. This is
 *                where the editor authors.
 *   browser      read-only. A static build on Pages has nowhere to put a file
 *                and no business pretending otherwise.
 *   Electron     depends on which shell. The one around the client is
 *                read-only, because the client authors nothing; the one around
 *                the editor writes, through a bridge its preload exposes,
 *                because a desktop editor with no disk would be pointless.
 *                A PUT cannot serve there — `app://` is served by a handler in
 *                the main process, not by a server — so the write is an IPC
 *                call while the read stays a fetch, which is exactly the split
 *                this interface exists to express.
 *   memory       writable. Tests, and a packed build held in one object.
 *
 * A backend names itself in `kind`, because the first question anybody asks a
 * failing save is which of them it was talking to.
 */

/** Reading is required, writing is a capability. */
export interface AssetIO {
	/** Which backend this is, for a status line and an error message. */
	readonly kind: AssetIOKind;
	/** Where it is reading from, in whatever terms that host uses. */
	readonly origin: string;
	read(path: string): Promise<string>;
	/** Null when this host cannot write. */
	readonly writer: AssetWriter | null;
}

export type AssetIOKind = 'fetch' | 'dev-server' | 'desktop' | 'memory';

export interface AssetWriter {
	write(path: string, text: string): Promise<void>;
	remove(path: string): Promise<void>;
}

/**
 * Files over HTTP, under a base URL.
 *
 * The base is joined with a `/` and nothing cleverer, so it works from a
 * GitHub Pages subdirectory, from a Vite dev server, and from the desktop
 * shell's `app://` origin — the same reason the client's Vite config sets
 * `base: './'`.
 *
 * `writable` turns the same URL into a PUT for writing and a DELETE for
 * removing. Deliberately the same URL rather than a second endpoint: a file
 * has one address, and an editor that read from one place and wrote to
 * another would have two ways to be pointed at the wrong tree.
 */
export function fetchIO(baseUrl: string, options: { writable?: boolean } = {}): AssetIO {
	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	const writable = options.writable ?? false;

	const send = async (path: string, method: 'PUT' | 'DELETE', body?: string): Promise<void> => {
		const url = `${base}${path}`;
		const response = await fetch(url, {
			method,
			...(body === undefined ? {} : { headers: { 'content-type': 'text/yaml' }, body }),
		});
		if (!response.ok) {
			const detail = (await response.text().catch(() => '')).trim();
			throw new Error(
				`${method} ${url}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
			);
		}
	};

	return {
		kind: writable ? 'dev-server' : 'fetch',
		origin: base,
		async read(path) {
			const url = `${base}${path}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
			return response.text();
		},
		writer: writable
			? {
					write: (path, text) => send(path, 'PUT', text),
					remove: (path) => send(path, 'DELETE'),
				}
			: null,
	};
}

/**
 * Files already in hand, keyed by path — a packed build, or a test.
 *
 * Writable, because the thing a test most wants to do after loading an asset
 * is change one and load it again.
 */
export function memoryIO(files: ReadonlyMap<string, string> | Record<string, string> = {}): AssetIO {
	const map = files instanceof Map ? new Map(files) : new Map(Object.entries(files));
	return {
		kind: 'memory',
		origin: 'memory',
		async read(path) {
			const text = map.get(path);
			if (text === undefined) {
				throw new Error(`no asset at '${path}'; this pack has ${[...map.keys()].sort().join(', ')}`);
			}
			return text;
		},
		writer: {
			async write(path, text) {
				map.set(path, text);
			},
			async remove(path) {
				map.delete(path);
			},
		},
	};
}

/** A read-only view of a writable backend, for a caller that must not write. */
export function readOnly(io: AssetIO): AssetIO {
	return { kind: io.kind, origin: io.origin, read: (path) => io.read(path), writer: null };
}
