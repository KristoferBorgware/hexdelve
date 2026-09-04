/*
 * The desktop bridge, as the page sees it.
 *
 * Two Electron shells wrap this project and they are not the same program.
 * The one in `packages/desktop` wraps the CLIENT: it opens a window on the
 * game and exposes nothing but version numbers, because the game authors
 * nothing. The one in `packages/editor-desktop` wraps the EDITOR, and an
 * editor that cannot write to a disk is a viewer — so that shell exposes a
 * writer, and this is the shape of it.
 *
 * Reading is not here, deliberately. Both shells serve their page from a real
 * `app://` origin, so `fetch('assets/…')` reaches the files exactly as it does
 * over http and no bridge is involved. What a bridge is FOR is the thing a
 * page genuinely cannot do — put bytes on a disk — and keeping it to that is
 * what stops the desktop builds from slowly acquiring a second read path that
 * only they take.
 *
 * The scope is an enumeration rather than a path because the page must not be
 * able to name a file outside the two trees it edits. `write('assets', p, t)`
 * carries no directory of its own: the main process owns where `assets` is,
 * checks that `p` resolves inside it, and refuses anything else. A bridge that
 * took an absolute path would be a filesystem API on a window, which is what
 * `contextIsolation` exists to prevent.
 */

import { fetchIO, type AssetIO } from '@hexdelve/engine';

/** The two trees a desktop editor may write to, named rather than pathed. */
export type DesktopScope = 'assets' | 'scripts';

/** What the editor shell's preload exposes. Absent in the client's shell. */
export interface DesktopFiles {
	/** The project directory the shell is pointed at, for a status line. */
	root(): Promise<string>;
	/** Ask for a different project directory. Null when nobody picked one. */
	choose(): Promise<string | null>;
	write(scope: DesktopScope, path: string, text: string): Promise<void>;
	remove(scope: DesktopScope, path: string): Promise<void>;
}

/** The whole of `window.hexdelve`, in either shell. */
export interface DesktopBridge {
	readonly desktop: true;
	/** Present only in the shell that authors. */
	readonly files?: DesktopFiles;
	readonly versions: {
		readonly electron?: string;
		readonly chrome?: string;
		readonly node?: string;
	};
}

/** The bridge, or null in a browser tab. */
export function desktopBridge(): DesktopBridge | null {
	const bridge = (globalThis as { hexdelve?: DesktopBridge }).hexdelve;
	return bridge?.desktop === true ? bridge : null;
}

/**
 * Files read over `app://` and written through the bridge.
 *
 * The read half is `fetchIO`'s, unchanged and unwrapped, which is the whole
 * claim of this arrangement: the desktop editor reads the asset tree by the
 * same code and the same URLs as a browser tab, and only the writing differs.
 */
export function desktopIO(baseUrl: string, files: DesktopFiles): AssetIO {
	const reader = fetchIO(baseUrl);
	return {
		kind: 'desktop',
		origin: reader.origin,
		read: (path) => reader.read(path),
		writer: {
			write: (path, text) => plainly(files.write('assets', path, text)),
			remove: (path) => plainly(files.remove('assets', path)),
		},
	};
}

/**
 * The same call, with the bridge's own wrapping taken off the failure.
 *
 * Electron rethrows whatever the main process threw with
 * `Error invoking remote method 'hexdelve:write': Error: ` on the front of it.
 * That prefix names the transport, and what goes on screen should name the
 * problem — the sentence the main process actually wrote.
 */
export function plainly<T>(work: Promise<T>): Promise<T> {
	return work.catch((cause: unknown) => {
		const text = cause instanceof Error ? cause.message : String(cause);
		throw new Error(text.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, ''));
	});
}
