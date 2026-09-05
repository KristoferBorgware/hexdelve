/*
 * tools/bake-clips.mjs — turn an entity's procedural animations into clips.
 *
 *   node tools/bake-clips.mjs                 # every entity that has one
 *   node tools/bake-clips.mjs hellhound       # or just these
 *   node tools/bake-clips.mjs --check         # bake, report, write nothing
 *
 * A pose function is a good way to WORK OUT a cycle and a poor way to ship
 * one: it cannot be opened and nudged, and half of it is arguments that a
 * blend tree already expresses better. So the function stays as the thing that
 * derives the motion, and this writes down what it derived.
 *
 * What comes out is a clip in the same pose-major shape as the hand-written
 * ones — a handful of moments, each naming only the bones doing something —
 * because a baked clip nobody can edit is worse than the function it replaced.
 * See `bakeClip`, which places the keys and reports how far the result sits
 * from what it was baked from.
 *
 * `--check` is the form for a build: it bakes everything and fails if any clip
 * has drifted from its source, without touching the tree.
 *
 * ESM and `dist/` for the same reason as build-assets.mjs: this reads the
 * asset files through the readers the game uses, and those are TypeScript.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const assetRoot = join(root, 'public', 'assets');
const engineDist = join(root, 'packages', 'engine', 'dist', 'index.js');
const clientDist = join(root, 'packages', 'client', 'dist', 'index.js');

/**
 * How far a baked channel may sit from the function it came from, in radians
 * for a rotation and metres for a translation.
 *
 * Chosen against the FEET rather than against the joints, because that is what
 * a gait is judged on: a planted paw drifts under a millimetre at this figure
 * and the measured ground speed is unchanged to five decimal places, where at
 * five thousandths the front paw wanders four millimetres through its stance.
 * The front pair is the one that decides it — it hangs off the chest, so the
 * error of every rotation above it lands in the same paw.
 */
const TOLERANCE = 0.002;

/** A flag's number, or what the tool uses when nobody says. */
const numberFlag = (argv, name, fallback) => {
	const hit = argv.find((one) => one.startsWith(`--${name}=`));
	return hit === undefined ? fallback : Number(hit.slice(name.length + 3));
};

async function walk(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(full)));
		else if (/\.ya?ml$/.test(entry.name)) out.push(relative(assetRoot, full).split(sep).join('/'));
	}
	return out.sort();
}

async function main() {
	const argv = process.argv.slice(2);
	const check = argv.includes('--check');
	const wanted = argv.filter((one) => !one.startsWith('--'));
	const tolerance = numberFlag(argv, 'tolerance', TOLERANCE);
	const maxKeys = numberFlag(argv, 'max-keys', 64);

	for (const dist of [engineDist, clientDist]) {
		if (!existsSync(dist)) {
			throw new Error(
				`missing ${relative(root, dist)} — run \`npm run build:libs\` first, ` +
					'since baking reads the asset files through the same readers the game does',
			);
		}
	}

	const paths = await walk(assetRoot);
	const pack = {};
	for (const path of paths) pack[path] = await readFile(join(assetRoot, path), 'utf8');

	const { AssetLibrary, memoryIO, bakeClip, writeClip, entityAnimations, entityRig } =
		await import(pathToFileURL(engineDist).href);
	const { poseFunctions } = await import(pathToFileURL(clientDist).href);

	const library = new AssetLibrary(memoryIO(pack), { poseFunctions });
	const index = await library.index();
	const ids = wanted.length > 0 ? wanted : index.map((one) => one.id);

	for (const id of wanted) {
		if (!index.some((one) => one.id === id)) {
			throw new Error(`no entity '${id}' in the manifest; it has ${index.map((o) => o.id).join(', ')}`);
		}
	}

	let baked = 0;
	let worstOverall = 0;
	const failures = [];

	for (const id of ids) {
		const entity = await library.entity(`entities/${id}.entity.yaml`);
		const rig = entityRig(entity);
		if (!rig) continue;

		for (const [name, animation] of entityAnimations(entity)) {
			if (animation.kind !== 'procedural') continue;

			const result = bakeClip(
				name,
				animation.duration,
				animation.loop ? 'loop' : 'hold',
				animation.sample,
				{ anchors: animation.contacts, tolerance, maxKeys },
			);
			const { keys, bones, worst, exhausted } = result.report;
			worstOverall = Math.max(worstOverall, worst.error);

			const file = `clips/${id}-${name}.clip.yaml`;
			const note = exhausted ? '  REFINEMENT EXHAUSTED' : '';
			console.log(
				`${file.padEnd(38)} ${String(keys).padStart(3)} keys  ${String(bones).padStart(3)} bones  ` +
					`worst ${worst.error.toExponential(2)} on ${worst.bone}.${worst.channel}${note}`,
			);
			if (worst.error > tolerance) failures.push(`${file}: ${worst.error.toExponential(2)} on ${worst.bone}.${worst.channel}`);

			if (!check) {
				const text = writeClip({
					id: `${id}-${name}`,
					name: animation.label,
					rig: `../rigs/${rig.id}.rig.yaml`,
					duration: animation.duration,
					loop: animation.loop ? 'loop' : 'hold',
					poses: result.poses,
				});
				await writeFile(join(assetRoot, file), text, 'utf8');
			}
			baked++;
		}
	}

	if (baked === 0) {
		console.log('nothing to bake: no entity named has a procedural animation');
		return;
	}
	console.log(`\n${baked} clip(s), worst ${worstOverall.toExponential(2)} against a tolerance of ${tolerance}`);
	if (failures.length > 0) {
		console.error(`\n${failures.length} clip(s) drifted from what they were baked from:`);
		for (const line of failures) console.error(`  ${line}`);
		process.exitCode = 1;
	} else if (check) {
		console.log('every clip still reproduces its source');
	}
}

main().catch((error) => {
	console.error(error.message ?? error);
	process.exitCode = 1;
});
