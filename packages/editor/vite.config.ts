/*
 * The editor is published to GitHub Pages under /hexdelve/editor/, and the
 * same build is what a developer opens locally, so the base is relative rather
 * than pinned to the deploy path.
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	base: './',
	plugins: [react()],
	build: {
		outDir: 'dist',
		emptyOutDir: true,
		target: 'es2022',
		sourcemap: true,
	},
	server: {
		port: 5181,
		strictPort: false,
	},
});
