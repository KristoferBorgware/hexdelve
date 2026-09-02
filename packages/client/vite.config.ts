/*
 * The standalone client page — what an Electron shell loads and what gets
 * published beside the labs as a playable build.
 *
 * `base: './'` on purpose: the same output has to work from a GitHub Pages
 * subdirectory and from a file:// URL inside Electron, and only relative asset
 * paths do both.
 */

import { defineConfig } from 'vite';

import { workspaceAliases } from '../../vite.workspace.mts';

export default defineConfig({
	base: './',
	resolve: { alias: workspaceAliases },
	build: {
		outDir: 'dist-app',
		emptyOutDir: true,
		target: 'es2022',
		sourcemap: true,
	},
	server: {
		port: 5180,
		strictPort: false,
	},
});
