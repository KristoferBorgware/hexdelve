/*
 * tools/bake-buildings.mjs — write the yard's structures down as mesh files.
 *
 *   node tools/bake-buildings.mjs            # write them
 *   node tools/bake-buildings.mjs --check    # bake, compare, write nothing
 *
 * A building is worth deriving and not worth shipping as a function. The
 * cabin's logs interlock because the side walls sit half a course higher; the
 * front wall splits round the doorway until the courses clear the lintel; the
 * roof is hexagons tiled across two slope planes. None of that is a list, and
 * a list written by hand would lose the reason every number is what it is.
 *
 * But a building that only ever exists as code cannot be opened and nudged,
 * and the editor cannot show it. So the construction stays in
 * `@hexdelve/authoring` as the thing that DERIVES the shape, and this writes
 * down what it derived — the same bargain `bake-clips.mjs` struck with the pose
 * functions.
 *
 * The seeded jitter is frozen by the bake, and that is a gain: after this, one
 * plank can be repainted without re-deriving the wall it is in.
 *
 * `--check` is the form for a build: it bakes and fails if a file on disk has
 * drifted from what the function now produces, without touching the tree.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const meshRoot = join(root, 'public', 'assets', 'meshes');
const engineDist = join(root, 'packages', 'engine', 'dist', 'index.js');
const sharedDist = join(root, 'packages', 'shared', 'dist', 'index.js');
const authoringDist = join(root, 'packages', 'authoring', 'dist', 'index.js');

/** The one seed the yard has always been built with. */
const SEED = 37;

function need(path) {
	if (existsSync(path)) return path;
	throw new Error(
		`missing ${relative(root, path)} — run \`npm run build:libs\` first, since this bakes ` +
			'through the same readers the game uses',
	);
}

/** One structure, as the mesh reader will read it back. */
function meshFile(engine, structure) {
	return engine.emitYaml({
		id: structure.id,
		name: structure.name,
		parts: structure.prisms.map((prism) => ({
			bone: 'root',
			at: [...prism.at],
			size: [...prism.size],
			...(prism.euler.every((one) => one === 0) ? {} : { euler: [...prism.euler] }),
			color: prism.color,
			...(prism.unlit ? { unlit: true } : {}),
		})),
	});
}

async function main() {
	const check = process.argv.includes('--check');
	const engine = await import(pathToFileURL(need(engineDist)).href);
	const shared = await import(pathToFileURL(need(sharedDist)).href);
	const authoring = await import(pathToFileURL(need(authoringDist)).href);

	const structures = authoring.bakeStructures(shared.makeRandom(SEED));
	let drifted = 0;

	for (const structure of structures) {
		const path = join(meshRoot, `${structure.id}.mesh.yaml`);
		const text = meshFile(engine, structure);
		const before = existsSync(path) ? await readFile(path, 'utf8') : null;
		const same = before === text;

		if (check) {
			if (!same) drifted++;
			console.log(
				`${structure.id}: ${structure.prisms.length} prisms — ` +
					(same ? 'unchanged' : before === null ? 'MISSING' : 'DRIFTED'),
			);
			continue;
		}

		if (!same) await writeFile(path, text, 'utf8');
		console.log(
			`${structure.id}: ${structure.prisms.length} prisms -> ` +
				`${relative(root, path)}${same ? ' (unchanged)' : ''}`,
		);
		if (structure.chimney) {
			console.log(`  vents at [${structure.chimney.map((one) => one.toFixed(3)).join(', ')}]`);
		}
	}

	if (drifted > 0) {
		console.error(
			`\n${drifted} mesh file(s) no longer match what the construction produces. ` +
				'Run `node tools/bake-buildings.mjs` to write them.',
		);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
