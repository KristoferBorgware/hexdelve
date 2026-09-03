/*
 * The preload script — the only bridge between the page and Electron.
 *
 * It exposes versions and nothing else, and that is a deliberate ceiling
 * rather than an oversight. The client is written to run in a browser tab, so
 * anything it needed from here would be a capability the web build could not
 * have, and the two would stop being the same program.
 *
 * Reading assets is the case that most looks like an exception and is not.
 * The window's page is served from a real `app://` origin (see main.ts), so a
 * relative `fetch` reaches the asset files exactly as it does over http, and
 * no bridge is required. Writing genuinely cannot happen here — this shell
 * wraps the client, which authors nothing — so there is nothing to expose for
 * that either, and the asset library reports itself read-only on its own.
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
