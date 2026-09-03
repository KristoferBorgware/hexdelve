/*
 * The test runner.
 *
 * Tests import the workspace packages by name and get their SOURCE, through
 * the same aliases the client and the editor build with. That is what lets
 * `npm test` run on a fresh clone with nothing built: a test that could only
 * see `dist/` would need a build first, and a broken build would then look
 * like a broken test.
 *
 * The browser-driven tests are the exception — the yard's picture and the
 * shader compilation are properties of the BUILT client, so those load
 * packages/client/dist-lib and skip themselves when it is not there.
 *
 * The .mts extension is load-bearing for the same reason vite.workspace.mts
 * needs it: the root package.json is CommonJS so that tools/*.js can go on
 * using require(), and .mts is what makes this file ESM regardless.
 */

import { defineConfig } from 'vitest/config';

import { workspaceAliases } from './vite.workspace.mts';

export default defineConfig({
	resolve: { alias: workspaceAliases },
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		// The browser-driven ones launch Chromium, load a page and step thirty
		// frames through a software rasteriser. Nothing here is quick.
		testTimeout: 120_000,
		hookTimeout: 120_000,
	},
});
