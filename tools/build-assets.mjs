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
const scriptingDist = join(root, 'packages', 'scripting', 'dist', 'index.js');

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
	for (const dist of [engineDist, clientDist, scriptingDist]) {
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
	const { AssetLibrary, memoryIO, prefabScripts, prefabTypes } = await import(
		pathToFileURL(engineDist).href
	);
	const { poseFunctions, components } = await import(pathToFileURL(clientDist).href);

	const library = new AssetLibrary(memoryIO(pack), { poseFunctions });
	const entities = await library.index();

	/*
	 * Every system prefab too. They are not reachable from the manifest — a
	 * system is not an entity — so they are found by where they sit, and an
	 * unreachable file is reported below either way.
	 */
	const systems = [];
	for (const path of paths) {
		if (path.startsWith('systems/')) systems.push(await library.system(path));
	}

	/*
	 * And the prefabs, against the components this build actually has. A
	 * prefab naming a type nobody registered spawns an object quietly missing
	 * its behaviour, which is the kind of thing that is noticed a week later
	 * as "the bat does not attack any more".
	 */
	for (const { id, prefab } of [...entities, ...systems]) {
		for (const type of prefabTypes(prefab)) {
			if (!components.has(type)) {
				throw new Error(
					`'${id}' names component type '${type}'; this build has ${components.types.join(', ')}`,
				);
			}
		}
	}

	/*
	 * And the scripts, against the ones this build actually compiles — both the
	 * class a prefab names and the fields it tries to set on it.
	 *
	 * Neither failure is loud at run time, and that is the whole reason to
	 * catch them here. A prefab naming a script that is not there spawns an
	 * object with nothing on it; a prefab setting a parameter the script does
	 * not have gets a warning in a console nobody is reading and the script's
	 * own default instead of the number in the file. Both are right at run
	 * time — a file somebody is halfway through writing must not take a scene
	 * down — and both are wrong in a build.
	 *
	 * The second one is here because it happened. `Combat.spread` was renamed
	 * to `arcPad`, the system prefab went on setting `spread`, and the rule ran
	 * at its default for as long as it took somebody to read the console.
	 */
	const { scriptsFromBundle, parametersOf } = await import(pathToFileURL(scriptingDist).href);
	const { bundleScripts } = await import('./build-scripts.mjs');
	const behaviour = scriptsFromBundle((await bundleScripts()).code);
	let uses = 0;
	for (const { id, prefab } of [...entities, ...systems]) {
		for (const use of prefabScripts(prefab)) {
			const constructor = behaviour.resolve(use.script);
			if (!constructor) {
				throw new Error(
					`'${id}' names script '${use.script}'; ` +
						`this build compiles ${behaviour.names.sort().join(', ')}`,
				);
			}
			uses++;
			if (use.parameters.length === 0) continue;

			/*
			 * A parameter declares itself by its value, so the only way to ask a
			 * class what it exposes is to build one — which `parametersOf` does.
			 * It answers an empty list for a constructor that throws as well as
			 * for a script with nothing to set, so the construction is tried
			 * here to tell those two apart. Getting that wrong would report
			 * every parameter of a broken script as misspelt.
			 */
			try {
				void new constructor();
			} catch (error) {
				throw new Error(
					`'${id}' names script '${use.script}', which will not construct: ` +
						`${error instanceof Error ? error.message : error}`,
				);
			}

			const known = parametersOf(constructor).map((one) => one.key);
			for (const key of use.parameters) {
				if (known.includes(key)) continue;
				throw new Error(
					`'${id}' sets '${key}' on script '${use.script}' (object '${use.on}'), ` +
						`which has ${known.length ? known.sort().join(', ') : 'no parameters'}`,
				);
			}
		}
	}

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
	console.log(
		`checked ${behaviour.names.length} script(s) and ${uses} use(s) of them: ` +
			`${behaviour.names.sort().join(', ')}`,
	);
	if (systems.length) {
		console.log(`checked ${systems.length} system(s): ${systems.map((one) => one.id).join(', ')}`);
	}
	if (orphans.length) {
		console.log(`\nnot reached from the manifest, and packed anyway:\n  ${orphans.join('\n  ')}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
