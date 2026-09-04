/*
 * Where the scripts are read from, and written back to.
 *
 * The asset library answers this question for the YAML files and answers it
 * once, for the whole editor, because a save has to invalidate everything
 * derived from what changed. The scripts need the same answer for a smaller
 * reason: nothing is derived from a script until it is compiled, but WHETHER
 * THIS HOST CAN WRITE ONE is exactly as host-dependent, and the code editor
 * must not offer a save that quietly does nothing.
 *
 *   dev server   `npm run dev:editor`. A PUT back to the URL the GET came
 *                from, handled by the plugin in vite.assets.mts, lands in
 *                `packages/client/scripts`.
 *   desktop      the Electron editor shell. Reads are the same fetch over
 *                `app://`; writes go through the bridge its preload exposes,
 *                because `app://` is served by a handler in the main process
 *                and a handler is not a server — there is nothing for a PUT to
 *                arrive at. See `desktop.ts` in @hexdelve/client.
 *   static       the editor published to Pages. Reads whatever the build
 *                carried and writes nothing, and says so.
 *
 * Reading is one code path in all three, which is the same claim the asset
 * library makes and worth as much: what the code editor shows is what the
 * compiler compiles is what the client runs.
 */

import { desktopBridge, plainly, type DesktopFiles } from '@hexdelve/client';

/** Where the dev server and the desktop shell both serve the scripts. */
const SCRIPTS = 'scripts';

export type ScriptStoreKind = 'dev-server' | 'desktop' | 'static';

export interface ScriptStore {
	/** Which host this is, for a status line and an error message. */
	readonly kind: ScriptStoreKind;
	/** Whether `write` and `remove` will do anything. */
	readonly writable: boolean;
	/** Where it is reading from, in whatever terms that host uses. */
	readonly origin: string;
	/** The file names, sorted. */
	list(): Promise<string[]>;
	read(name: string): Promise<string>;
	/** Every script, in one go — what the compiler wants. */
	readAll(): Promise<Map<string, string>>;
	write(name: string, text: string): Promise<void>;
	remove(name: string): Promise<void>;
}

/**
 * The one store the editor uses.
 *
 * Opened at module load, like the asset library, and for the same reason: what
 * a host can do does not change while the page is up, and asking once means
 * every view agrees about it.
 */
export const scriptStore: ScriptStore = openScripts();

export function openScripts(): ScriptStore {
	const files = desktopBridge()?.files ?? null;
	if (files) return desktopStore(files);
	if (onDevServer()) return httpStore('dev-server');
	return httpStore('static');
}

/** Vite's, replaced at build time, and absent when a build serves this page. */
function onDevServer(): boolean {
	return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/**
 * Reading over HTTP, which is every host.
 *
 * A cache-buster on each request: the point is to read what is on disk NOW,
 * and a browser that helpfully served the copy it already had would make a
 * reload a no-op in exactly the case it exists for.
 */
function reader(): Pick<ScriptStore, 'list' | 'read' | 'readAll'> {
	const list = async (): Promise<string[]> => {
		const stamp = Date.now();
		const response = await fetch(`${SCRIPTS}/?t=${stamp}`);
		if (!response.ok) throw new Error(`cannot list ${SCRIPTS}/: ${response.status}`);
		return (await response.json()) as string[];
	};

	const read = async (name: string): Promise<string> => {
		const response = await fetch(`${SCRIPTS}/${name}?t=${Date.now()}`);
		if (!response.ok) throw new Error(`cannot read ${name}: ${response.status}`);
		return response.text();
	};

	return {
		list,
		read,
		async readAll() {
			const names = await list();
			const sources = new Map<string, string>();
			await Promise.all(
				names.map(async (name) => {
					sources.set(name, await read(name));
				}),
			);
			return sources;
		},
	};
}

/** The dev server, and the built page that has one of everything but a writer. */
function httpStore(kind: 'dev-server' | 'static'): ScriptStore {
	const writable = kind === 'dev-server';

	const send = async (name: string, method: 'PUT' | 'DELETE', body?: string): Promise<void> => {
		const url = `${SCRIPTS}/${name}`;
		const response = await fetch(url, {
			method,
			...(body === undefined ? {} : { headers: { 'content-type': 'text/plain' }, body }),
		});
		if (!response.ok) {
			const detail = (await response.text().catch(() => '')).trim();
			throw new Error(
				`${method} ${url}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
			);
		}
	};

	return {
		kind,
		writable,
		origin: `${SCRIPTS}/`,
		...reader(),
		async write(name, text) {
			if (!writable) throw new Error(cannotWrite(kind));
			await send(name, 'PUT', text);
		},
		async remove(name) {
			if (!writable) throw new Error(cannotWrite(kind));
			await send(name, 'DELETE');
		},
	};
}

/** The Electron editor shell: the same reads, and a writer over the bridge. */
function desktopStore(files: DesktopFiles): ScriptStore {
	return {
		kind: 'desktop',
		writable: true,
		origin: `${SCRIPTS}/`,
		...reader(),
		// `plainly` takes Electron's "error invoking remote method" wrapper off
		// the failure, so what reaches the alert is the sentence the main
		// process wrote about the file.
		write: (name, text) => plainly(files.write('scripts', name, text)),
		remove: (name) => plainly(files.remove('scripts', name)),
	};
}

function cannotWrite(kind: ScriptStoreKind): string {
	return kind === 'static'
		? 'this page has nowhere to put a file; run npm run dev:editor, or open the desktop editor'
		: `the ${kind} host cannot write`;
}

/**
 * What is wrong with a proposed file name, or null.
 *
 * The dev server refuses anything that does not resolve to a `.ts` inside the
 * script directory, and the desktop shell refuses the same set. This is the
 * same rule said early, so that creating a file that cannot exist is a
 * sentence under a text field rather than a 400 after a round trip.
 */
export function scriptNameProblem(name: string): string | null {
	if (name.trim() === '') return 'a script needs a name';
	if (!name.endsWith('.ts')) return 'a script is a .ts file';
	if (name.endsWith('.d.ts')) return 'a declaration is not a script';
	if (!/^[A-Za-z][A-Za-z0-9_-]*\.ts$/.test(name)) {
		return 'letters, digits, dash and underscore, starting with a letter';
	}
	return null;
}

/** `Spin.ts` becomes `Spin`, which is what a class in it is usually called. */
export function scriptStem(name: string): string {
	return name.replace(/\.ts$/, '');
}
