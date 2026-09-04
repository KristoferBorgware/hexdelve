/*
 * The editor is published to GitHub Pages under /hexdelve/editor/, and the
 * same build is what a developer opens locally, so the base is relative rather
 * than pinned to the deploy path.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { assetIO, bundleDir, publicDir, scriptTypes, servedDirs } from '../../vite.assets.mts';
import { workspaceAliases } from '../../vite.workspace.mts';

export default defineConfig({
	base: './',
	/*
	 * The editor authors these files, so its dev server is the one that writes.
	 *
	 * Two differences from the client's list, and they are the same difference
	 * said twice. `scriptTypes` is here because the code editor's language
	 * service has to know what a `Script` is, and the client has no code editor
	 * in it. `scriptBundle` is NOT here, because the editor compiles the scripts
	 * itself, in the page, out of the files it is showing — so it has no use for
	 * a bundle, and a built editor that carried one would be carrying behaviour
	 * frozen at the moment IT was built, which has nothing to do with the
	 * project a window is later opened on.
	 */
	plugins: [react(), assetIO(), scriptTypes()],
	resolve: { alias: workspaceAliases },
	/*
	 * One asset tree, served by both apps and copied into both builds — see
	 * vite.assets.mts for why it cannot live in either package.
	 */
	publicDir,
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2022',
		sourcemap: true,
		// Out of the way of public/assets, which owns that name.
		assetsDir: bundleDir,
	},
	server: {
		port: 5181,
		strictPort: false,
		// The repository is not the application. See `servedDirs`.
		fs: { allow: servedDirs },
	},
});
