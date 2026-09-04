/*
 * Every script this build ships, by the name a prefab calls it.
 *
 * Written out rather than globbed, and the reason is what a glob would cost:
 * `import.meta.glob` is Vite's, so a client built with `tsc` would resolve
 * nothing, and the client is built both ways. An explicit list works
 * everywhere, is typechecked, and is one line per script.
 *
 * A list can drift from the directory beside it, so it is not left to
 * discipline: `test/scripts.test.ts` reads the directory and fails if a file
 * here is missing from this table. Add a script, add a line, and the test says
 * so if you forget.
 *
 * They live under `src/` because the client is built twice — once by `tsc` and
 * once by Vite — and a directory outside the compiler's root is a directory
 * neither build can import. Being here costs them nothing: the editor still
 * reads the same files as TEXT to compile and reload them, which is what makes
 * them asset-like, and where they sit on disk has no bearing on that.
 */

import type { Script, ScriptClass } from '@hexdelve/scripting';

import { Spin } from './Spin.js';

export const scripts: Record<string, ScriptClass<Script>> = {
	Spin,
};
