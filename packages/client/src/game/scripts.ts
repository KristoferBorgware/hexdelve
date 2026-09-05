/*
 * Fetching the compiled scripts, so a shipped client has behaviour on it.
 *
 * The scripts are not in this package's module graph. `tools/build-scripts.mjs`
 * compiles `packages/client/scripts/` into one bundle, the dev server serves
 * the same thing compiled on demand, and this fetches it — the same shape as an
 * asset, and for the same reason: a script that had to be imported would be a
 * script every build had to parse, which is how a half-typed file used to stop
 * the editor from starting.
 *
 * ## What a failure does
 *
 * Nothing fatal. A client that cannot read its scripts runs without them and
 * says so. That is the discipline the whole scripting layer is built on — a
 * script whose class is missing leaves its object standing, a script that
 * throws is muted rather than killed — and it would be strange for the loading
 * step alone to take the world down.
 *
 * It is a warning rather than silence because the failure is otherwise very
 * hard to see: a world with no behaviour in it looks like a world where every
 * script happens to do nothing.
 */

import * as engine from '@hexdelve/engine';
import * as shared from '@hexdelve/shared';

/*
 * This package's own public names, for the scripts to import.
 *
 * A static self-import rather than a dynamic one. ESM resolves the cycle with
 * a live binding, and nothing reads it until `loadScripts` is called — long
 * after both modules have finished evaluating. A dynamic `import('../index.js')`
 * read the same way at run time, and a bundler rewrote it to the emitted file's
 * own name: served under any other name it fetched nothing, and the client
 * quietly ran with no behaviour in it.
 */
import * as client from '../index.js';
import { noScripts, scriptsFromBundle, type ScriptProvider } from '@hexdelve/engine';

/** Where the bundle is served from, relative to the page. */
export const SCRIPT_BUNDLE = 'scripts.js';

export interface LoadScriptsOptions {
	/** Where to read it from. Relative, so Electron's `app://` works unchanged. */
	readonly url?: string;
	/** Where the complaint goes when there is one. Defaults to the console. */
	readonly log?: (message: string) => void;
}

/**
 * Read and evaluate the compiled script bundle.
 *
 * Never rejects. The provider is empty when it could not be read, and the
 * reason has been reported.
 */
export async function loadScripts(options: LoadScriptsOptions = {}): Promise<ScriptProvider> {
	const url = options.url ?? SCRIPT_BUNDLE;
	const log = options.log ?? ((message: string) => console.warn(`[script] ${message}`));
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
		return scriptsFromBundle(await response.text(), {
			'@hexdelve/engine': engine,
			'@hexdelve/client': client,
			'@hexdelve/shared': shared,
		});
	} catch (error) {
		log(
			`cannot load ${url}, running with no scripts: ` +
				`${error instanceof Error ? error.message : String(error)}`,
		);
		return noScripts;
	}
}
