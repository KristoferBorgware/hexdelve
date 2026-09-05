/*
 * Turning a compiled bundle of scripts into classes the host can run.
 *
 * Scripts are not part of any application's module graph. They are compiled
 * separately — by `tools/build-scripts.mjs` for a shipped client, by the
 * editor's in-browser compiler for a save that has to reach a running game —
 * and both produce the same thing: one self-contained CommonJS module that
 * requires nothing. This is what evaluates it.
 *
 * ## Why a bundle rather than an import
 *
 * A script in the module graph is a script every build has to parse. That is
 * how a half-typed file used to stop the editor from starting: the client
 * imported its own script table, so oxc transformed every script on page load
 * whether or not the editor was compiling them itself. Compiling them apart
 * from the applications is what makes a broken script a failure of the script
 * step and nothing else.
 *
 * It also means the scripts answer to ONE compiler. The applications are built
 * by Vite, the tests run under vitest, and neither has to agree with the other
 * about what TypeScript a script may contain — esbuild compiles them in both
 * the tool and the editor, and this evaluates what it produced.
 *
 * ## The SDK globals
 *
 * A bundle imports the packages a script is allowed to see, and each of those
 * imports is rewritten by whoever compiled it to read from a global this module
 * sets. Bundling the real packages into the scripts would give them their OWN
 * copy of `Script`, and `value.prototype instanceof Script` — the check below,
 * and the only way the host knows it has a script at all — would then be false
 * for every class in the bundle.
 *
 * There is more than one because a script is where the game's behaviour lives,
 * and behaviour acts through the game's library: a hexagon, a tile, a turn
 * order, a stride. None of that is the engine's — an engine that knew what an
 * Angband energy table was would be the wrong shape — so the client is offered
 * beside it rather than emptied into it.
 *
 * ## `new Function`, not `import()`
 *
 * A CommonJS module that requires nothing and reads its SDK from a global needs
 * no loader, no blob URL and no import map. That is what makes this one code
 * path work unchanged in a browser, in Node and under the test runner.
 */

import { Script } from '../scene/components/Script.js';
import type { ComponentType } from '../scene/components/parameters.js';
import type { ScriptProvider } from './ScriptHost.js';

/** The specifier a script imports for the engine, and the global it becomes. */
export const SCRIPT_SDK_MODULE = '@hexdelve/engine';
export const SCRIPT_SDK_GLOBAL = '__HEXDELVE_ENGINE__';

/**
 * The globals a bundle's imports are rewritten to, by specifier.
 *
 * Derived rather than listed, so a fourth module is a name in one place. The
 * engine keeps the global it has always had, because that string appears in
 * compiled bundles and in a test that reads one.
 */
export function scriptModuleGlobal(specifier: string): string {
	if (specifier === SCRIPT_SDK_MODULE) return SCRIPT_SDK_GLOBAL;
	return `__HEXDELVE_${specifier.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}__`;
}

/**
 * One module's runtime names, as a namespace object.
 *
 * There was a curated list here once — four names, on the argument that a
 * script should see a sanctioned surface and nothing else. That argument is
 * gone, and it is worth saying why rather than leaving the absence to be
 * puzzled over. A script IS a component: it reaches game objects, components
 * and events, and a keyhole view bought nothing it did not already have while
 * costing the one thing that matters here — a script author's autocomplete
 * telling the truth. What is offered is exactly what the declarations say, so
 * a name that typechecks runs.
 */
export type ScriptSdk = Readonly<Record<string, unknown>>;

/**
 * Every module a script may import, by the specifier it writes.
 *
 * The namespaces are passed IN rather than imported. This module is part of
 * the engine, so importing the engine's own entry point from here would be a
 * cycle, and it has never heard of the others at all — which is the point:
 * what a script may reach is the caller's decision, made once where the
 * compiler and the runtime are set up together.
 */
export type ScriptModules = Readonly<Record<string, ScriptSdk>>;

/**
 * The module text a compiler should serve in place of one specifier.
 *
 * One `export const` per runtime name, read off the namespace rather than
 * written down, so a name added to the engine is a name scripts can use
 * without a list anywhere being edited. Types are absent by construction —
 * they do not exist at runtime — and that is correct: `verbatimModuleSyntax`
 * makes a script write `import type` for them, and the compiler erases those.
 */
export function scriptSdkShim(sdk: ScriptSdk, specifier: string = SCRIPT_SDK_MODULE): string {
	const lines = Object.keys(sdk)
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default')
		.map((name) => `export const ${name} = sdk[${JSON.stringify(name)}];`);
	const global = JSON.stringify(scriptModuleGlobal(specifier));
	/*
	 * The refusal is worth the two lines. A bundle whose global was never set
	 * fails on the first name it reads out of it — `undefined is not an object`
	 * somewhere inside compiled code — which says nothing about the module that
	 * was not offered. This says it.
	 */
	const refuse =
		`if (!sdk) throw new Error(${JSON.stringify(
			`a script imported '${specifier}', which this host did not offer it`,
		)});`;
	return `const sdk = globalThis[${global}];\n${refuse}\n${lines.join('\n')}\n`;
}

/**
 * Evaluate a compiled bundle and hand back a provider over the classes in it.
 *
 * Throws if the bundle will not run. A caller that has a previous provider
 * should keep it — see the editor's compiler for why a failed compile must
 * leave the running game alone.
 */
export function scriptsFromBundle(code: string, modules: ScriptSdk | ScriptModules): ScriptProvider {
	const exported = evaluate(code, asModules(modules));

	const table = new Map<string, ComponentType<Script>>();
	for (const [name, value] of Object.entries(exported)) {
		if (typeof value === 'function' && value.prototype instanceof Script) {
			table.set(name, value as ComponentType<Script>);
		}
	}

	const names = [...table.keys()];
	return {
		resolve: (typeName) => table.get(typeName) ?? null,
		names,
	};
}

/**
 * One namespace, read as the engine alone.
 *
 * A caller with only the engine to offer — this package's own tests, a tool
 * that runs a bundle to read the parameters off its classes — passes that
 * namespace directly, and a caller offering a script the whole game passes a
 * map. The engine is in every map, so the key it is under is what tells the
 * two apart: a namespace has runtime names in it and no module specifiers.
 */
function asModules(modules: ScriptSdk | ScriptModules): ScriptModules {
	if (SCRIPT_SDK_MODULE in modules) return modules as ScriptModules;
	return { [SCRIPT_SDK_MODULE]: modules as ScriptSdk };
}

function evaluate(code: string, modules: ScriptModules): Record<string, unknown> {
	for (const [specifier, sdk] of Object.entries(modules)) {
		(globalThis as Record<string, unknown>)[scriptModuleGlobal(specifier)] = sdk;
	}
	const module = { exports: {} as Record<string, unknown> };
	const refuse = (name: string): never => {
		throw new Error(`a script cannot require('${name}')`);
	};
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const factory = new Function('module', 'exports', 'require', code) as (
		module: { exports: Record<string, unknown> },
		exports: Record<string, unknown>,
		require: (name: string) => never,
	) => void;
	factory(module, module.exports, refuse);
	return module.exports;
}
