/*
 * Compiling scripts in the browser, so a saved file reaches a running game.
 *
 * This is the editor's half of the scripting story and it lives here rather
 * than in `@hexdelve/engine` for one reason: esbuild-wasm is a
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
 *   the SDK        `@hexdelve/engine` is rewritten to read from a global
 *                  this file sets before evaluating. Bundling the real package
 *                  would give the scripts their OWN copy of `Script`, and
 *                  `instanceof Script` would then be false for every one of
 *                  them — which is the check the host uses to know it has a
 *                  script at all.
 *
 * Running the result is not this file's job. `scriptsFromBundle` in
 * `@hexdelve/engine` does it, and the shipped client uses the same call on a
 * bundle compiled by `tools/build-scripts.mjs` — so the editor and the game are
 * running scripts through one code path, and only the compiling differs.
 *
 * ## What a failure does
 *
 * Nothing. A compile error leaves the previous module running and reports
 * itself; that is the difference between an editor somebody can work in and
 * one that goes blank every time a file is half-typed. The host's own rules
 * handle the rest — see its header.
 *
 * It reports itself TWICE, in two shapes, because there are two readers. The
 * message is one string for a panel to show. The diagnostics are the same
 * errors with the file and the position esbuild put on them, which is what the
 * code editor turns into a red squiggle on the line that is wrong. Neither is
 * derived from the other by parsing text: esbuild hands over structured
 * errors, and throwing that structure away only to recover it with a regular
 * expression is how a stray colon in an error message becomes a marker on
 * line 0 of a file that does not exist.
 */

import * as esbuild from 'esbuild-wasm';
import wasmURL from 'esbuild-wasm/esbuild.wasm?url';
import * as engine from '@hexdelve/engine';
import * as client from '@hexdelve/client';
import * as shared from '@hexdelve/shared';
import {
	noScripts,
	scriptSdkShim,
	scriptsFromBundle,
	type ScriptModules,
	type ScriptProvider,
} from '@hexdelve/engine';

/**
 * What a script may import here, and the same three the shipped bundle gets.
 *
 * The namespaces are the editor's OWN copies of the packages, which is what
 * makes a compiled script's `instanceof` agree with the running game's: the
 * editor and the game it is previewing are one page and one module graph.
 */
const SDK_MODULES: ScriptModules = {
	'@hexdelve/engine': engine,
	'@hexdelve/client': client,
	'@hexdelve/shared': shared,
};

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

/** One error, where the compiler put it. */
export interface ScriptDiagnostic {
	/** The script it is in, named as the store names it, or null. */
	readonly file: string | null;
	/** One-based, as an editor counts. */
	readonly line: number;
	/** Zero-based, as esbuild counts. */
	readonly column: number;
	/** How many characters it covers, when the compiler said. */
	readonly length: number;
	readonly text: string;
}

export interface CompileResult {
	readonly provider: ScriptProvider;
	/** What went wrong, or null. The previous provider stands when this is set. */
	readonly error: string | null;
	/** The same failure, placed — empty when nothing failed, or when it had no place. */
	readonly diagnostics: readonly ScriptDiagnostic[];
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
		return { provider: noScripts, error: null, diagnostics: [], names: [] };
	}

	let code: string;
	try {
		await start();
		code = await bundle(sources);
	} catch (error) {
		return {
			provider: previous,
			error: message(error),
			diagnostics: diagnose(error),
			names: previous.names,
		};
	}

	let provider: ScriptProvider;
	try {
		provider = scriptsFromBundle(code, SDK_MODULES);
	} catch (error) {
		// A bundle that compiled and would not evaluate. There is no position
		// to report: the failure is in code esbuild wrote, not in a line
		// anybody typed.
		return { provider: previous, error: message(error), diagnostics: [], names: previous.names };
	}

	return { provider, error: null, diagnostics: [], names: provider.names };
}

/**
 * esbuild's own errors, in the terms the editor names files by.
 *
 * The paths come back namespaced — `user:Combat.ts`, because that is the
 * namespace the virtual plugin resolved them into — and the editor knows the
 * file as `Combat.ts`, so the prefix comes off here rather than at every
 * reader.
 */
function diagnose(error: unknown): ScriptDiagnostic[] {
	const errors = (error as { errors?: esbuild.Message[] }).errors;
	if (!Array.isArray(errors)) return [];
	return errors.map((problem) => {
		const at = problem.location;
		return {
			file: at ? at.file.replace(/^user:/, '') : null,
			line: at?.line ?? 1,
			column: at?.column ?? 0,
			length: at?.length ?? 0,
			text: problem.text,
		};
	});
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
		// what `@on` in `@hexdelve/engine` is written against.
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

			for (const [specifier, namespace] of Object.entries(SDK_MODULES)) {
				const bucket = `sdk:${specifier}`;
				build.onResolve({ filter: new RegExp(`^${escape(specifier)}$`) }, () => ({
					path: specifier,
					namespace: bucket,
				}));
				build.onLoad({ filter: /.*/, namespace: bucket }, () => ({
					contents: scriptSdkShim(namespace, specifier),
					loader: 'js',
				}));
			}
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

/**
 * What went wrong, said the way a script author would say it.
 *
 * esbuild names the files by the namespace the virtual plugin put them in, so
 * an error reads `user:Combat.ts:31:8`. The namespace is an implementation
 * detail of this file and means nothing to whoever is reading the message.
 */
function message(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\buser:/g, '');
}
