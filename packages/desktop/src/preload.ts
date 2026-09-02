/*
 * The preload script — the only bridge between the page and Electron.
 *
 * It exposes versions and nothing else. The client is written to run in a
 * browser tab, so anything it needed from here would be a capability the web
 * build could not have, and the two would stop being the same program.
 */

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('hexdelve', {
	desktop: true,
	versions: {
		electron: process.versions['electron'],
		chrome: process.versions['chrome'],
		node: process.versions['node'],
	},
});
