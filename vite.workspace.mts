/*
 * Where Vite looks for the workspace packages.
 *
 * Each library package points `exports` at its built `dist/`, which is right
 * for anyone installing @hexdelve/client from a registry and wrong for
 * everyone working in this repository: dist/ is generated and git-ignored, so
 * a fresh clone has none of it and `npm run dev:client` cannot resolve a
 * single internal import.
 *
 * Building first would fix the error and cost the thing that makes a monorepo
 * worth having — editing engine/src would not reach a running client until
 * something rebuilt it. So Vite is pointed at the TypeScript sources instead.
 * Dev and build both read source, cross-package edits hot-reload, and no build
 * ordering exists to get wrong.
 *
 * TypeScript still resolves these through `exports` to the emitted .d.ts, via
 * the project references. The two paths agree because they are the same code,
 * and `tsc -b` refreshes dist/ whenever a typecheck or a build runs.
 *
 * The .mts extension is load-bearing. The root package.json is CommonJS so
 * that tools/*.js can go on using require(); .mts is what makes this one file
 * ESM regardless, whichever loader Vite reaches for.
 */

import { resolve } from 'node:path';

import type { Alias } from 'vite';

const packages = resolve(import.meta.dirname, 'packages');

// Anchored patterns rather than bare strings: a string alias in Vite matches
// as a prefix, so '@hexdelve/engine' would also swallow a future
// '@hexdelve/engine-foo'.
export const workspaceAliases: Alias[] = [
	{ find: /^@hexdelve\/shared$/, replacement: resolve(packages, 'shared/src/index.ts') },
	{ find: /^@hexdelve\/engine$/, replacement: resolve(packages, 'engine/src/index.ts') },
	{ find: /^@hexdelve\/scripting$/, replacement: resolve(packages, 'scripting/src/index.ts') },
	{ find: /^@hexdelve\/client$/, replacement: resolve(packages, 'client/src/index.ts') },
];
