/*
 * tools/build-scripts.mjs — compile the client's scripts into one bundle.
 *
 *   node tools/build-scripts.mjs                    # writes dist/scripts.js
 *   node tools/build-scripts.mjs somewhere/x.js     # or wherever you say
 *
 * The scripts are game behaviour and they are not part of any application's
 * module graph. Nothing imports `packages/client/scripts/` — the client fetches
 * what this produces, the same way it fetches an asset, and the editor compiles
 * the same directory in the browser so a save reaches a running game.
 *
 * Three things follow from compiling them apart, and all three are the reason
 * to do it.
 *
 *   A broken script is a failure HERE, named, and not a page that will not
 *   load. It used to be the second thing: the client imported its own script
 *   table, so every application build parsed every script, and a half-typed
 *   file stopped the editor from starting.
 *
 *   There is no table to keep in step. The directory is the list. A file added
 *   is a script shipped, and nothing has to be written down twice.
 *
 *   The scripts answer to one compiler rather than three. esbuild does it here
 *   and again in the editor; Vite and vitest never see them. That is what lets
 *   a script use syntax — decorators, in particular — without every build tool
 *   in the repository having to agree about it first.
 *
 * The output is CommonJS that requires nothing and reads its SDK from a global.
 * `scriptsFromBundle` in the engine is what runs it, and its header
 * says why that shape rather than an ES module.
 */

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild-wasm';

const root = resolve(import.meta.dirname, '..');

/** Where the scripts live. Outside `src/`, because nothing imports them. */
export const scriptDir = resolve(root, 'packages', 'client', 'scripts');

/**
 * What a script may import, and what the shims stand in for.
 *
 * Three, because a script is where the game's behaviour lives and behaviour
 * acts through the game's library: the engine for objects, components and
 * events; the client for hexagons, tiles, turn order and the strides; shared
 * for the maths underneath both.
 *
 * Read from `dist/` rather than listed here. A script may use anything these
 * export, so each shim's export list IS that package's — writing it down would
 * be the same list in two places, and the one here would be the stale one.
 */
const SDK_MODULES = {
	'@hexdelve/engine': resolve(root, 'packages', 'engine', 'dist', 'index.js'),
	'@hexdelve/client': resolve(root, 'packages', 'client', 'dist', 'index.js'),
	'@hexdelve/shared': resolve(root, 'packages', 'shared', 'dist', 'index.js'),
};

let started = null;

function start() {
	started ??= esbuild.initialize({}).catch((error) => {
		// A second initialise in one process is an error esbuild throws rather
		// than a problem; the dev server hits it whenever this module reloads.
		if (String(error).includes('more than once')) return;
		started = null;
		throw error;
	});
	return started;
}

/**
 * The script files in a directory, sorted, as bare names.
 *
 * `.d.ts` is excluded because it is not a script. Nothing should put one here,
 * but a stray `tsc` run against the wrong project emits declarations beside the
 * sources, and compiling one as an entry would export types as though they were
 * behaviour. The editor's listing route filters the same way.
 */
export async function scriptFiles(dir = scriptDir) {
	const names = await readdir(dir);
	return names.filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts')).sort();
}

/**
 * Compile a directory of scripts into one self-contained CommonJS bundle.
 *
 * Every file is an entry, re-exported through a generated module, so one build
 * is one bundle with every class in it and a script may import another.
 *
 * `experimentalDecorators` is the legacy decorator design, which is the one
 * esbuild implements. `@on(Damage) hurt() {}` is metadata about a method and
 * needs nothing else changed — see `packages/engine/src/scripting/events.ts`.
 */
export async function bundleScripts(dir = scriptDir) {
	if (!existsSync(dir)) throw new Error(`no script directory at ${relative(root, dir)}`);
	const files = await scriptFiles(dir);
	if (files.length === 0) return { code: 'module.exports = {};\n', files };

	await start();
	const result = await esbuild.build({
		stdin: {
			contents: files.map((name) => `export * from ${JSON.stringify(`./${name}`)};`).join('\n'),
			resolveDir: dir,
			sourcefile: 'scripts.ts',
			loader: 'ts',
		},
		bundle: true,
		format: 'cjs',
		write: false,
		logLevel: 'silent',
		target: 'es2022',
		external: Object.keys(SDK_MODULES),
		tsconfigRaw: {
			compilerOptions: { experimentalDecorators: true, useDefineForClassFields: true },
		},
		plugins: [sdkShim(await shimTexts())],
	});

	const output = result.outputFiles?.[0];
	if (!output) throw new Error('the compiler produced nothing');
	return { code: output.text, files };
}

/**
 * Each SDK package, served as a module that reads a global.
 *
 * Bundling the real engine would give the scripts their OWN copy of `Script`,
 * and the host's `instanceof Script` check would then be false for every class
 * in the bundle. Each shim's text is generated by the packages themselves, from
 * their own exports, so a name added to one needs no list here.
 */
function sdkShim(texts) {
	const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return {
		name: 'hexdelve:sdk',
		setup(build) {
			for (const [specifier, text] of Object.entries(texts)) {
				const namespace = `sdk:${specifier}`;
				build.onResolve({ filter: new RegExp(`^${escape(specifier)}$`) }, () => ({
					path: specifier,
					namespace,
				}));
				build.onLoad({ filter: /.*/, namespace }, () => ({ contents: text, loader: 'js' }));
			}
		},
	};
}

/**
 * The shim texts, asked of each package's own build.
 *
 * `dist/` rather than `src/`, like `build-assets.mjs` and for the same reason:
 * this needs runtime exports, and the packages are TypeScript.
 * `npm run build:libs` puts them there first.
 */
/**
 * The three namespaces, loaded from `dist/`, for a tool that RUNS a bundle.
 *
 * `scriptsFromBundle` needs every module the bundle imports, and a caller that
 * offers only the engine gets a refusal naming the one it left out. A test
 * under vitest passes its OWN imports instead — the namespaces have to be the
 * same module instances the code under test is using, or an `instanceof` across
 * the seam is false.
 */
export async function sdkNamespaces() {
	const loaded = {};
	for (const [specifier, dist] of Object.entries(SDK_MODULES)) {
		loaded[specifier] = await import(pathToFileURL(dist).href);
	}
	return loaded;
}

async function shimTexts() {
	for (const [specifier, dist] of Object.entries(SDK_MODULES)) {
		if (existsSync(dist)) continue;
		throw new Error(
			`missing ${relative(root, dist)} — run \`npm run build:libs\` first, ` +
				`since the scripts are compiled against what ${specifier} actually exports`,
		);
	}

	// The engine writes every shim, its own included: `scriptSdkShim` is the
	// one that knows which global a specifier is rewritten to.
	const engine = await import(pathToFileURL(SDK_MODULES['@hexdelve/engine']).href);
	const texts = {};
	for (const [specifier, dist] of Object.entries(SDK_MODULES)) {
		texts[specifier] = engine.scriptSdkShim(await import(pathToFileURL(dist).href), specifier);
	}
	return texts;
}

async function main() {
	const { code, files } = await bundleScripts();
	const out = resolve(root, process.argv[2] ?? join('dist', 'scripts.js'));
	await mkdir(resolve(out, '..'), { recursive: true });
	await writeFile(out, code, 'utf8');
	console.log(
		`compiled ${files.length} script(s) into ${relative(root, out)} ` +
			`(${(Buffer.byteLength(code) / 1024).toFixed(1)} kB): ${files.join(', ')}`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
