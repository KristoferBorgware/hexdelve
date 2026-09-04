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
 * ## The SDK global
 *
 * A bundle imports `@hexdelve/scripting`, and that import is rewritten by
 * whoever compiled it to read from a global this module sets. Bundling the real
 * package into the scripts would give them their OWN copy of `Script`, and
 * `value.prototype instanceof Script` — the check below, and the only way the
 * host knows it has a script at all — would then be false for every class in
 * the bundle.
 *
 * ## `new Function`, not `import()`
 *
 * A CommonJS module that requires nothing and reads its SDK from a global needs
 * no loader, no blob URL and no import map. That is what makes this one code
 * path work unchanged in a browser, in Node and under the test runner.
 */

import { Script } from './Script.js';
import { param } from './parameters.js';
import type { ScriptClass } from './parameters.js';
import type { ScriptProvider } from './ScriptHost.js';

/** The specifier a script imports, and the global its import is rewritten to. */
export const SCRIPT_SDK_MODULE = '@hexdelve/scripting';
export const SCRIPT_SDK_GLOBAL = '__HEXDELVE_SCRIPTING__';

/**
 * Everything a compiled script may import.
 *
 * Deliberately short. Each of these is something a script is WRITTEN against;
 * anything else it needs it reaches through its handles. Keeping the list short
 * is what stops it becoming the whole engine by degrees, and every name added
 * here is a name scripts may go on using.
 */
export const scriptSdk: Readonly<Record<string, unknown>> = { Script, param };

/** The module text a compiler should serve for `@hexdelve/scripting`. */
export function scriptSdkShim(): string {
	const lines = Object.keys(scriptSdk).map(
		(name) => `export const ${name} = sdk[${JSON.stringify(name)}];`,
	);
	return `const sdk = globalThis[${JSON.stringify(SCRIPT_SDK_GLOBAL)}];\n${lines.join('\n')}\n`;
}

/**
 * Evaluate a compiled bundle and hand back a provider over the classes in it.
 *
 * Throws if the bundle will not run. A caller that has a previous provider
 * should keep it — see the editor's compiler for why a failed compile must
 * leave the running game alone.
 */
export function scriptsFromBundle(code: string): ScriptProvider {
	const exported = evaluate(code);

	const table = new Map<string, ScriptClass<Script>>();
	for (const [name, value] of Object.entries(exported)) {
		if (typeof value === 'function' && value.prototype instanceof Script) {
			table.set(name, value as ScriptClass<Script>);
		}
	}

	const names = [...table.keys()];
	return {
		resolve: (typeName) => table.get(typeName) ?? null,
		names,
	};
}

function evaluate(code: string): Record<string, unknown> {
	(globalThis as Record<string, unknown>)[SCRIPT_SDK_GLOBAL] = scriptSdk;
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
