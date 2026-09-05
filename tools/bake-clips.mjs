/*
 * tools/bake-clips.mjs — turn an entity's procedural animations into clips.
 *
 *   node tools/bake-clips.mjs                 # every job there is
 *   node tools/bake-clips.mjs hellhound       # or the ones whose id matches
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
 * What to bake is `bakeJobs`, beside the pose functions, rather than the
 * entity files. An entity that names a clip no longer says what the clip came
 * from, so reading the tree would mean a gait could be tuned once and never
 * again — the second bake would have nothing left to read.
 *
 * `--check` is the form for a build: it bakes everything and fails if any clip
 * has drifted from its source, without touching the tree.
 *
 * ESM and `dist/` for the same reason as build-assets.mjs: this reads the asset
 * files through the readers the game uses, and those are TypeScript. The
 * functions come from `@hexdelve/authoring` rather than from the client,
 * because the client does not have them — that is the point of the split.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const assetRoot = join(root, 'public', 'assets');
const engineDist = join(root, 'packages', 'engine', 'dist', 'index.js');
const authoringDist = join(root, 'packages', 'authoring', 'dist', 'index.js');

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

/**
 * How far a looping source may be from closing on itself before it is called
 * out. A clip loops whether or not what it was baked from did, so a gap here
 * is played as a jump every cycle.
 */
const WRAP_LIMIT = 0.01;

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
	const maxKeys = numberFlag(argv, 'max-keys', 128);

	for (const dist of [engineDist, authoringDist]) {
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

	const { AssetLibrary, memoryIO, bakeClip, writeClip, poseFunctionAnimation } = await import(
		pathToFileURL(engineDist).href
	);
	const { poseFunctions, bakeJobs } = await import(pathToFileURL(authoringDist).href);

	const library = new AssetLibrary(memoryIO(pack));
	const jobs = wanted.length === 0 ? bakeJobs : bakeJobs.filter((job) => wanted.some((one) => job.id.includes(one)));

	for (const one of wanted) {
		if (!bakeJobs.some((job) => job.id.includes(one))) {
			throw new Error(`nothing to bake matches '${one}'; there is ${bakeJobs.map((j) => j.id).join(', ')}`);
		}
	}

	let baked = 0;
	let worstOverall = 0;
	const failures = [];
	const open = [];

	for (const job of jobs) {
		const fn = poseFunctions.get(job.procedural);
		if (fn === undefined) {
			throw new Error(
				`${job.id}: no pose function called '${job.procedural}'; there is ${poseFunctions.ids.join(', ')}`,
			);
		}
		// The rig path is written as an entity writes it, from inside `clips/`.
		const rig = await library.rig(job.rig.replace('../', ''));
		const args = job.args ?? {};
		const duration =
			job.duration ?? (typeof fn.duration === 'function' ? fn.duration(args) : fn.duration);
		const contacts = job.contacts ?? fn.contacts ?? [];
		// A job states a moment as a fraction of the cycle; a clip carries it in
		// seconds, which is what a player reading it back divides by again.
		const events = (job.events ?? []).map((one) => ({
			t: Math.round(one.at * duration * 1e6) / 1e6,
			name: one.name,
		}));

		// Built through the same reader the game uses, so what is baked is what
		// an entity naming this function would have played.
		const animation = poseFunctionAnimation(fn, rig, args, duration, {
			name: job.id,
			label: job.label,
			sync: false,
			contacts,
		});

		const result = bakeClip(
			job.id,
			duration,
			animation.loop ? 'loop' : 'hold',
			animation.sample,
			{ anchors: contacts, tolerance, maxKeys },
			events,
		);
		const { keys, bones, worst, exhausted, wrapGap } = result.report;
		worstOverall = Math.max(worstOverall, worst.error);

		const file = `clips/${job.id}.clip.yaml`;
		const note =
			(exhausted ? '  REFINEMENT EXHAUSTED' : '') +
			(wrapGap > WRAP_LIMIT ? `  DOES NOT CLOSE (${wrapGap.toExponential(2)})` : '');
		console.log(
			`${file.padEnd(38)} ${String(keys).padStart(3)} keys  ${String(bones).padStart(3)} bones  ` +
				`worst ${worst.error.toExponential(2)} on ${worst.bone}.${worst.channel}${note}`,
		);
		if (worst.error > tolerance) {
			failures.push(`${file}: ${worst.error.toExponential(2)} on ${worst.bone}.${worst.channel}`);
		}
		if (wrapGap > WRAP_LIMIT) {
			open.push(`${file}: ${wrapGap.toExponential(2)} between the end of a cycle and the start of it`);
		}

		if (!check) {
			const text = writeClip({
				id: job.id,
				name: job.label,
				rig: job.rig,
				duration,
				loop: animation.loop ? 'loop' : 'hold',
				events,
				poses: result.poses,
			});
			await writeFile(join(assetRoot, file), text, 'utf8');
		}
		baked++;
	}

	if (baked === 0) {
		console.log('nothing to bake: no job matched');
		return;
	}
	console.log(`\n${baked} clip(s), worst ${worstOverall.toExponential(2)} against a tolerance of ${tolerance}`);
	if (open.length > 0) {
		console.error(`\n${open.length} source(s) do not close on themselves, so the clip jumps once a cycle:`);
		for (const line of open) console.error(`  ${line}`);
		console.error('  A rhythm in the pose runs at a rate that does not divide into the duration.');
		process.exitCode = 1;
	}
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
