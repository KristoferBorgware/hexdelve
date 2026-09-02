/*
 * tools/build-pages.js — stage everything GitHub Pages should serve.
 *
 *   npm run build:pages          # builds the packages, then runs this
 *   node tools/build-pages.js    # stage only, using whatever is already built
 *
 * The site is three things published side by side:
 *
 *   /              the landing page, generated from the labs themselves
 *   /labs/         labs 01-09, plain HTML and JS, exactly as they are in the repo
 *   /editor/       the React editor
 *   /client/       the standalone client build the editor embeds
 *
 * Staging into dist/pages rather than publishing the repo root matters now
 * that there is a node_modules: uploading "." would upload that too.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { buildIndex } = require('./build-index.js');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'pages');

function copyDir(from, to, what) {
	if (!fs.existsSync(from)) {
		throw new Error(
			'Missing ' + what + ' at ' + path.relative(root, from) + ' — run `npm run build` first.',
		);
	}
	fs.cpSync(from, to, { recursive: true });
	console.log('staged ' + what);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

copyDir(path.join(root, 'labs'), path.join(out, 'labs'), 'labs');
copyDir(path.join(root, 'packages', 'editor', 'dist'), path.join(out, 'editor'), 'editor');
copyDir(path.join(root, 'packages', 'client', 'dist-app'), path.join(out, 'client'), 'client');

// The landing page is generated twice on purpose: once into the repo root,
// where it is committed so the labs can be browsed from a clone, and once into
// the staging tree, so what is deployed can never be a stale copy.
buildIndex(root);
buildIndex(out);

console.log('pages staged in ' + path.relative(root, out));
