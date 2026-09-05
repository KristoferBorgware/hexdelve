/*
 * The modules a compiled script may import, as the tests' own instances.
 *
 * `scriptsFromBundle` needs every module the bundle imports, and a bundle that
 * is offered fewer refuses by name. What matters here is WHICH instances: these
 * are resolved the same way the code under test resolves them, so a `Player`
 * a script reaches is the `Player` a simulation built. Loading the same
 * packages from `dist/` instead would give the scripts a second copy of every
 * class, and every `instanceof` across the seam would be false.
 */

import * as client from '@hexdelve/client';
import * as engine from '@hexdelve/engine';
import * as shared from '@hexdelve/shared';

import type { ScriptModules } from '@hexdelve/engine';

export const SDK_MODULES: ScriptModules = {
	'@hexdelve/engine': engine,
	'@hexdelve/client': client,
	'@hexdelve/shared': shared,
};
