/*
 * The preload script — the whole of what the editor's page can reach.
 *
 * The client's shell exposes versions and nothing else, and says in its own
 * header why: anything more would be a capability the web build could not
 * have, and the two would stop being the same program. This shell exposes one
 * thing more, and the difference is the reason it exists — an editor that
 * cannot write to a disk is a viewer, and the published editor already is one.
 *
 * What is exposed is deliberately not a filesystem. `files.write` takes a
 * SCOPE and a name inside it, so the page can say "the script called Spin.ts"
 * and cannot say "/etc/passwd" — it does not know where the scripts are, and
 * the main process, which does, checks that what it resolved is still inside
 * the tree it meant. See `files.ts`.
 *
 * Reading is not here. The window's page is served from a real `app://` origin
 * whose handler answers `assets/…` and `scripts/…` out of the project
 * directory, so a relative `fetch` reaches the files exactly as it does over
 * http and no bridge is involved. That is what keeps the editor one program:
 * the desktop build differs in what it can SAVE, and in nothing else.
 *
 * The shape of this object is `DesktopBridge` in @hexdelve/client, which is
 * where the page's side of it is typed.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('hexdelve', {
	desktop: true,
	versions: {
		electron: process.versions['electron'],
		chrome: process.versions['chrome'],
		node: process.versions['node'],
	},
	files: {
		root: (): Promise<string | null> => ipcRenderer.invoke('hexdelve:root'),
		choose: (): Promise<string | null> => ipcRenderer.invoke('hexdelve:choose'),
		write: (scope: string, path: string, text: string): Promise<void> =>
			ipcRenderer.invoke('hexdelve:write', scope, path, text),
		remove: (scope: string, path: string): Promise<void> =>
			ipcRenderer.invoke('hexdelve:remove', scope, path),
	},
});
