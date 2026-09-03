/*
 * The editor is published to GitHub Pages under /hexdelve/editor/, and the
 * same build is what a developer opens locally, so the base is relative rather
 * than pinned to the deploy path.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { assetIO, bundleDir, publicDir } from '../../vite.assets.mts';
import { workspaceAliases } from '../../vite.workspace.mts';

export default defineConfig({
	base: './',
	// The editor authors these files, so its dev server is the one that writes.
	plugins: [react(), assetIO()],
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
	},
});
