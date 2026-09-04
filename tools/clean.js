/*
 * tools/clean.js — remove every build output.
 *
 *   node tools/clean.js
 *
 * TypeScript's own `tsc -b --clean` only knows about the outputs it wrote, and
 * misses the Vite builds and the staged Pages tree, so this sweeps the lot.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const targets = [
	'dist',
	'packages/shared/dist',
	'packages/engine/dist',
	'packages/client/dist',
	'packages/client/dist-app',
	'packages/client/dist-lib',
	'packages/editor/dist',
	'packages/editor/dist-types',
	'packages/desktop/dist',
	'packages/desktop/release',
	'packages/editor-desktop/dist',
	'packages/editor-desktop/release',
];

let removed = 0;
for (const target of targets) {
	const full = path.join(root, target);
	if (!fs.existsSync(full)) continue;
	fs.rmSync(full, { recursive: true, force: true });
	console.log('removed ' + target);
	removed++;
}

console.log(removed === 0 ? 'nothing to clean' : 'cleaned ' + removed + ' directories');
