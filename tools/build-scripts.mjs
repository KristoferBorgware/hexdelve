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
 * `scriptsFromBundle` in `@hexdelve/scripting` is what runs it, and its header
 * says why that shape rather than an ES module.
 */

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as esbuild from 'esbuild-wasm';

const root = resolve(import.meta.dirname, '..');

/** Where the scripts live. Outside `src/`, because nothing imports them. */
export const scriptDir = resolve(root, 'packages', 'client', 'scripts');

/** The specifier scripts import, and the global the shim reads it from. */
const SDK_MODULE = '@hexdelve/scripting';
const SDK_GLOBAL = '__HEXDELVE_SCRIPTING__';

/** What the SDK shim re-exports. Kept in step with `scriptSdk` by a test. */
const SDK_NAMES = ['Script', 'param'];

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

/** The script files in a directory, sorted, as bare names. */
export async function scriptFiles(dir = scriptDir) {
	const names = await readdir(dir);
	return names.filter((name) => name.endsWith('.ts')).sort();
}

/**
 * Compile a directory of scripts into one self-contained CommonJS bundle.
 *
 * Every file is an entry, re-exported through a generated module, so one build
 * is one bundle with every class in it and a script may import another.
 *
 * `experimentalDecorators` is the legacy decorator design, which is the one
 * esbuild implements. `@on(Damage) hurt() {}` is metadata about a method and
 * needs nothing else changed — see `packages/scripting/src/events.ts`.
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
		external: [SDK_MODULE],
		tsconfigRaw: {
			compilerOptions: { experimentalDecorators: true, useDefineForClassFields: true },
		},
		plugins: [sdkShim()],
	});

	const output = result.outputFiles?.[0];
	if (!output) throw new Error('the compiler produced nothing');
	return { code: output.text, files };
}

/**
 * `@hexdelve/scripting`, served as a module that reads a global.
 *
 * Bundling the real package would give the scripts their own copy of `Script`,
 * and the host's `instanceof Script` check would then be false for every class
 * in the bundle.
 */
function sdkShim() {
	return {
		name: 'hexdelve:sdk',
		setup(build) {
			const filter = new RegExp(`^${SDK_MODULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
			build.onResolve({ filter }, () => ({ path: 'sdk', namespace: 'sdk' }));
			build.onLoad({ filter: /.*/, namespace: 'sdk' }, () => ({
				contents:
					`const sdk = globalThis[${JSON.stringify(SDK_GLOBAL)}];\n` +
					SDK_NAMES.map((name) => `export const ${name} = sdk[${JSON.stringify(name)}];`).join(
						'\n',
					),
				loader: 'js',
			}));
		},
	};
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
