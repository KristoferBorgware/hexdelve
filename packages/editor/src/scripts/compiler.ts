/*
 * Compiling scripts in the browser, so a saved file reaches a running game.
 *
 * This is the editor's half of the scripting story and it lives here rather
 * than in `@hexdelve/scripting` for one reason: esbuild-wasm is a
 * multi-megabyte WebAssembly toolchain, and the client's whole promise is one
 * ES module with nothing to install. Nobody playing the game will ever compile
 * a script. So the client gets a table built at build time, the editor gets
 * this, and the host cannot tell the two apart.
 *
 * ## How a bundle becomes classes
 *
 * The sources are handed to esbuild through a virtual plugin — there is no
 * file system here, so nothing is read from disk and everything is served out
 * of a `Map`. Three resolutions matter:
 *
 *   the entry      a generated module that re-exports every script file, so one
 *                  build produces one bundle with every class in it
 *   a script       served from the map by its path
 *   the SDK        `@hexdelve/scripting` is rewritten to read from a global
 *                  this file sets before evaluating. Bundling the real package
 *                  would give the scripts their OWN copy of `Script`, and
 *                  `instanceof Script` would then be false for every one of
 *                  them — which is the check the host uses to know it has a
 *                  script at all.
 *
 * Running the result is not this file's job. `scriptsFromBundle` in
 * `@hexdelve/scripting` does it, and the shipped client uses the same call on a
 * bundle compiled by `tools/build-scripts.mjs` — so the editor and the game are
 * running scripts through one code path, and only the compiling differs.
 *
 * ## What a failure does
 *
 * Nothing. A compile error leaves the previous module running and reports
 * itself; that is the difference between an editor somebody can work in and
 * one that goes blank every time a file is half-typed. The host's own rules
 * handle the rest — see its header.
 */

import * as esbuild from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import {
	noScripts,
	SCRIPT_SDK_MODULE,
	scriptSdkShim,
	scriptsFromBundle,
	type ScriptProvider,
} from '@hexdelve/scripting';

/** The one esbuild the page gets. Initialising twice is an error it throws. */
let starting: Promise<void> | null = null;

function start(): Promise<void> {
	starting ??= esbuild.initialize({ wasmURL }).catch((error: unknown) => {
		// A dev-server reload re-runs this module against an esbuild that is
		// already up. That is not a failure, and treating it as one would make
		// every hot reload of the editor itself break the scripts inside it.
		if (String(error).includes('more than once')) return;
		starting = null;
		throw error;
	});
	return starting;
}

export interface CompileResult {
	readonly provider: ScriptProvider;
	/** What went wrong, or null. The previous provider stands when this is set. */
	readonly error: string | null;
	/** The class names the bundle produced. */
	readonly names: readonly string[];
}

/**
 * Compile a set of script sources into a provider.
 *
 * `sources` is path to text — whatever the editor last read or was handed by
 * somebody typing. The paths only matter to the error messages and to the
 * entry module's imports; nothing here touches a disk.
 */
export async function compileScripts(
	sources: ReadonlyMap<string, string>,
	previous: ScriptProvider = noScripts,
): Promise<CompileResult> {
	if (sources.size === 0) {
		return { provider: noScripts, error: null, names: [] };
	}

	let code: string;
	try {
		await start();
		code = await bundle(sources);
	} catch (error) {
		return { provider: previous, error: message(error), names: previous.names };
	}

	let provider: ScriptProvider;
	try {
		provider = scriptsFromBundle(code);
	} catch (error) {
		return { provider: previous, error: message(error), names: previous.names };
	}

	return { provider, error: null, names: provider.names };
}

async function bundle(sources: ReadonlyMap<string, string>): Promise<string> {
	const result = await esbuild.build({
		entryPoints: ['hexdelve:entry'],
		bundle: true,
		format: 'cjs',
		write: false,
		logLevel: 'silent',
		target: 'es2022',
		// The legacy decorator design, which is the one esbuild implements, and
		// what `@on` in `@hexdelve/scripting` is written against.
		tsconfigRaw: {
			compilerOptions: { experimentalDecorators: true, useDefineForClassFields: true },
		},
		plugins: [virtualFiles(sources)],
	});
	const output = result.outputFiles?.[0];
	if (!output) throw new Error('the compiler produced nothing');
	return output.text;
}

/** Everything esbuild would have read from a disk, served from memory. */
function virtualFiles(sources: ReadonlyMap<string, string>): esbuild.Plugin {
	return {
		name: 'hexdelve:scripts',
		setup(build) {
			build.onResolve({ filter: /^hexdelve:entry$/ }, () => ({
				path: 'entry',
				namespace: 'entry',
			}));
			build.onLoad({ filter: /.*/, namespace: 'entry' }, () => ({
				// One module re-exporting all of them, so one build is one bundle
				// and a script can import another without a second pass.
				contents: [...sources.keys()]
					.map((path) => `export * from ${JSON.stringify(`hexdelve:user:${path}`)};`)
					.join('\n'),
				loader: 'ts',
			}));

			build.onResolve({ filter: /^hexdelve:user:/ }, (args) => ({
				path: args.path.slice('hexdelve:user:'.length),
				namespace: 'user',
			}));
			build.onLoad({ filter: /.*/, namespace: 'user' }, (args) => ({
				contents: sources.get(args.path) ?? '',
				loader: 'ts',
			}));

			// A script importing another script by a relative path.
			build.onResolve({ filter: /^\.\.?\// , namespace: 'user' }, (args) => {
				const path = resolveRelative(args.importer, args.path);
				return { path, namespace: 'user' };
			});

			build.onResolve({ filter: new RegExp(`^${escape(SCRIPT_SDK_MODULE)}$`) }, () => ({
				path: 'sdk',
				namespace: 'sdk',
			}));
			build.onLoad({ filter: /.*/, namespace: 'sdk' }, () => ({
				contents: scriptSdkShim(),
				loader: 'js',
			}));
		},
	};
}

/** `./Other.js` next to `dir/Thing.ts`, as the source map of paths sees it. */
function resolveRelative(importer: string, request: string): string {
	const parts = importer.split('/').slice(0, -1);
	for (const step of request.replace(/\.js$/, '.ts').split('/')) {
		if (step === '.' || step === '') continue;
		if (step === '..') parts.pop();
		else parts.push(step);
	}
	return parts.join('/');
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function message(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
