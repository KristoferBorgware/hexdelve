/*
 * The standalone client page — what an Electron shell loads and what gets
 * published beside the labs as a playable build.
 *
 * `base: './'` on purpose: the same output has to work from a GitHub Pages
 * subdirectory and from a file:// URL inside Electron, and only relative asset
 * paths do both.
 */

import { defineConfig } from 'vite';

import { assetIO, bundleDir, publicDir, scriptBundle } from '../../vite.assets.mts';
import { workspaceAliases } from '../../vite.workspace.mts';

export default defineConfig({
	base: './',
	/*
	 * The client authors nothing, but its dev server takes the same plugin —
	 * mostly so a missing asset answers 404 here as it does on a static host,
	 * rather than falling through to index.html with a 200 on it.
	 */
	plugins: [assetIO(), scriptBundle()],
	resolve: { alias: workspaceAliases },
	/*
	 * One asset tree, served by both apps and copied into both builds — see
	 * vite.assets.mts for why it cannot live in either package.
	 */
	publicDir,
	build: {
		outDir: 'dist-app',
		emptyOutDir: true,
		target: 'es2022',
		sourcemap: true,
		// Out of the way of public/assets, which owns that name.
		assetsDir: bundleDir,
	},
	server: {
		port: 5180,
		strictPort: false,
	},
});
