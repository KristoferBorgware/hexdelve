/*
 * tools/build-assets.mjs — fold the asset tree into one file, and check it.
 *
 *   node tools/build-assets.mjs                 # writes dist/assets.json
 *   node tools/build-assets.mjs somewhere.json  # or wherever you say
 *
 * Two reasons for this to exist, and the second is the important one.
 *
 * A pack is one request instead of thirty. The client fetches `index.yaml`,
 * then an entity, then its rig, its mesh, its clips and its trees, and each is
 * a round trip; over a slow link that is the difference between a world that
 * appears and a world that assembles itself in front of you. `memoryIO` takes
 * exactly the shape written here, so loading from a pack is a one-line change
 * at the call site and nothing else — the readers never learn about it.
 *
 * And it is a CHECK. Every entity in the manifest is loaded on the way past,
 * through the same readers the game uses, so a mesh naming a bone its rig does
 * not have or a tree naming an animation its entity never declared fails the
 * build. A YAML file has no compiler; this is the nearest thing it gets, and
 * it runs before anything is published rather than when somebody opens the
 * editor and finds a character with no arms.
 *
 * ESM and `dist/` rather than `src/`, unlike the other tools here: this one
 * needs the asset readers, and the readers are TypeScript. `npm run build`
 * builds the libraries first, so by the time this runs they are there — and
 * running it on its own says so rather than failing obscurely.
 */

import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const assetRoot = join(root, 'public', 'assets');
const engineDist = join(root, 'packages', 'engine', 'dist', 'index.js');
const clientDist = join(root, 'packages', 'client', 'dist', 'index.js');

/** Only these travel. A pack is asset text, not whatever else is in the tree. */
const PACKABLE = /\.ya?ml$/;

/** Every packable file under `dir`, as paths relative to the asset root. */
async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (PACKABLE.test(entry.name)) out.push(relative(assetRoot, full).split(sep).join('/'));
	}
	return out.sort();
}

async function main() {
	if (!existsSync(assetRoot)) throw new Error(`no asset tree at ${relative(root, assetRoot)}`);
	for (const dist of [engineDist, clientDist]) {
		if (!existsSync(dist)) {
			throw new Error(
				`missing ${relative(root, dist)} — run \`npm run build:libs\` first, ` +
					'since packing reads the asset files through the same readers the game does',
			);
		}
	}

	const paths = await walk(assetRoot);
	/** @type {Record<string, string>} */
	const pack = {};
	let bytes = 0;
	for (const path of paths) {
		const text = await readFile(join(assetRoot, path), 'utf8');
		pack[path] = text;
		bytes += Buffer.byteLength(text);
	}

	// The check. Loading an entity reads everything it links to, so walking the
	// manifest touches the whole graph — and anything the manifest does NOT
	// reach is reported rather than quietly shipped.
	const { AssetLibrary, memoryIO } = await import(pathToFileURL(engineDist).href);
	const { poseFunctions } = await import(pathToFileURL(clientDist).href);

	const library = new AssetLibrary(memoryIO(pack), { poseFunctions });
	const entities = await library.index();
	const reached = new Set(library.paths);

	const orphans = paths.filter((path) => !reached.has(path));

	const out = resolve(root, process.argv[2] ?? join('dist', 'assets.json'));
	await mkdir(resolve(out, '..'), { recursive: true });
	await writeFile(out, JSON.stringify(pack), 'utf8');

	console.log(
		`packed ${paths.length} files (${(bytes / 1024).toFixed(1)} kB of YAML) ` +
			`into ${relative(root, out)}`,
	);
	console.log(`checked ${entities.length} entities: ${entities.map((one) => one.id).join(', ')}`);
	if (orphans.length) {
		console.log(`\nnot reached from the manifest, and packed anyway:\n  ${orphans.join('\n  ')}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
