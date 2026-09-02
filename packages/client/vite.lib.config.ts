/*
 * The distributable bundle.
 *
 * This is the artifact the project is ultimately for: one ES module with the
 * engine and the shared maths rolled in and nothing else to install. Nothing
 * is marked external, which is only reasonable because the client's whole
 * dependency list is two workspace packages that are themselves dependency-free.
 */

import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { workspaceAliases } from '../../vite.workspace.mts';

export default defineConfig({
	resolve: { alias: workspaceAliases },
	build: {
		outDir: 'dist-lib',
		emptyOutDir: true,
		target: 'es2022',
		sourcemap: true,
		lib: {
			entry: resolve(import.meta.dirname, 'src/index.ts'),
			name: 'Hexdelve',
			formats: ['es', 'umd'],
			fileName: (format) => `hexdelve-client.${format}.js`,
		},
	},
});
